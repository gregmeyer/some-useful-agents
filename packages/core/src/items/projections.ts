/**
 * Pure projections: one source's records in, items out. No store access here,
 * so each rule is tested on plain data (items/collect.ts reads the stores).
 */
import type { InboxMessage, InboxResponse } from '../inbox-store.js';
import type { HumanQuestion } from '../human-questions.js';
import type { OutcomeRow } from '../outcome/outcome-store.js';
import type { BoardBuild } from '../board-build.js';
import type { SchedulerStatus } from '../scheduler-heartbeat.js';
import type { Run } from '../types.js';
import type { Agent } from '../agent-v2-types.js';
import type { Notebook } from '../notebooks.js';
import type { Item, ItemAction, ItemRef } from './types.js';

const iso = (ms: number): string => new Date(ms).toISOString();
const oneLine = (s: string, max = 160): string => {
  const flat = s.replace(/<plan>[\s\S]*?<\/plan>/g, ' ').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};
const runRef = (id: string): ItemRef => ({ kind: 'run', id, href: `/runs/${encodeURIComponent(id)}` });
const threadHref = (id: string): string => `/inbox/${encodeURIComponent(id)}`;
const agentHref = (id: string): string => `/agents/${encodeURIComponent(id)}`;

/** What a thread is waiting on you for. The one rule Home's list and items share. */
export type ThreadAttention = 'approve' | 'answer' | 'fail';

export function threadAttention(message: Pick<InboxMessage, 'status' | 'source'>, proposedActions: number): ThreadAttention | undefined {
  if (message.status === 'resolved' || message.status === 'dismissed') return undefined;
  if (message.source === 'run-failure' || message.source === 'outcome') return 'fail';
  if (proposedActions > 0 || (message.source === 'board' && message.status === 'awaiting_user')) return 'approve';
  if (message.source === 'question' || message.status === 'awaiting_user') return 'answer';
  return undefined;
}

/** A proposed action card in a thread: its response id and what it would do. */
export interface ProposedCard {
  responseId: string;
  agentId: string;
  label: string;
}

/** Proposed (not yet approved) action cards, oldest first. */
export function proposedCards(responses: readonly InboxResponse[]): ProposedCard[] {
  const out: ProposedCard[] = [];
  for (const r of responses) {
    if (r.role !== 'action' || !r.metaJson) continue;
    try {
      const m = JSON.parse(r.metaJson) as { kind?: string; status?: string; agentId?: string; ctaLabel?: string; inputs?: Record<string, string> };
      if (m.kind !== 'action' || m.status !== 'proposed' || typeof m.agentId !== 'string') continue;
      out.push({ responseId: r.id, agentId: m.agentId, label: m.ctaLabel || (m.agentId === 'agent-editor' ? 'Apply fix' : `Run ${m.agentId}`) });
    } catch { /* not an action card */ }
  }
  return out;
}

/**
 * A thread that needs you. `approve` → a decision (with the first proposed
 * card's approve / skip), `answer` → a question, `fail` → an alert.
 */
export function threadItem(message: InboxMessage, responses: readonly InboxResponse[]): Item | undefined {
  const cards = proposedCards(responses);
  const attention = threadAttention(message, cards.length);
  if (!attention) return undefined;
  const latest = [...responses].reverse().find((r) => r.role === 'triage' || r.role === 'system' || r.role === 'agent');
  const actions: ItemAction[] = [];
  const card = cards[0];
  if (card) {
    actions.push({ type: 'approve', label: card.label, threadId: message.id, responseId: card.responseId });
    actions.push({ type: 'skip', label: 'Not now', threadId: message.id, responseId: card.responseId });
  }
  actions.push({ type: 'reply', label: 'Reply', threadId: message.id });
  const at = message.lastActivityAt ?? responses[responses.length - 1]?.createdAt ?? message.createdAt;
  return {
    id: `thread:${message.id}`,
    kind: attention === 'approve' ? 'decision' : attention === 'answer' ? 'question' : 'alert',
    title: message.title,
    ...(latest ? { summary: `${latest.role === 'triage' ? 'sua: ' : ''}${oneLine(latest.body)}` } : {}),
    // Waiting on you is never low urgency, whatever the thread's priority.
    urgency: message.priority === 'high' || attention === 'approve' ? 'high' : 'normal',
    state: 'open',
    subject: { threadId: message.id, ...(message.agentId ? { agentId: message.agentId } : {}), ...(message.runId ? { runId: message.runId } : {}) },
    ...(cards.length > 1 ? { value: cards.length } : {}),
    actions,
    evidence: message.runId ? [runRef(message.runId)] : [],
    provenance: { source: 'inbox', producedBy: message.agentId ? `agent:${message.agentId}` : 'system', at: iso(at) },
    href: threadHref(message.id),
  };
}

