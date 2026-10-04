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
import {
  threadItem, questionItem, failingAgentItem, outcomeItem, draftAgentItem, boardBuildItem, schedulerItem,
} from './projections.js';
import { URGENCY_ORDER, type Item, type ItemKind } from './types.js';

export interface ItemSources {
  inbox?: InboxStore;
  questions?: HumanQuestionStore;
  outcomes?: OutcomeStore;
  boardBuilds?: BoardBuildStore;
  agents: AgentStore;
  runs: RunStore;
  /** Where the scheduler's heartbeat lives; no scheduler item without it. */
  dataDir?: string;
}

/** Every source from one open database (what the dashboard and MCP server share). */
export function itemSourcesFromHandle(db: DatabaseSync, agents: AgentStore, runs: RunStore, dataDir?: string): ItemSources {
  return {
    inbox: InboxStore.fromHandle(db),
    questions: HumanQuestionStore.fromHandle(db),
    outcomes: OutcomeStore.fromHandle(db),
    boardBuilds: new BoardBuildStore(db),
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

export function collectItems(src: ItemSources, q: ItemQuery = {}): Item[] {
  const now = q.now ?? Date.now();
  const items: Item[] = [];
  const agents = src.agents.listAgents().filter((a) => a.status !== 'archived');

  // Threads still open, newest first. Ones that mirror a question or an agent's
  // failure / outcome are folded into those items below.
  const threads: InboxMessage[] = src.inbox
    ? src.inbox.list({ statuses: ['open', 'triaged', 'awaiting_user', 'verifying'], limit: THREAD_SCAN })
    : [];
  const failureThreadFor = new Map<string, string>();
  const outcomeThreadFor = new Map<string, string>();
  for (const t of threads) {
    if (!t.agentId) continue;
    if (t.source === 'run-failure' && !failureThreadFor.has(t.agentId)) failureThreadFor.set(t.agentId, t.id);
    if (t.source === 'outcome' && !outcomeThreadFor.has(t.agentId)) outcomeThreadFor.set(t.agentId, t.id);
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
  for (const agent of agents) {
    const runs = src.runs.listRuns({ agentName: agent.id, limit: RUNS_PER_AGENT });
    const failing = failingAgentItem(agent, runs, failureThreadFor.get(agent.id));
    if (failing) { items.push(failing); agentItemFor.add(`run-failure:${agent.id}`); }
    const latestOutcome = src.outcomes?.list({ agentId: agent.id, limit: 1 })[0];
    // A failed latest run already says it; only report a missed outcome on a run that finished.
    const outcome = failing ? undefined : outcomeItem(agent, latestOutcome, outcomeThreadFor.get(agent.id));
    if (outcome) { items.push(outcome); agentItemFor.add(`outcome:${agent.id}`); }
    if (agent.status === 'draft') items.push(draftAgentItem(agent, runs[0]?.startedAt ?? new Date(now).toISOString()));
  }

  // Remaining threads that need you.
  for (const t of threads) {
    if (questionThreads.has(t.id)) continue;
    if (t.agentId && (t.source === 'run-failure' || t.source === 'outcome') && agentItemFor.has(`${t.source}:${t.agentId}`)) continue;
    const item = threadItem(t, src.inbox!.listResponses(t.id));
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

  // The scheduler.
  if (src.dataDir) {
    const { status, heartbeat } = getSchedulerStatus(src.dataDir);
    const scheduled = agents.filter((a) => a.schedule && a.status === 'active').length;
    items.push(schedulerItem(status, scheduled, heartbeat?.lastHeartbeat ?? new Date(now).toISOString()));
  }

  return sortItems(items).filter((i) =>
    (q.includeOk !== false || i.state !== 'ok')
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
