/**
 * Read the stores and build the item index. One item per fact: a thread that
 * mirrors something else (a run's question, an agent's failure alert) becomes
 * that item's "reply" action instead of a second item.
 */
import type { DatabaseSync } from 'node:sqlite';
import { InboxStore, type InboxMessage } from '../inbox-store.js';
import { HumanQuestionStore } from '../human-questions.js';
import { OutcomeStore } from '../outcome/outcome-store.js';
import { BoardBuildStore } from '../board-build.js';
import { AgentStore } from '../agent-store.js';
import { RunStore } from '../run-store.js';
import { getSchedulerStatus } from '../scheduler-heartbeat.js';
import { NotebookStore } from '../notebooks.js';
import {
  threadItem, questionItem, failingAgentItem, outcomeItem, draftAgentItem, boardBuildItem, schedulerItem, notebookItem,
} from './projections.js';
import { URGENCY_ORDER, type Item, type ItemKind } from './types.js';
import { SYSTEM_AGENT_IDS } from './system-agents.js';
import { ItemDismissals, stillDismissed } from './dismissals.js';

export interface ItemSources {
  inbox?: InboxStore;
  questions?: HumanQuestionStore;
  outcomes?: OutcomeStore;
  boardBuilds?: BoardBuildStore;
  notebooks?: NotebookStore;
  agents: AgentStore;
  runs: RunStore;
  /** Where the scheduler's heartbeat lives; no scheduler item without it. */
  dataDir?: string;
  /** Items you dismissed (item id → when): off Today until they change. */
  dismissals?: Map<string, string>;
}

/** Every source from one open database (what the dashboard and MCP server share). */
export function itemSourcesFromHandle(db: DatabaseSync, agents: AgentStore, runs: RunStore, dataDir?: string): ItemSources {
  return {
    inbox: InboxStore.fromHandle(db),
    questions: HumanQuestionStore.fromHandle(db),
    outcomes: OutcomeStore.fromHandle(db),
    boardBuilds: new BoardBuildStore(db),
    notebooks: NotebookStore.fromHandle(db),
    dismissals: ItemDismissals.fromHandle(db).all(),
    agents,
    runs,
    ...(dataDir ? { dataDir } : {}),
  };
}

export interface ItemQuery {
  kinds?: readonly ItemKind[];
  agentId?: string;
  /** Include healthy context items (state `ok`), e.g. the scheduler when it's fine. Default true. */
  includeOk?: boolean;
  limit?: number;
  /** For tests. */
  now?: number;
}

const THREAD_SCAN = 200;
const RUNS_PER_AGENT = 10;
const FAILED_BUILD_WINDOW_MS = 24 * 3600_000;

/** A conversation started with "Ask sua to fix it" (or a failing agent's offer). */
export function isFixThread(t: Pick<InboxMessage, 'source' | 'title' | 'agentId'>): boolean {
  return t.source === 'manual' && !!t.agentId && /^Fix /.test(t.title);
}

const RECENT_DRAFT_MS = 14 * 24 * 3600_000;
function isRecentDraft(agent: { updatedAt?: string }, now: number): boolean {
  const at = agent.updatedAt ? Date.parse(agent.updatedAt) : NaN;
  return !Number.isFinite(at) || now - at < RECENT_DRAFT_MS;
}