/** A run waiting on a person's answer. */
export function questionItem(q: HumanQuestion): Item | undefined {
  if (q.status !== 'pending') return undefined;
  return {
    id: `question:${q.id}`,
    kind: 'question',
    title: oneLine(q.question, 140),
    summary: `${q.agentId} is waiting on your answer`,
    urgency: 'high',
    state: 'open',
    subject: { agentId: q.agentId, runId: q.runId, questionId: q.id, ...(q.inboxMessageId ? { threadId: q.inboxMessageId } : {}) },
    actions: [
      { type: 'answer', label: 'Answer', questionId: q.id, choices: q.choices },
      ...(q.inboxMessageId ? [{ type: 'reply' as const, label: 'Open the thread', threadId: q.inboxMessageId }] : []),
    ],
    evidence: [runRef(q.runId)],
    provenance: { source: 'questions', producedBy: `run:${q.runId}`, at: q.createdAt },
    href: q.inboxMessageId ? threadHref(q.inboxMessageId) : `/runs/${encodeURIComponent(q.runId)}`,
  };
}

const FINISHED: ReadonlySet<Run['status']> = new Set(['completed', 'failed', 'cancelled']);

/**
 * An agent whose latest finished run failed. `value` = failures in a row
 * (within the runs given, newest first); 3+ is high urgency.
 */
/** A failure older than this, on an agent with no schedule, is history, not something to act on today. */
export const STALE_FAILURE_MS = 7 * 24 * 3600_000;
const RECENT_SCHEDULED_MS = 3 * 24 * 3600_000;

/**
 * An agent whose failures are a pattern worth your attention: 2+ in a row, or
 * a scheduled run that just failed (it will keep failing on its own). One
 * failed manual run isn't a pattern; an unscheduled agent that last failed a
 * week ago isn't news.
 */
export function failingAgentItem(agent: Pick<Agent, 'id' | 'name'> & Partial<Pick<Agent, 'schedule'>>, recentRuns: readonly Run[], threadId?: string, now = Date.now()): Item | undefined {
  const finished = recentRuns.filter((r) => FINISHED.has(r.status));
  const latest = finished[0];
  if (!latest || latest.status !== 'failed') return undefined;
  let streak = 0;
  for (const r of finished) { if (r.status === 'failed') streak++; else break; }
  const lastAt = Date.parse(latest.completedAt ?? latest.startedAt);
  const age = Number.isFinite(lastAt) ? now - lastAt : 0;
  if (!agent.schedule && age > STALE_FAILURE_MS) return undefined;
  if (streak < 2 && !(latest.triggeredBy === 'schedule' && age < RECENT_SCHEDULED_MS)) return undefined;
  return {
    id: `agent:${agent.id}:failing`,
    kind: 'alert',
    title: `${agent.name || agent.id} is failing`,
    summary: streak > 1 ? `${String(streak)} runs in a row failed${latest.error ? `: ${oneLine(latest.error, 120)}` : ''}` : (latest.error ? oneLine(latest.error, 140) : 'Its latest run failed'),
    urgency: streak >= 3 ? 'high' : 'normal',
    state: 'open',
    subject: { agentId: agent.id, runId: latest.id, ...(threadId ? { threadId } : {}) },
    value: streak,
    actions: [
      { type: 'retry', label: 'Run it again', agentId: agent.id },
      ...(threadId ? [{ type: 'reply' as const, label: 'Ask sua', threadId }] : []),
      { type: 'open', label: 'See the run', href: `/runs/${encodeURIComponent(latest.id)}` },
    ],
    evidence: finished.slice(0, streak).map((r) => runRef(r.id)),
    provenance: { source: 'runs', producedBy: `run:${latest.id}`, at: latest.completedAt ?? latest.startedAt },
    href: agentHref(agent.id),
    since: (finished[streak - 1] ?? latest).completedAt ?? (finished[streak - 1] ?? latest).startedAt,
  };
}

