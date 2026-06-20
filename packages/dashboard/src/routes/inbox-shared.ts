import { type Request } from 'express';
import {
  type InboxActionMeta,
  type InboxResponse,
  type TriageLearning,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import {
  type InboxSortKey,
  type InboxSortDir,
  INBOX_DEFAULT_SORT,
} from '../views/inbox-list.js';

export const SORT_KEYS = new Set<InboxSortKey>(['priority', 'source', 'agent', 'title', 'age', 'status']);
export const SORT_DIRS = new Set<InboxSortDir>(['asc', 'desc']);

export const PENDING_USER_REPLY_WINDOW_MS = 30_000;

/**
 * Max characters in an auto-derived title. The inbox-list grid is
 * tight enough that anything past this gets ellipsized anyway, so we
 * truncate at the route layer with a trailing ellipsis instead of
 * relying on CSS overflow alone.
 */
export const TITLE_FROM_BODY_MAX = 60;

/**
 * Squash a freeform reply body into a single-line title. Replaces
 * whitespace runs (incl. newlines) with single spaces, trims, and
 * truncates with an ellipsis past TITLE_FROM_BODY_MAX. Returns the
 * original (trimmed) body when it's already short enough.
 */
export function deriveTitleFromBody(body: string): string {
  const single = body.replace(/\s+/g, ' ').trim();
  if (single.length <= TITLE_FROM_BODY_MAX) return single;
  return single.slice(0, TITLE_FROM_BODY_MAX - 1).trimEnd() + '…';
}

/**
 * Agent ids that are themselves part of the inbox-triage scaffolding —
 * they exist to make triage work, not as candidates to recommend back
 * to the operator. `agent-catalog-search` filters these out of its
 * result set so "find me an agent that does X" never proposes a system
 * agent. Kept here (vs in the YAML) so the list stays in sync with the
 * allowlist as new sub-agents are added.
 */
export const SYSTEM_AGENT_IDS: ReadonlySet<string> = new Set([
  'inbox-triage',
  'inbox-learning-extractor',
  'agent-analyzer',
  'agent-editor',
  'agent-catalog-search',
  'agent-builder',
]);

/**
 * Thin wrapper around `ctx.inboxEventBus.publish`. Swallows errors so
 * a misbehaving subscriber can't break a route. Bus presence is
 * optional — the inbox surface works without it (modal falls back to
 * the 1.5s fragment poll).
 */
export function publishInboxEvent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  if (!ctx.inboxEventBus) return;
  try { ctx.inboxEventBus.publish(messageId, { type, data }); }
  catch { /* telemetry path — never break a route */ }
}

/**
 * Add a `system`-role message AND publish the `message:created` SSE event so an
 * open modal refreshes live. Every triage system note must go through this — a
 * bare `addResponse` leaves the message invisible until a manual page refresh
 * (the bug where triage "finished" but the thread didn't update).
 */
export function addSystemMessage(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  body: string,
  metaJson?: string,
): InboxResponse {
  const reply = ctx.inboxStore!.addResponse(messageId, 'system', body, metaJson);
  publishInboxEvent(ctx, messageId, 'message:created', {
    responseId: reply.id, role: 'system', body: reply.body, createdAt: reply.createdAt,
  });
  return reply;
}

/** Humanize an inbox status for the thread-summary block. */
export function humanInboxStatus(status: string): string {
  switch (status) {
    case 'awaiting_user': return 'Your turn';
    case 'run-failure': return 'Run failure';
    default: return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

/** Collapse whitespace and clip to `max` chars with an ellipsis. */
export function summarizeInline(text: string | undefined, max = 180): string | undefined {
  const single = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!single) return undefined;
  if (single.length <= max) return single;
  return single.slice(0, max - 1).trimEnd() + '…';
}

/**
 * The operator's most recent real ask in the thread — the authoritative
 * "current intent" for triage. Scans responses newest-first for a `user`
 * row, skipping the synthetic "Ask triage" marker. Returns undefined when
 * the operator hasn't replied yet (triage is the first responder), in
 * which case the original message body is the only intent on record.
 *
 * Triage gets this as a first-class `CURRENT_REQUEST` input so a mid-thread
 * pivot ("actually, run the HN summary instead") wins over the frozen
 * original `MESSAGE_BODY`, which never changes after the thread is created.
 */
export function latestUserRequest(responses: readonly InboxResponse[]): string | undefined {
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const response = responses[i];
    if (response.role !== 'user') continue;
    const body = response.body.trim();
    if (body === '(Asked triage to take another look.)') continue;
    if (!body) continue;
    return body;
  }
  return undefined;
}

