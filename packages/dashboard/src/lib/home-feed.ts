/**
 * Builds the cadence-organized inbox feed that leads the Mission Control home
 * (the inbox-as-front-door reframe). Shared by the `GET /` page route and the
 * `GET /inbox/home-strips` live-refresh fragment so a full page load and an
 * SSE-driven swap always agree.
 *
 * Cadence is the top-level organizer (Needs you / Today / This week / Earlier +
 * a "sua closed these" ticker). The task 2×2 — scheduled/unscheduled ×
 * deterministic/non-deterministic — rides along as a per-item `nature` tag so
 * the operator calibrates "must I act vs can I just read" at a glance without
 * extra sections.
 */

import type { Agent, InboxMessage } from '@some-useful-agents/core';
import { isLlmPromptType } from '@some-useful-agents/core';
import type { DashboardContext } from '../context.js';

/** The task-2×2 classification of a thread, derived from its owning agent. */
export interface ThreadNature {
  /** Agent runs on a clock (has a cron `schedule`) or the item is a cadence
   *  producer — vs ad-hoc / event-driven. */
  scheduled: boolean;
  /** Agent is all shell-like nodes (predictable) — vs contains an LLM /
   *  agent-invoke step (non-deterministic). A manual/agentless chat thread is
   *  non-deterministic by nature (you're talking to triage). */
  deterministic: boolean;
}

/** One row in the cadence feed: a thread plus its 2×2 nature tag. */
export interface CadenceItem {
  message: InboxMessage;
  nature: ThreadNature;
}

export interface HomeFeedData {
  /** awaiting_user — the action queue, pinned first regardless of time. */
  needsYou: CadenceItem[];
  /** Active, non-awaiting threads with activity since local midnight. */
  today: CadenceItem[];
  /** Active, non-awaiting threads active earlier this week (not today). */
  week: CadenceItem[];
  /** Older active threads (collapsed in the UI). */
  earlier: CadenceItem[];
  /** Threads sua resolved on its own recently — the trust ticker. */
  closed: InboxMessage[];
}

/** Non-deterministic node types: LLM prompts + sub-agent invocations. */
function isNonDeterministicNode(type: string): boolean {
  return isLlmPromptType(type) || type === 'agent-invoke';
}

/**
 * Classify a thread's task nature from its owning agent. Threads with no agent
 * (a manual chat with triage) are non-deterministic + ad-hoc. Pure — pass the
 * already-fetched agent (or null) so callers can cache per-agent lookups.
 */
export function classifyThreadNature(message: InboxMessage, agent: Agent | null): ThreadNature {
  const scheduled = message.source === 'cadence' || !!(agent && agent.schedule && agent.schedule.trim().length > 0);
  // Agentless / manual threads are a conversation with the (LLM) triage agent →
  // non-deterministic. An agent with zero LLM/agent-invoke nodes is deterministic.
  const deterministic = !!agent && agent.nodes.length > 0
    && !agent.nodes.some((n) => isNonDeterministicNode(n.type));
  return { scheduled, deterministic };
}

/** Local-time start-of-day for `nowMs`. */
export function startOfDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Local-time start-of-week (Monday 00:00) for `nowMs`. Monday-based so a
 * Sunday-evening thread still reads as "this week" rather than bleeding into
 * next week's bucket.
 */
export function startOfWeek(nowMs: number): number {
  const d = new Date(startOfDay(nowMs));
  const dow = d.getDay(); // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7;
  d.setDate(d.getDate() - backToMonday);
  return d.getTime();
}

/** How many active threads to pull for the feed. Beyond this the operator uses
 *  the full /inbox list; the home feed is a curated recent slice. */
const FEED_ACTIVE_LIMIT = 100;
/** Ticker size + window: sua's autonomous closes over the last 7 days. */
const CLOSED_LIMIT = 6;
const CLOSED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Assemble the cadence feed. Reads only existing store queries (no new
 * producers): active threads via `list({ sort: 'age' })`, autonomous closes via
 * `listRecentlyResolved`. Agent lookups for the nature tag are cached per
 * agentId within the call.
 */
export function buildHomeFeedData(ctx: DashboardContext, nowMs: number): HomeFeedData {
  const empty: HomeFeedData = { needsYou: [], today: [], week: [], earlier: [], closed: [] };
  if (!ctx.inboxStore) return empty;

  const active = ctx.inboxStore.list({ sort: 'age', dir: 'desc', limit: FEED_ACTIVE_LIMIT });
  const midnight = startOfDay(nowMs);
  const weekStart = startOfWeek(nowMs);

  const agentCache = new Map<string, Agent | null>();
  const natureOf = (m: InboxMessage): ThreadNature => {
    let agent: Agent | null = null;
    if (m.agentId) {
      if (agentCache.has(m.agentId)) agent = agentCache.get(m.agentId) ?? null;
      else { agent = ctx.agentStore.getAgent(m.agentId); agentCache.set(m.agentId, agent); }
    }
    return classifyThreadNature(m, agent);
  };
  const toItem = (m: InboxMessage): CadenceItem => ({ message: m, nature: natureOf(m) });

  const out: HomeFeedData = { needsYou: [], today: [], week: [], earlier: [], closed: [] };
  for (const m of active) {
    if (m.status === 'awaiting_user') { out.needsYou.push(toItem(m)); continue; }
    const at = m.lastActivityAt ?? m.createdAt;
    if (at >= midnight) out.today.push(toItem(m));
    else if (at >= weekStart) out.week.push(toItem(m));
    else out.earlier.push(toItem(m));
  }
  try { out.closed = ctx.inboxStore.listRecentlyResolved(CLOSED_LIMIT, CLOSED_WINDOW_MS); } catch { /* ticker hides when empty */ }
  return out;
}