/** An agent whose latest run finished but missed the outcome it declared. */
export function outcomeItem(agent: Pick<Agent, 'id' | 'name'>, latest: OutcomeRow | undefined, threadId?: string): Item | undefined {
  if (!latest || (latest.satisfied !== 'no' && latest.satisfied !== 'partial')) return undefined;
  return {
    id: `agent:${agent.id}:outcome`,
    kind: 'alert',
    title: `${agent.name || agent.id} ${latest.satisfied === 'no' ? 'missed' : 'partly missed'} its outcome`,
    summary: `Run ${latest.runId.slice(0, 8)} finished, but ${latest.satisfied === 'no' ? "didn't do" : "only partly did"} what it declared`,
    urgency: latest.satisfied === 'no' ? 'high' : 'normal',
    state: 'open',
    subject: { agentId: agent.id, runId: latest.runId, ...(threadId ? { threadId } : {}) },
    value: latest.satisfied,
    actions: [
      ...(threadId ? [{ type: 'reply' as const, label: 'Ask sua', threadId }] : []),
      { type: 'open', label: 'See the evidence', href: `/runs/${encodeURIComponent(latest.runId)}` },
    ],
    evidence: [{ kind: 'outcome', id: latest.runId, href: `/runs/${encodeURIComponent(latest.runId)}` }],
    provenance: { source: 'outcomes', producedBy: `run:${latest.runId}`, at: latest.detectedAt },
    href: agentHref(agent.id),
  };
}

/** A draft agent waiting to be made active. */
export function draftAgentItem(agent: Pick<Agent, 'id' | 'name' | 'description'>, at: string): Item {
  return {
    id: `agent:${agent.id}:draft`,
    kind: 'decision',
    title: `${agent.name || agent.id} is a draft`,
    summary: agent.description ? oneLine(agent.description, 140) : "It won't run on a schedule until you make it active",
    urgency: 'low',
    state: 'open',
    subject: { agentId: agent.id },
    actions: [
      { type: 'activate', label: 'Make it active', agentId: agent.id },
      { type: 'open', label: 'Look at it', href: agentHref(agent.id) },
    ],
    evidence: [{ kind: 'agent', id: agent.id, href: agentHref(agent.id) }],
    provenance: { source: 'agents', producedBy: 'system', at },
    href: agentHref(agent.id),
  };
}

/** A board being built, or one whose build failed. */
export function boardBuildItem(b: BoardBuild): Item | undefined {
  const boardHref = `/dashboards/${encodeURIComponent(b.boardId)}`;
  const base = {
    id: `board-build:${b.id}`,
    subject: { boardId: b.boardId },
    evidence: [{ kind: 'build' as const, id: b.id, href: boardHref }],
    provenance: { source: 'board-builds' as const, producedBy: 'system', at: iso(b.updatedAt) },
    href: boardHref,
  };
  if (b.phase === 'failed') {
    return {
      ...base,
      kind: 'alert',
      title: `Building a board failed`,
      summary: oneLine(b.error || b.request, 140),
      urgency: 'normal',
      state: 'open',
      actions: [{ type: 'open', label: 'Open the board', href: boardHref }],
    };
  }
  if (b.phase === 'done') return undefined;
  return {
    ...base,
    kind: 'progress',
    title: `Building a board: ${oneLine(b.request, 80)}`,
    summary: b.detail || b.phase,
    urgency: 'low',
    state: 'in-progress',
    value: b.phase,
    actions: [{ type: 'open', label: 'Watch it', href: boardHref }],
  };
}