export function collectItems(src: ItemSources, q: ItemQuery = {}): Item[] {
  const now = q.now ?? Date.now();
  const items: Item[] = [];
  // sua's own agents are never your problems.
  const agents = src.agents.listAgents().filter((a) => a.status !== 'archived' && !SYSTEM_AGENT_IDS.has(a.id));

  // Threads still open, newest first. Ones that mirror a question or an agent's
  // failure / outcome are folded into those items below.
  const threads: InboxMessage[] = src.inbox
    ? src.inbox.list({ statuses: ['open', 'triaged', 'awaiting_user', 'verifying'], limit: THREAD_SCAN })
    : [];
  const failureThreadFor = new Map<string, string>();
  const outcomeThreadFor = new Map<string, string>();
  // "Ask sua to fix it" conversations: the same problem, so the same item.
  const fixThreadFor = new Map<string, string>();
  for (const t of threads) {
    if (!t.agentId) continue;
    if (t.source === 'run-failure' && !failureThreadFor.has(t.agentId)) failureThreadFor.set(t.agentId, t.id);
    if (t.source === 'outcome' && !outcomeThreadFor.has(t.agentId)) outcomeThreadFor.set(t.agentId, t.id);
    if (isFixThread(t) && !fixThreadFor.has(t.agentId)) fixThreadFor.set(t.agentId, t.id);
  }

  // Questions runs are waiting on.
  const questionThreads = new Set<string>();
  for (const question of src.questions?.listPending() ?? []) {
    const item = questionItem(question);
    if (!item) continue;
    if (question.inboxMessageId) questionThreads.add(question.inboxMessageId);
    items.push(item);
  }

  // Per agent: failing, missed outcome, draft.
  const agentItemFor = new Set<string>();
  // Each agent's latest finished run: a failure conversation whose agent has since run fine is over.
  const latestOk = new Set<string>();
  for (const agent of agents) {
    const runs = src.runs.listRuns({ agentName: agent.id, limit: RUNS_PER_AGENT });
    const lastFinished = runs.find((r) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled');
    if (lastFinished?.status === 'completed') latestOk.add(agent.id);
    const failing = failingAgentItem(agent, runs, failureThreadFor.get(agent.id) ?? fixThreadFor.get(agent.id), now);
    if (failing) { items.push(failing); agentItemFor.add(agent.id); }
    const latestOutcome = src.outcomes?.list({ agentId: agent.id, limit: 1 })[0];
    // A failed latest run already says it; only report a missed outcome on a run that finished.
    const outcome = failing ? undefined : outcomeItem(agent, latestOutcome, outcomeThreadFor.get(agent.id) ?? fixThreadFor.get(agent.id));
    if (outcome) { items.push(outcome); agentItemFor.add(agent.id); }
    // A recent draft is waiting on you; an old one is shelved, not a to-do.
    if (agent.status === 'draft' && isRecentDraft(agent, now)) items.push(draftAgentItem(agent, agent.updatedAt ?? runs[0]?.startedAt ?? new Date(now).toISOString()));
  }

  // Active notebooks, and their conversations: a notebook's conversation is
  // its notebook's row (folded in below), not a second one.
  const notebooks = src.notebooks?.list({ status: 'active' }) ?? [];
  const notebookOfThread = new Map<string, string>();
  for (const nb of notebooks) if (nb.conversationId) notebookOfThread.set(nb.conversationId, nb.id);
  const notebookWaiting = new Map<string, Item>();

  // Remaining threads that need you.
  for (const t of threads) {
    if (questionThreads.has(t.id)) continue;
    // Conversations about sua's own agents aren't yours to handle here.
    if (t.agentId && SYSTEM_AGENT_IDS.has(t.agentId)) continue;
    // A failure (or "Fix …") conversation whose agent has since run fine is over: it's in Open if you want it.
    if (t.agentId && latestOk.has(t.agentId) && (t.source === 'run-failure' || isFixThread(t))) continue;
    // An agent's failure / outcome / fix conversations are its problem item's conversation, not more items.
    if (t.agentId && agentItemFor.has(t.agentId) && (t.source === 'run-failure' || t.source === 'outcome' || isFixThread(t))) continue;
    const item = threadItem(t, src.inbox!.listResponses(t.id));
    const nbId = notebookOfThread.get(t.id);
    if (item && nbId) { notebookWaiting.set(nbId, item); continue; }
    if (item) items.push(item);
  }

  // Boards being built, and builds that failed in the last day.
  if (src.boardBuilds) {
    const builds = [...src.boardBuilds.queued(), ...src.boardBuilds.unfinished(), ...src.boardBuilds.failedSince(now - FAILED_BUILD_WINDOW_MS)];
    const seen = new Set<string>();
    for (const b of builds) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      const item = boardBuildItem(b);
      if (item) items.push(item);
    }
  }

  // Active notebooks (waiting on you when their conversation is).
  for (const nb of notebooks) {
    const item = notebookItem(nb, src.notebooks!.entries(nb.id, 500).length, notebookWaiting.get(nb.id));
    if (item) items.push(item);
  }

  // The scheduler.
  if (src.dataDir) {
    const { status, heartbeat } = getSchedulerStatus(src.dataDir);
    const scheduled = agents.filter((a) => a.schedule && a.status === 'active').length;
    items.push(schedulerItem(status, scheduled, heartbeat?.lastHeartbeat ?? new Date(now).toISOString()));
  }

  // Dismissing an agent's failure or "Fix …" conversation dismisses its problem
  // too, as of then: a newer failure brings it back.
  const agentDismissedAt = new Map<string, number>();
  for (const t of src.inbox?.list({ statuses: ['dismissed'], limit: THREAD_SCAN }) ?? []) {
    if (!t.agentId || !t.resolvedAt || !(t.source === 'run-failure' || t.source === 'outcome' || isFixThread(t))) continue;
    agentDismissedAt.set(t.agentId, Math.max(agentDismissedAt.get(t.agentId) ?? 0, t.resolvedAt));
  }
  // A failing agent "changed" when a new streak began, not on each failure of the same one.
  const dismissed = (i: Item) => stillDismissed(i.since ?? i.provenance.at, src.dismissals?.get(i.id))
    || ((i.id.endsWith(':failing') || i.id.endsWith(':outcome')) && !!i.subject.agentId && stillDismissed(i.since ?? i.provenance.at, agentDismissedAt.get(i.subject.agentId)));

  return sortItems(items).filter((i) =>
    !dismissed(i)
    && (q.includeOk !== false || i.state !== 'ok')
    && (!q.kinds?.length || q.kinds.includes(i.kind))
    && (!q.agentId || i.subject.agentId === q.agentId),
  ).slice(0, q.limit ?? 200);
}

/** Most urgent first; within an urgency, things waiting on you, then newest. */
export function sortItems(items: Item[]): Item[] {
  const stateOrder = { open: 0, 'in-progress': 1, waiting: 2, ok: 3 } as const;
  return [...items].sort((a, b) =>
    URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
    || stateOrder[a.state] - stateOrder[b.state]
    || b.provenance.at.localeCompare(a.provenance.at),
  );
}