/**
 * Current wall-clock time as an ISO 8601 string WITH the machine's local UTC
 * offset (e.g. `2026-06-14T14:50:00-07:00`), not the `Z`/UTC form. sua is
 * local-first, so the dashboard process timezone IS the operator's, which
 * lets triage turn relative phrasing ("before 4:30pm today", "tomorrow 9am")
 * into a correct absolute timestamp it can hand to a reminder agent. The
 * offset form round-trips through Swift's ISO8601DateFormatter (it accepts
 * `.withInternetDateTime` offsets), so the computed due-date lands correctly.
 * Takes an optional `now` so the formatting is unit-testable.
 */
export function localIsoNow(now: Date = new Date()): string {
  const offsetMin = -now.getTimezoneOffset(); // minutes east of UTC
  const sign = offsetMin >= 0 ? '+' : '-';
  const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(now.getTime() + offsetMin * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`;
}

/** Parse a message's contextJson into a plain object (empty on absent/invalid). */
export function normalizeContextJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Retarget a thread: point its agent link at `agentId`, recording provenance. */
export function updateThreadAgentLink(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  agentId: string,
): void {
  if (!ctx.inboxStore) return;
  const message = ctx.inboxStore.get(messageId);
  if (!message) return;
  const context = normalizeContextJson(message.contextJson);
  ctx.inboxStore.updateMessage(messageId, {
    agentId,
    contextJson: JSON.stringify({ ...context, linkedAgentId: agentId, linkedAt: Date.now() }),
  });
}

export function parseSort(req: Request): { sort: InboxSortKey; dir: InboxSortDir } {
  const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : '';
  const dirRaw = typeof req.query.dir === 'string' ? req.query.dir : '';
  const sort = SORT_KEYS.has(sortRaw as InboxSortKey) ? (sortRaw as InboxSortKey) : INBOX_DEFAULT_SORT.sort;
  const dir = SORT_DIRS.has(dirRaw as InboxSortDir) ? (dirRaw as InboxSortDir) : INBOX_DEFAULT_SORT.dir;
  return { sort, dir };
}

export function parseFlash(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  if (typeof req.query.ok === 'string') return { kind: 'ok', message: req.query.ok };
  if (typeof req.query.error === 'string') return { kind: 'error', message: req.query.error };
  if (typeof req.query.info === 'string') return { kind: 'info', message: req.query.info };
  return undefined;
}

export function isAjax(req: Request): boolean {
  const xrw = req.get('x-requested-with');
  if (xrw && xrw.toLowerCase() === 'fetch') return true;
  const accept = req.get('accept') ?? '';
  return accept.includes('application/json');
}

/**
 * Parse the `meta_json` payload of an `action`-role response. Returns
 * null when the row isn't an action or the meta is missing / malformed —
 * callers treat that as "not an actionable action."
 */
export function parseActionMeta(r: InboxResponse): InboxActionMeta | null {
  if (r.role !== 'action' || !r.metaJson) return null;
  try {
    const parsed = JSON.parse(r.metaJson) as Partial<InboxActionMeta>;
    if (parsed && parsed.kind === 'action' && typeof parsed.agentId === 'string' && typeof parsed.status === 'string') {
      return parsed as InboxActionMeta;
    }
  } catch { /* swallow */ }
  return null;
}

export function stableStringifyInputs(inputs: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(inputs)
      .sort()
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = inputs[key];
        return acc;
      }, {}),
  );
}

export const TRIAGE_REJECTION_RECOVERY_NOTE =
  'The proposed action was rejected before execution. Choose a different next step or offer alternatives/links instead of retrying the same action.';

/** Byte budget for the RELEVANT_LEARNINGS prompt block (after the top-K cap). */
export const LEARNINGS_PROMPT_BUDGET = 1500;

/**
 * Render retrieved lessons as a numbered plain-text block for the triage
 * prompt: `N. [category] lesson`. Already top-K capped by the store query;
 * this trims to a byte budget so a burst of lessons can't bloat the prompt.
 * Returns '' for an empty list (the kernel section then no-ops).
 */
export function formatLearnings(learnings: readonly TriageLearning[]): string {
  const lines: string[] = [];
  let bytes = 0;
  for (let i = 0; i < learnings.length; i += 1) {
    const l = learnings[i];
    const line = `${lines.length + 1}. ${l.category ? `[${l.category}] ` : ''}${l.lesson}`;
    bytes += line.length + 1;
    if (bytes > LEARNINGS_PROMPT_BUDGET) break;
    lines.push(line);
  }
  return lines.join('\n');
}

export function formatConversationSnapshot(responses: readonly InboxResponse[]): string {
  return responses
    .map((r) => {
      if (r.role === 'action') {
        const m = parseActionMeta(r);
        const suffix = m ? ` (status=${m.status}${m.resultSummary ? `; result=${m.resultSummary.slice(0, 200)}` : ''})` : '';
        return `[action] ${r.body}${suffix}`;
      }
      return `[${r.role}] ${r.body}`;
    })
    .join('\n');
}