/**
 * The scheduler, always present for context: ok when running, a problem when
 * agents are scheduled but it's stale, stopped or idle.
 */
export function schedulerItem(status: SchedulerStatus, scheduledAgents: number, at: string): Item {
  const down = scheduledAgents > 0 && (status === 'stale' || status === 'stopped');
  const warn = scheduledAgents > 0 && status === 'idle';
  return {
    id: 'system:scheduler',
    kind: 'status',
    title: down ? 'The scheduler is not running' : warn ? 'The scheduler has nothing loaded' : 'The scheduler',
    summary: scheduledAgents === 0
      ? 'No agents are on a schedule'
      : down
        ? `${String(scheduledAgents)} scheduled agent${scheduledAgents === 1 ? '' : 's'} won't run until it restarts (sua daemon restart --service schedule)`
        : warn
          ? `${String(scheduledAgents)} agent${scheduledAgents === 1 ? ' is' : 's are'} scheduled, but it loaded none; restart it to pick them up`
          : `Running ${String(scheduledAgents)} scheduled agent${scheduledAgents === 1 ? '' : 's'}`,
    urgency: down ? 'high' : warn ? 'normal' : 'low',
    state: down || warn ? 'open' : 'ok',
    subject: {},
    value: status,
    actions: [{ type: 'open', label: 'See scheduled agents', href: '/scheduled' }],
    evidence: [],
    provenance: { source: 'scheduler', producedBy: 'system', at },
    href: '/scheduled',
  };
}

/**
 * An active notebook, on Home in Happening now: what it's for and how far
 * along it is. When its conversation is waiting on you (`waiting`, that
 * thread's item), the notebook itself needs you: one row, not two.
 */
export function notebookItem(nb: Notebook, entryCount: number, waiting?: Item): Item | undefined {
  if (nb.status !== 'active') return undefined;
  const met = nb.criteria.filter((c) => c.met).length;
  const parts = [
    nb.criteria.length ? `${String(met)} of ${String(nb.criteria.length)} criteria met` : '',
    `${String(entryCount)} entr${entryCount === 1 ? 'y' : 'ies'}`,
  ].filter(Boolean);
  const href = `/notebooks/${encodeURIComponent(nb.id)}`;
  if (waiting) {
    return {
      id: `notebook:${nb.id}`,
      kind: waiting.kind,
      title: `Notebook: ${nb.title}`,
      summary: waiting.summary ?? parts.join(' · '),
      urgency: waiting.urgency,
      state: 'open',
      subject: { ...(waiting.subject.threadId ? { threadId: waiting.subject.threadId } : {}) },
      value: nb.criteria.length ? `${String(met)}/${String(nb.criteria.length)}` : String(entryCount),
      actions: [...waiting.actions, { type: 'open', label: 'Open the notebook', href }],
      evidence: waiting.evidence,
      provenance: { source: 'notebooks', producedBy: 'system', at: waiting.provenance.at > nb.updatedAt ? waiting.provenance.at : nb.updatedAt },
      href,
    };
  }
  return {
    id: `notebook:${nb.id}`,
    kind: 'progress',
    title: `Notebook: ${nb.title}`,
    summary: parts.join(' · '),
    urgency: 'low',
    state: 'in-progress',
    subject: {},
    value: nb.criteria.length ? `${String(met)}/${String(nb.criteria.length)}` : String(entryCount),
    actions: [{ type: 'open', label: 'Open the notebook', href }],
    evidence: [],
    provenance: { source: 'notebooks', producedBy: 'system', at: nb.updatedAt },
    href,
  };
}
