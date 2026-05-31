/**
 * Routes for the Inbox surface:
 *
 *   GET  /inbox                 — single sortable grid of active items
 *   GET  /inbox/:id             — full-page detail (fallback for direct links)
 *   GET  /inbox/:id/fragment    — inner detail HTML for the modal
 *   POST /inbox/:id/dismiss     — terminal-state the message
 *   POST /inbox/:id/respond     — append user-role response; auto-fires triage
 *   POST /inbox/:id/triage      — run the inbox-triage system agent; result
 *                                 parsed + appended as a triage-role response
 *
 * Mutation routes return:
 *   - 303 redirect for non-AJAX (plain form posts)
 *   - 204 with no body for AJAX (modal's fetch wrapper sets
 *     `X-Requested-With: fetch`)
 *
 * Triage pending detection (used by GET /:id/fragment) checks both:
 *   - a captured triageRunId whose run is pending/running, AND
 *   - "kicked off recently" — newest response is a user response
 *     within the last 30s with no later triage/system reply. Covers
 *     the race where the dag-executor hasn't yet inserted its
 *     run-store row when the modal first polls.
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildDiscoveryCatalog,
  exportAgent,
  executeAgentDag,
  extractPlanJson,
  listBuiltinTools,
  parseAgent,
  type RunStatus,
  type InboxActionMeta,
  type InboxActionStatus,
  type InboxResponse,
  type ToolDefinition,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import { formatToolCatalog } from './run-now-build.js';
import { TEMPLATE_REGISTRY } from '../views/pulse-templates.js';
import {
  renderInboxList,
  type InboxSortKey,
  type InboxSortDir,
  INBOX_DEFAULT_SORT,
} from '../views/inbox-list.js';
import { renderInboxDetail, renderInboxDetailFragment } from '../views/inbox-detail.js';
import { render } from '../views/html.js';
import { renderNotFoundPage } from '../views/not-found.js';

export const inboxRouter: Router = Router();

const SORT_KEYS = new Set<InboxSortKey>(['priority', 'source', 'agent', 'title', 'age', 'status']);
const SORT_DIRS = new Set<InboxSortDir>(['asc', 'desc']);
const TRIAGE_AGENT_ID = 'inbox-triage';
const PENDING_USER_REPLY_WINDOW_MS = 30_000;

/**
 * Agent IDs that the inbox-triage agent is allowed to propose running
 * on the operator's behalf. Each entry that resolves to an installed
 * (or auto-importable) agent becomes available to triage. v1 keeps
 * this hardcoded — a future PR can move it to a per-area config.
 *
 * `agent-analyzer` is the agent behind the "Suggest improvements"
 * button on the agent detail page. When triage proposes it, the route
 * auto-injects AGENT_YAML (from the inbox message's agentId) +
 * LAST_RUN_OUTPUT, mirroring the analyze route at
 * `run-now-build.ts:415`.
 */
/**
 * Default title for a freshly-created manual thread. POST /inbox/new
 * uses this when the client doesn't supply a title; POST /respond
 * watches for it so the first reply on the thread can replace the
 * placeholder with something derived from the operator's actual words.
 */
const DEFAULT_NEW_CONVERSATION_TITLE = 'New conversation';

/**
 * Max characters in an auto-derived title. The inbox-list grid is
 * tight enough that anything past this gets ellipsized anyway, so we
 * truncate at the route layer with a trailing ellipsis instead of
 * relying on CSS overflow alone.
 */
const TITLE_FROM_BODY_MAX = 60;

/**
 * Squash a freeform reply body into a single-line title. Replaces
 * whitespace runs (incl. newlines) with single spaces, trims, and
 * truncates with an ellipsis past TITLE_FROM_BODY_MAX. Returns the
 * original (trimmed) body when it's already short enough.
 */
function deriveTitleFromBody(body: string): string {
  const single = body.replace(/\s+/g, ' ').trim();
  if (single.length <= TITLE_FROM_BODY_MAX) return single;
  return single.slice(0, TITLE_FROM_BODY_MAX - 1).trimEnd() + '…';
}

const TRIAGE_SUB_AGENT_ALLOWLIST: readonly string[] = [
  'agent-analyzer',
  'agent-editor',
  'agent-catalog-search',
  'agent-builder',
];

/**
 * Agents whose proposed-action cards are auto-approved when triage
 * emits them — they kick straight to `running` without waiting for an
 * operator click. The set is the proven safe chain: analyzer (read-only
 * diagnosis), editor (writes only the YAML diff already shown in the
 * card), catalog-search (read-only catalog probe). Anything outside
 * this set still requires manual Run.
 *
 * Operator can still skip an in-flight action via the standard
 * action-card controls, and the chevron/dismiss flows are unaffected.
 *
 * v1 keeps this hardcoded. A future PR can move it to a per-thread or
 * global override (`data/.sua/inbox-settings.json`) once a non-trivial
 * subset of operators want different defaults.
 */
const TRIAGE_AUTO_APPROVE_AGENTS: ReadonlySet<string> = new Set([
  'agent-analyzer',
  'agent-editor',
  'agent-catalog-search',
  'agent-builder',
]);

/**
 * Agent ids that are themselves part of the inbox-triage scaffolding —
 * they exist to make triage work, not as candidates to recommend back
 * to the operator. `agent-catalog-search` filters these out of its
 * result set so "find me an agent that does X" never proposes a system
 * agent. Kept here (vs in the YAML) so the list stays in sync with the
 * allowlist as new sub-agents are added.
 */
const SYSTEM_AGENT_IDS: ReadonlySet<string> = new Set([
  'inbox-triage',
  'agent-analyzer',
  'agent-editor',
  'agent-catalog-search',
  'agent-builder',
]);

/**
 * Agent IDs handled by the route directly rather than dispatched as a
 * sub-agent run. The "agent" entry here exists so the allowlist + UI
 * affordances behave consistently, but the actual side effect (e.g.
 * committing a YAML change via `agentStore.upsertAgent`) is performed
 * synchronously inside `runProposedAction`.
 */
const ROUTE_HANDLED_AGENTS: ReadonlySet<string> = new Set(['agent-editor']);

/**
 * For allowlist entries that aren't already installed, the route
 * lazy-imports the YAML on first triage call (mirrors what the
 * existing analyze route does for agent-analyzer). The path lookup
 * is conservative — any agent that isn't installed AND isn't shipped
 * under `agents/examples/` is silently dropped from the effective
 * allowlist.
 */
const ALLOWLIST_AUTOIMPORT_DIR = 'agents/examples';

/**
 * Hard cap on `action`-role responses per inbox message. Triage gets a
 * follow-up turn after each action resolves; without a cap, a bad
 * prompt could fan out indefinitely. 10 is enough room for a few rounds
 * of "run X, summarize, run Y on the result" without going wild.
 */
const MAX_ACTIONS_PER_MESSAGE = 10;

/** Truncate the sub-agent run output that's stored in action meta. */
const ACTION_RESULT_PREVIEW_LIMIT = 500;

/**
 * Thin wrapper around `ctx.inboxEventBus.publish`. Swallows errors so
 * a misbehaving subscriber can't break a route. Bus presence is
 * optional — the inbox surface works without it (modal falls back to
 * the 1.5s fragment poll).
 */
function publishInboxEvent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  if (!ctx.inboxEventBus) return;
  try { ctx.inboxEventBus.publish(messageId, { type, data }); }
  catch { /* telemetry path — never break a route */ }
}

function parseSort(req: Request): { sort: InboxSortKey; dir: InboxSortDir } {
  const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : '';
  const dirRaw = typeof req.query.dir === 'string' ? req.query.dir : '';
  const sort = SORT_KEYS.has(sortRaw as InboxSortKey) ? (sortRaw as InboxSortKey) : INBOX_DEFAULT_SORT.sort;
  const dir = SORT_DIRS.has(dirRaw as InboxSortDir) ? (dirRaw as InboxSortDir) : INBOX_DEFAULT_SORT.dir;
  return { sort, dir };
}

function parseFlash(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  if (typeof req.query.ok === 'string') return { kind: 'ok', message: req.query.ok };
  if (typeof req.query.error === 'string') return { kind: 'error', message: req.query.error };
  if (typeof req.query.info === 'string') return { kind: 'info', message: req.query.info };
  return undefined;
}

function isAjax(req: Request): boolean {
  const xrw = req.get('x-requested-with');
  if (xrw && xrw.toLowerCase() === 'fetch') return true;
  const accept = req.get('accept') ?? '';
  return accept.includes('application/json');
}

inboxRouter.get('/inbox', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const starred = req.query.starred === '1' || req.query.starred === 'true';
  const tag = typeof req.query.tag === 'string' ? req.query.tag : '';
  // Archive view: ?status=dismissed or ?status=resolved. Anything else
  // falls through to the active inbox (the store's default filter).
  const statusQ = typeof req.query.status === 'string' ? req.query.status : '';
  const archiveView: 'dismissed' | 'resolved' | undefined =
    statusQ === 'dismissed' ? 'dismissed' : statusQ === 'resolved' ? 'resolved' : undefined;
  const { sort, dir } = parseSort(req);
  // Coerce the dashboard's broader InboxSortKey union (which still
  // carries the legacy 'source' option for back-compat) to the
  // store's sort vocabulary. Anything the store doesn't know falls
  // back to its default (priority semantics).
  const STORE_SORT_KEYS: ReadonlySet<string> = new Set(['priority', 'status', 'age', 'title', 'agent']);
  const storeSort = STORE_SORT_KEYS.has(sort) ? (sort as 'priority' | 'status' | 'age' | 'title' | 'agent') : 'priority';
  const rows = ctx.inboxStore ? ctx.inboxStore.list({
    q: q || undefined,
    starred: starred || undefined,
    tag: tag || undefined,
    status: archiveView,
    sort: storeSort,
    dir,
  }) : [];
  const allTags = ctx.inboxStore ? ctx.inboxStore.listAllTags() : [];
  // Compute per-row preview payloads in a single pass. Each call to
  // listResponses is a single SQLite roundtrip; for the default
  // page-size (≤200 rows) the cost is negligible. If pagination
  // grows the row count materially, fold this into a bulk store
  // helper that joins inbox_responses once.
  const previewPayloads = new Map<string, import('../views/inbox-list.js').InboxRowPreviewPayload>();
  if (ctx.inboxStore && rows.length > 0) {
    for (const r of rows) {
      const responses = ctx.inboxStore.listResponses(r.id);
      let latestResponse: { role: 'user' | 'triage' | 'system' | 'action'; body: string; createdAt: number } | undefined;
      let proposedCount = 0;
      let firstProposedAgentId: string | undefined;
      // Walk from newest to oldest. listResponses returns ascending
      // by created_at, so iterate in reverse.
      for (let i = responses.length - 1; i >= 0; i--) {
        const resp = responses[i];
        if (resp.role !== 'action' && !latestResponse) {
          latestResponse = { role: resp.role, body: resp.body, createdAt: resp.createdAt };
        }
        if (resp.role === 'action') {
          const meta = parseActionMeta(resp);
          if (meta?.status === 'proposed') {
            proposedCount += 1;
            if (!firstProposedAgentId) firstProposedAgentId = meta.agentId;
          }
        }
        // Early exit once we have both signals.
        if (latestResponse && proposedCount > 0) break;
      }
      previewPayloads.set(r.id, {
        latestResponse: latestResponse && latestResponse.role !== 'action'
          ? { role: latestResponse.role, body: latestResponse.body, createdAt: latestResponse.createdAt }
          : undefined,
        proposedActions: proposedCount > 0
          ? { count: proposedCount, firstAgentId: firstProposedAgentId }
          : undefined,
      });
    }
  }
  // terminalCount drives the "Inbox cleared" empty-state + the "View
  // N dismissed / resolved" archive-footer link. Only computed for
  // the active view — the archive view has its own header.
  let terminalCount = 0;
  if (!archiveView && ctx.inboxStore) {
    try {
      const dismissed = ctx.inboxStore.list({ status: 'dismissed' });
      const resolved = ctx.inboxStore.list({ status: 'resolved' });
      terminalCount = dismissed.length + resolved.length;
    } catch { /* swallow — empty count is harmless */ }
  }
  res.type('html').send(renderInboxList({
    rows, sort, dir, flash: parseFlash(req),
    filter: { q, starred, tag },
    allTags,
    terminalCount,
    archiveView,
    previewPayloads,
  }));
});

inboxRouter.get('/inbox/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!ctx.inboxStore) {
    res.status(404).type('html').send(renderNotFoundPage({
      path: req.originalUrl,
      message: 'Inbox is not available — the store failed to initialize.',
    }));
    return;
  }
  const message = ctx.inboxStore.get(id);
  if (!message) {
    res.status(404).type('html').send(renderNotFoundPage({
      path: req.originalUrl,
      message: `No inbox message with id "${id}".`,
    }));
    return;
  }
  const responses = ctx.inboxStore.listResponses(id);
  const triagePending = isTriagePending(ctx, message, responses);
  const currentTargetYaml = exportTargetAgentYaml(ctx, message.agentId);
  res.type('html').send(renderInboxDetail({ message, responses, flash: parseFlash(req), triagePending, currentTargetYaml }));
});

inboxRouter.get('/inbox/:id/fragment', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!ctx.inboxStore) {
    res.status(404).type('html').send('<p>Inbox unavailable.</p>');
    return;
  }
  const message = ctx.inboxStore.get(id);
  if (!message) {
    res.status(404).type('html').send('<p>Message not found.</p>');
    return;
  }
  const responses = ctx.inboxStore.listResponses(id);
  const triagePending = isTriagePending(ctx, message, responses);
  const currentTargetYaml = exportTargetAgentYaml(ctx, message.agentId);
  res.type('html').send(render(renderInboxDetailFragment({ message, responses, triagePending, currentTargetYaml })));
});

/**
 * POST /inbox/new — create an empty `source: manual` row so the
 * operator can start a fresh conversation. Returns the new id via
 * the `X-Inbox-Id` response header on AJAX (204); a plain form post
 * gets a 303 redirect to `/inbox/:id`. Triage does NOT auto-fire
 * here — it kicks in normally on the operator's first POST /respond.
 */
inboxRouter.post('/inbox/new', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.inboxStore) {
    if (isAjax(req)) { res.status(503).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Inbox unavailable.')}`);
    return;
  }
  const titleRaw = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const title = titleRaw.length > 0 ? titleRaw.slice(0, 200) : DEFAULT_NEW_CONVERSATION_TITLE;
  // body is required by the store; manual-source threads start blank,
  // so we seed with a small placeholder that's overwritten the moment
  // the operator's first /respond lands.
  try {
    const created = ctx.inboxStore.add({
      priority: 'medium',
      source: 'manual',
      title,
      body: '(empty)',
    });
    if (isAjax(req)) {
      res.setHeader('X-Inbox-Id', created.id);
      res.status(204).end();
      return;
    }
    res.redirect(303, `/inbox/${encodeURIComponent(created.id)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent(`Create failed: ${msg}`)}`);
  }
});

inboxRouter.post('/inbox/:id/dismiss', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  try {
    ctx.inboxStore.dismiss(id);
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `/inbox?ok=${encodeURIComponent('Dismissed.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `/inbox/${encodeURIComponent(id)}?error=${encodeURIComponent(`Dismiss failed: ${msg}`)}`);
  }
});

inboxRouter.post('/inbox/:id/respond', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const bodyRaw = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!bodyRaw) {
    if (isAjax(req)) { res.status(400).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent('Reply cannot be empty.')}`);
    return;
  }
  if (bodyRaw.length > 8192) {
    if (isAjax(req)) { res.status(400).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent('Reply is too long (max 8 KB).')}`);
    return;
  }
  let userResponse;
  try {
    userResponse = ctx.inboxStore.addResponse(id, 'user', bodyRaw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Reply failed: ${msg}`)}`);
    return;
  }
  // First reply on a manual-source thread still carrying the default
  // "New conversation" title? Auto-rename from the body so /inbox stops
  // showing a wall of identical row titles. Only triggers when there
  // were zero prior responses (this reply is the first), so subsequent
  // edits don't keep rewriting the title from each reply.
  const messageNow = ctx.inboxStore.get(id);
  if (messageNow
    && messageNow.source === 'manual'
    && messageNow.title === DEFAULT_NEW_CONVERSATION_TITLE
    && ctx.inboxStore.listResponses(id).filter((r) => r.id !== userResponse.id).length === 0) {
    try {
      ctx.inboxStore.updateTitle(id, deriveTitleFromBody(bodyRaw));
    } catch { /* ignore — title update is best-effort */ }
  }
  // Publish to the SSE bus so any modal subscribed to this thread
  // sees the persisted user reply within a network RTT. The fragment
  // poll fallback still works for clients that haven't subscribed.
  publishInboxEvent(ctx, id, 'message:created', {
    responseId: userResponse.id,
    role: 'user',
    body: bodyRaw,
    createdAt: userResponse.createdAt,
  });
  // Auto-fire triage. Fire-and-forget; the modal polls /fragment for
  // the response. The conversation thread itself signals "in progress"
  // via the user-reply-within-30s heuristic in isTriagePending.
  void runTriageAgent(ctx, id).catch(() => { /* logged in helper */ });

  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Reply added.')}`);
});

inboxRouter.post('/inbox/:id/triage', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  // Insert a synthetic user "Ask triage" marker so the conversation
  // shows what the operator just did. The triage agent receives the
  // updated CONVERSATION and responds.
  try {
    const marker = ctx.inboxStore.addResponse(id, 'user', '(Asked triage to take another look.)');
    publishInboxEvent(ctx, id, 'message:created', {
      responseId: marker.id,
      role: 'user',
      body: marker.body,
      createdAt: marker.createdAt,
    });
  } catch { /* swallow */ }
  void runTriageAgent(ctx, id).catch(() => { /* swallow */ });
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Triage agent invoked.')}`);
});

/**
 * POST /inbox/:id/triage/cancel — short-circuit an in-flight triage
 * run. Looks up the registered AbortController via
 * `ctx.inboxTriageAbortControllers` (keyed by message id), aborts the
 * DAG executor's signal, calls into `provider.cancelRun` as a belt-
 * and-suspenders for v1 paths, and force-finalizes the run row +
 * node executions if the executor didn't get to those teardown
 * steps before the response returns.
 *
 * Idempotent: a missing entry (run already finished, or the dashboard
 * was restarted) returns 204 / "Nothing to cancel" without erroring.
 * The operator sees the indicator clear via the `state:done` SSE
 * event that the runTriageAgent finally-block (or this route's
 * fallback finalization) publishes.
 */
inboxRouter.post('/inbox/:id/triage/cancel', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const entry = ctx.inboxTriageAbortControllers.get(id);
  if (!entry) {
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Nothing to cancel.')}`);
    return;
  }
  ctx.inboxTriageAbortControllers.delete(id);
  ctx.activeRuns.delete(entry.runId);
  try { entry.controller.abort(); } catch { /* ignore */ }
  // Provider cancel — belt-and-suspenders for v1 paths and any
  // pid-tracked child processes the executor spawned.
  try { await ctx.provider.cancelRun(entry.runId); } catch { /* ignore */ }
  // Force-finalize the run + any node executions still flagged
  // running, in case the executor's normal teardown didn't fire
  // before the request returns. Mirrors POST /runs/:id/cancel.
  try {
    const run = ctx.runStore.getRun(entry.runId);
    if (run && (run.status === 'running' || run.status === 'pending')) {
      const completedAt = new Date().toISOString();
      ctx.runStore.updateRun(entry.runId, {
        status: 'cancelled' as RunStatus,
        completedAt,
        error: 'Cancelled by user.',
      });
      const nodeExecs = ctx.runStore.listNodeExecutions(entry.runId);
      for (const exec of nodeExecs) {
        if (exec.status === 'running' || exec.status === 'pending') {
          ctx.runStore.updateNodeExecution(entry.runId, exec.nodeId, {
            status: 'cancelled',
            errorCategory: 'cancelled',
            completedAt,
            error: 'Cancelled by user.',
          });
        }
      }
    }
  } catch { /* ignore */ }
  // Surface the cancellation in the conversation so the operator
  // sees what happened without polling. The next user reply will
  // re-fire triage normally.
  try {
    const sysReply = ctx.inboxStore.addResponse(id, 'system', 'Triage agent cancelled.');
    publishInboxEvent(ctx, id, 'message:created', {
      responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
    });
  } catch { /* ignore */ }
  publishInboxEvent(ctx, id, 'state', { phase: 'done', since: Date.now() });
  // Move the thread to awaiting_user so the modal's pending state
  // clears and the composer re-enables.
  try {
    ctx.inboxStore.updateStatus(id, 'awaiting_user');
  } catch { /* ignore */ }

  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Triage stopped.')}`);
});

/**
 * POST /inbox/:id/star — toggle the star flag. Body: `starred=1|0`
 * (defaults to flipping the current value when absent). Returns 204
 * for AJAX, 303 for plain form posts (always back to /inbox so the
 * list reflects the new starred-sort position).
 */
inboxRouter.post('/inbox/:id/star', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!ctx.inboxStore) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Inbox unavailable.')}`);
    return;
  }
  const message = ctx.inboxStore.get(id);
  if (!message) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const next = typeof req.body?.starred === 'string'
    ? (req.body.starred === '1' || req.body.starred === 'true')
    : !message.starred;
  try {
    ctx.inboxStore.setStarred(id, next);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `/inbox/${encodeURIComponent(id)}?error=${encodeURIComponent(`Star failed: ${msg}`)}`);
    return;
  }
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `/inbox?ok=${encodeURIComponent(next ? 'Starred.' : 'Unstarred.')}`);
});

/**
 * POST /inbox/:id/tags — replace the message's tag set. Body: `tags`
 * is a comma-separated string ("auth, network"). Empty → clears all
 * tags. Invalid tags are silently dropped by the store. 204 for
 * AJAX, 303 for plain form.
 */
inboxRouter.post('/inbox/:id/tags', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const raw = typeof req.body?.tags === 'string' ? req.body.tags : '';
  const tags = raw.split(',').map((t: string) => t.trim()).filter(Boolean);
  try {
    ctx.inboxStore.setTags(id, tags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Tags failed: ${msg}`)}`);
    return;
  }
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Tags updated.')}`);
});

/**
 * POST /inbox/:id/actions/:rid/run — execute a proposed sub-agent
 * action. Loads the `action`-role response, verifies it's still in
 * `proposed` state, runs the target agent via executeAgentDag, then
 * patches the row through running → completed/failed. When all
 * non-skipped actions for this message are in a terminal state, fires
 * a follow-up triage turn so the agent can summarize what came back.
 */
inboxRouter.post('/inbox/:id/actions/:rid/run', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rid = Array.isArray(req.params.rid) ? req.params.rid[0] : req.params.rid;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const response = ctx.inboxStore.getResponse(rid);
  const meta = response ? parseActionMeta(response) : null;
  // No row, wrong message, or not an action → genuinely can't run.
  if (!response || response.messageId !== id || !meta) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent('Action not found.')}`);
    return;
  }
  // Idempotent: already running or already terminal — treat the click
  // as a "we heard you" no-op. The modal is polling and the action
  // card reflects its current state. Returning 204/303 keeps the
  // operator experience forgiving: rage-clicking the Run button can't
  // fire the sub-agent twice and can't surface error toasts.
  if (meta.status !== 'proposed') {
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Already in progress.')}`);
    return;
  }

  // Atomically claim the action: proposed → running. If a concurrent
  // request beat us to it the UPDATE's status WHERE clause fails to
  // match — same idempotent treatment as the check above (the action
  // is now running on someone else's behalf; we're done).
  const startedAt = Date.now();
  const runningMeta: InboxActionMeta = { ...meta, status: 'running', startedAt };
  const claimed = ctx.inboxStore.transitionActionStatus(rid, 'proposed', JSON.stringify(runningMeta));
  if (!claimed) {
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Already in progress.')}`);
    return;
  }
  publishInboxEvent(ctx, id, 'action:status', {
    responseId: rid,
    status: 'running',
    agentId: meta.agentId,
    startedAt,
  });

  if (isAjax(req)) { res.status(204).end(); }
  // Fire-and-forget; the modal polls /fragment for state.
  void runProposedAction(ctx, id, response, runningMeta).catch((err) => {
    process.stderr.write(`[inbox-triage] action ${rid} crashed: ${(err as Error)?.message ?? err}\n`);
  });
  if (!isAjax(req)) {
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Action started.')}`);
  }
});

/**
 * POST /inbox/:id/actions/:rid/skip — mark a proposed action as
 * skipped. The operator chose not to run it. No re-fire of triage —
 * skipping is the "no thanks" signal; if every action gets skipped,
 * we let the conversation rest unless the operator asks again.
 */
inboxRouter.post('/inbox/:id/actions/:rid/skip', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rid = Array.isArray(req.params.rid) ? req.params.rid[0] : req.params.rid;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const response = ctx.inboxStore.getResponse(rid);
  const meta = response ? parseActionMeta(response) : null;
  if (!response || response.messageId !== id || !meta) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent('Action not found.')}`);
    return;
  }
  // Idempotent: already skipped or already past the proposed window
  // (running / completed / failed) → no-op, no error. Skipping a
  // running action is intentionally a no-op (would race with the
  // sub-agent); operator can dismiss the message instead.
  if (meta.status !== 'proposed') {
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Action is no longer pending.')}`);
    return;
  }
  // Atomic claim — same race-free transition as /run uses.
  const skippedMeta: InboxActionMeta = { ...meta, status: 'skipped', endedAt: Date.now() };
  const claimed = ctx.inboxStore.transitionActionStatus(rid, 'proposed', JSON.stringify(skippedMeta));
  if (!claimed) {
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Action is no longer pending.')}`);
    return;
  }
  publishInboxEvent(ctx, id, 'action:status', {
    responseId: rid,
    status: 'skipped',
    agentId: meta.agentId,
    endedAt: skippedMeta.endedAt,
  });
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Skipped.')}`);
});

// ── helpers ─────────────────────────────────────────────────────────

/**
 * Triage is "pending" — and the modal should keep polling — if any of:
 *   (a) the message has a triageRunId whose run is in flight,
 *   (b) the most recent response is from the user, posted in the
 *       last 30 seconds, with no later triage / system / action reply
 *       (covers the race between POST /respond returning 204 and the
 *       dag-executor inserting its run-store row), or
 *   (c) any `action`-role response on this message is in `running`
 *       state (the sub-agent is mid-flight; updates land via
 *       updateResponse and the modal should re-render).
 */
function isTriagePending(
  ctx: ReturnType<typeof getContext>,
  message: { triageRunId?: string },
  responses: InboxResponse[],
): boolean {
  if (message.triageRunId) {
    try {
      const run = ctx.runStore.getRun(message.triageRunId);
      if (run && (run.status === 'pending' || run.status === 'running')) return true;
    } catch { /* ignore */ }
  }
  for (const r of responses) {
    if (r.role !== 'action') continue;
    const meta = parseActionMeta(r);
    if (meta?.status === 'running') return true;
  }
  if (responses.length === 0) return false;
  const last = responses[responses.length - 1];
  if (last.role !== 'user') return false;
  return Date.now() - last.createdAt < PENDING_USER_REPLY_WINDOW_MS;
}

/**
 * Parse the `meta_json` payload of an `action`-role response. Returns
 * null when the row isn't an action or the meta is missing / malformed —
 * callers treat that as "not an actionable action."
 */
function parseActionMeta(r: InboxResponse): InboxActionMeta | null {
  if (r.role !== 'action' || !r.metaJson) return null;
  try {
    const parsed = JSON.parse(r.metaJson) as Partial<InboxActionMeta>;
    if (parsed && parsed.kind === 'action' && typeof parsed.agentId === 'string' && typeof parsed.status === 'string') {
      return parsed as InboxActionMeta;
    }
  } catch { /* swallow */ }
  return null;
}

/**
 * Build the effective allowlist of sub-agent ids triage may propose
 * running. For entries not yet installed, attempt a one-shot import
 * from `agents/examples/<id>.yaml` (same pattern the analyze route uses
 * for agent-analyzer). Entries that can't be imported are silently
 * dropped — the prompt never sees them, so triage can't propose them.
 */
/**
 * Auto-install OR auto-refresh a single system agent from its
 * bundled `agents/examples/<id>.yaml`. Returns true when the agent
 * exists in the store after the call (whether imported, refreshed,
 * or already current); false when the disk YAML is missing or
 * unparseable. Scoped to system agents only — `inbox-triage` itself
 * plus everything in TRIAGE_SUB_AGENT_ALLOWLIST. User agents are
 * never touched by this path.
 *
 * Refresh trigger: the installed exported YAML differs from the
 * bundled one. The diff catches prompt updates (e.g. PR #395's
 * VOICE section on inbox-triage) plus structural changes (e.g.
 * PR #394's preflight node on agent-analyzer).
 */
function ensureSystemAgentCurrent(
  ctx: ReturnType<typeof getContext>,
  id: string,
  context: string,
): boolean {
  try {
    const yamlPath = join(resolve(ALLOWLIST_AUTOIMPORT_DIR), `${id}.yaml`);
    const yamlText = readFileSync(yamlPath, 'utf-8');
    const parsed = parseAgent(yamlText);
    const installed = ctx.agentStore.getAgent(id);
    const needsImport = !installed;
    const needsRefresh = installed && exportAgent(installed) !== exportAgent(parsed);
    if (needsImport || needsRefresh) {
      ctx.agentStore.upsertAgent(parsed, 'import', needsImport
        ? `Auto-imported for ${context}`
        : 'Auto-refreshed from agents/examples/ (bundled YAML changed)');
    }
    return ctx.agentStore.getAgent(id) !== undefined;
  } catch {
    return false;
  }
}

function getSubAgentAllowlist(ctx: ReturnType<typeof getContext>): string[] {
  // Per-agent override on inbox-triage. When the operator has edited
  // the agent's `allowedSubAgents` list via /agents/inbox-triage/config,
  // that wins over the hardcoded fallback. Empty array = "text-only,
  // no sub-agents allowed." Undefined = use the platform default
  // (auto-installable system agents).
  const triage = ctx.agentStore.getAgent(TRIAGE_AGENT_ID);
  const operatorOverride = triage?.allowedSubAgents;
  if (operatorOverride !== undefined) {
    // Operator-set list: only surface ids that are actually installed.
    // Unlike the system-default path we do NOT auto-import here —
    // operator-listed entries are assumed to be user agents already
    // sitting in the store.
    return operatorOverride.filter((id) => ctx.agentStore.getAgent(id) !== undefined);
  }
  const available: string[] = [];
  for (const id of TRIAGE_SUB_AGENT_ALLOWLIST) {
    if (ensureSystemAgentCurrent(ctx, id, 'inbox triage allowlist')) {
      available.push(id);
    }
  }
  return available;
}

/**
 * Export the YAML of the agent referenced by `agentId` (the inbox
 * message's target). The detail view passes this into the diff
 * renderer so `agent-editor` action cards can show old-vs-new.
 * Returns undefined when there's no target or the agent isn't
 * installed — the view falls back to rendering just inputs.
 */
function exportTargetAgentYaml(
  ctx: ReturnType<typeof getContext>,
  agentId: string | undefined,
): string | undefined {
  if (!agentId) return undefined;
  const target = ctx.agentStore.getAgent(agentId);
  if (!target) return undefined;
  try { return exportAgent(target); } catch { return undefined; }
}

/**
 * For agent-analyzer specifically: auto-inject AGENT_YAML (and
 * LAST_RUN_OUTPUT when available) so triage doesn't have to thread
 * the full YAML string through its <plan>. Mirrors the analyze
 * route's input shape at run-now-build.ts:441-489 but stripped down
 * (no DISCOVERY_CATALOG yet — that needs the tools/templates registry
 * and we keep this PR focused on the inbox plumbing).
 *
 * Returns a new inputs object; the original is not mutated. When the
 * inbox message has no `agentId`, the function returns the inputs
 * unchanged and execution proceeds — agent-analyzer will fail loudly
 * on the missing required AGENT_YAML, surfaced via the action's
 * `failed` state in the conversation thread.
 */
function enrichAgentAnalyzerInputs(
  ctx: ReturnType<typeof getContext>,
  messageAgentId: string | undefined,
  inputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...inputs };
  if (!out.AGENT_YAML && messageAgentId) {
    const target = ctx.agentStore.getAgent(messageAgentId);
    if (target) {
      try { out.AGENT_YAML = exportAgent(target); } catch { /* swallow */ }
    }
  }
  if (!out.LAST_RUN_OUTPUT && messageAgentId) {
    const summary = collectRunSummary(ctx, messageAgentId);
    if (summary) out.LAST_RUN_OUTPUT = summary;
  }
  return out;
}

/**
 * Inject `AGENT_CATALOG` into agent-catalog-search inputs: a JSON array
 * of installed-agent metadata (id, name, description, tags, source,
 * status) excluding system/scaffolding agents. The catalog-search
 * agent's prompt also self-filters, but stripping here saves prompt
 * tokens and prevents the LLM from accidentally proposing a system
 * agent even on edge cases.
 */
function enrichAgentCatalogSearchInputs(
  ctx: ReturnType<typeof getContext>,
  inputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...inputs };
  if (out.AGENT_CATALOG && out.AGENT_CATALOG.trim().length > 0) return out;
  try {
    const agents = ctx.agentStore.listAgents();
    const catalog = agents
      .filter((a) => !SYSTEM_AGENT_IDS.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description ?? '',
        tags: a.tags ?? [],
        source: a.source,
        status: a.status,
      }));
    out.AGENT_CATALOG = JSON.stringify(catalog);
  } catch { /* swallow — empty catalog still lets the agent respond "no matches" */ }
  return out;
}

/**
 * Inject `AVAILABLE_TOOLS` + `DISCOVERY_CATALOG` into agent-builder
 * inputs. Both are required by `agents/examples/agent-builder.yaml`'s
 * design node; the operator-facing "Build from goal" flow at
 * `run-now-build.ts:340-348` already supplies them and we mirror its
 * input shape here so a triage-dispatched agent-builder run sees the
 * same catalog the dashboard's button-driven flow does.
 *
 * Preserves any caller-supplied values (triage occasionally passes a
 * narrowed FOCUS; never the registries). Falls back to whatever the
 * stores expose — empty strings are acceptable inputs and the agent
 * gracefully degrades when a catalog is missing.
 */
function enrichAgentBuilderInputs(
  ctx: ReturnType<typeof getContext>,
  inputs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...inputs };
  try {
    const builtins = listBuiltinTools();
    let userTools: ToolDefinition[] = [];
    try {
      if (ctx.toolStore) userTools = ctx.toolStore.listTools();
    } catch { /* store not available */ }
    const allTools = [...builtins, ...userTools];
    if (!out.AVAILABLE_TOOLS) {
      out.AVAILABLE_TOOLS = formatToolCatalog(allTools);
    }
    if (!out.DISCOVERY_CATALOG) {
      out.DISCOVERY_CATALOG = buildDiscoveryCatalog({
        agents: ctx.agentStore.listAgents(),
        tools: allTools,
        templateRegistry: TEMPLATE_REGISTRY,
        dashboards: ctx.dashboardsStore?.listDashboards(),
        packs: ctx.packsStore?.listPacks(),
      });
    }
  } catch { /* swallow — agent-builder validates inputs and will fail loudly */ }
  return out;
}

/**
 * Distilled version of run-now-build.ts's run-output collector:
 * grab the latest completed run's result + the latest failed run's
 * error/output, cap at 3000 chars. Empty string when neither exists.
 */
function collectRunSummary(
  ctx: ReturnType<typeof getContext>,
  agentName: string,
): string {
  let out = '';
  try {
    const completed = ctx.runStore.listRuns({ agentName, status: 'completed', limit: 1 });
    if (completed.length > 0 && completed[0].result) {
      const raw = completed[0].result;
      out = raw.length > 2000 ? raw.slice(0, 2000) + '\n...(truncated)' : raw;
    }
    const failed = ctx.runStore.listRuns({ agentName, status: 'failed', limit: 1 });
    if (failed.length > 0) {
      const f = failed[0];
      const failedAt = f.completedAt ?? f.startedAt;
      const completedAt = completed[0]?.completedAt ?? '';
      if (!completedAt || failedAt > completedAt) {
        const parts = [
          `\n\nMOST RECENT RUN FAILED (${f.id.slice(0, 8)}):`,
          f.error ? `Error: ${f.error}` : '',
          f.result ? `Output: ${f.result.slice(0, 1000)}` : '',
        ].filter(Boolean);
        out += parts.join('\n');
      }
    }
  } catch { /* swallow */ }
  return out.length > 3000 ? out.slice(0, 3000) + '\n...(truncated)' : out;
}

/**
 * Parse + validate the `actions` field from a triage `<plan>` block.
 * Returns valid action proposals + the rejected ones (with a reason)
 * so the route can surface refusals as `system` responses in the
 * conversation. Unknown agent ids fall into rejected.
 */
function parseProposedActions(
  rawActions: unknown,
  allowlist: readonly string[],
): { accepted: InboxActionMeta[]; rejected: { agentId: string; reason: string }[] } {
  const accepted: InboxActionMeta[] = [];
  const rejected: { agentId: string; reason: string }[] = [];
  if (!Array.isArray(rawActions)) return { accepted, rejected };
  const allowSet = new Set(allowlist);
  for (const entry of rawActions.slice(0, 3)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const type = typeof e.type === 'string' ? e.type : '';
    const agentId = typeof e.agentId === 'string' ? e.agentId : '';
    if (type !== 'run-agent' || !agentId) {
      rejected.push({ agentId: agentId || '<unknown>', reason: 'malformed action entry' });
      continue;
    }
    if (!allowSet.has(agentId)) {
      rejected.push({ agentId, reason: 'not in ALLOWED_SUB_AGENTS' });
      continue;
    }
    const inputs: Record<string, string> = {};
    if (e.inputs && typeof e.inputs === 'object' && !Array.isArray(e.inputs)) {
      for (const [k, v] of Object.entries(e.inputs as Record<string, unknown>)) {
        if (typeof k === 'string' && typeof v === 'string') inputs[k] = v;
      }
    }
    const rationale = typeof e.rationale === 'string' ? e.rationale.trim() : undefined;
    accepted.push({
      kind: 'action',
      status: 'proposed',
      agentId,
      inputs,
      rationale: rationale || undefined,
    });
  }
  return { accepted, rejected };
}

/**
 * Execute a single proposed action: walks meta through `running`,
 * dispatches `executeAgentDag` on the sub-agent, then patches meta to
 * `completed | failed` with run lineage + a short result preview. When
 * all proposed actions on the parent message have resolved (any
 * non-`proposed` state) AND at least one ran, re-fire triage so it can
 * summarize the outcome in the conversation.
 */
async function runProposedAction(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  response: InboxResponse,
  meta: InboxActionMeta,
): Promise<void> {
  if (!ctx.inboxStore) return;

  // The route handler already transitioned proposed → running
  // atomically (see /actions/:rid/run); meta passed in already
  // carries status='running' + startedAt.
  const startedAt = meta.startedAt ?? Date.now();

  // Route-handled agents (e.g. agent-editor) perform their side
  // effect synchronously inside the route — no DAG dispatch. The
  // YAML on disk for these agents is a stub that documents the
  // contract; the actual write happens here.
  if (ROUTE_HANDLED_AGENTS.has(meta.agentId)) {
    const result = await executeRouteHandledAgent(ctx, messageId, meta);
    const endedAt = Date.now();
    ctx.inboxStore.updateResponse(response.id, {
      metaJson: JSON.stringify({
        ...meta,
        status: result.status,
        startedAt,
        endedAt,
        resultSummary: result.summary,
        refusalReason: result.refusalReason,
      }),
    });
    publishInboxEvent(ctx, messageId, 'action:status', {
      responseId: response.id,
      status: result.status,
      agentId: meta.agentId,
      startedAt,
      endedAt,
      resultSummary: result.summary,
      refusalReason: result.refusalReason,
    });
    maybeRefireTriage(ctx, messageId);
    return;
  }

  const subAgent = ctx.agentStore.getAgent(meta.agentId);
  if (!subAgent) {
    const endedAt = Date.now();
    const refusalReason = `Agent "${meta.agentId}" is not installed.`;
    ctx.inboxStore.updateResponse(response.id, {
      metaJson: JSON.stringify({
        ...meta,
        status: 'failed',
        endedAt,
        refusalReason,
      }),
    });
    publishInboxEvent(ctx, messageId, 'action:status', {
      responseId: response.id,
      status: 'failed',
      agentId: meta.agentId,
      endedAt,
      refusalReason,
    });
    return;
  }

  // Per-agent input enrichment. Triage's prompt context can't carry
  // heavyweight inputs (full agent YAMLs, catalog snapshots), so we
  // inject them here at action-run time based on agentId.
  //
  // Pre-flight the analyzer dispatch: if the inbox message's
  // referenced agent isn't installed locally, enrichment will leave
  // AGENT_YAML empty and the analyzer dies at input resolution with a
  // generic "Missing required input" — confusing for the operator
  // because it looks like a triage / analyzer bug rather than the
  // real cause (target agent not in the catalog). Refuse the dispatch
  // up front with a clear conversation message instead.
  let effectiveInputs = meta.inputs;
  if (meta.agentId === 'agent-analyzer') {
    const parentMessage = ctx.inboxStore.get(messageId);
    const targetAgentId = parentMessage?.agentId;
    if (targetAgentId && !ctx.agentStore.getAgent(targetAgentId)) {
      const reason = `Can't dispatch agent-analyzer — the target agent "${targetAgentId}" is not installed in this catalog. Install it (e.g. from agents/examples or via the Agents → Import page) and try again.`;
      const endedAt = Date.now();
      ctx.inboxStore.updateResponse(response.id, {
        metaJson: JSON.stringify({
          ...meta,
          status: 'failed',
          startedAt,
          endedAt,
          refusalReason: reason,
        }),
      });
      publishInboxEvent(ctx, messageId, 'action:status', {
        responseId: response.id,
        status: 'failed',
        agentId: meta.agentId,
        startedAt,
        endedAt,
        refusalReason: reason,
      });
      const sysReply = ctx.inboxStore.addResponse(messageId, 'system', reason);
      publishInboxEvent(ctx, messageId, 'message:created', {
        responseId: sysReply.id,
        role: 'system',
        body: reason,
        createdAt: sysReply.createdAt,
      });
      maybeRefireTriage(ctx, messageId);
      return;
    }
    effectiveInputs = enrichAgentAnalyzerInputs(ctx, targetAgentId, meta.inputs);
  } else if (meta.agentId === 'agent-catalog-search') {
    effectiveInputs = enrichAgentCatalogSearchInputs(ctx, meta.inputs);
  } else if (meta.agentId === 'agent-builder') {
    effectiveInputs = enrichAgentBuilderInputs(ctx, meta.inputs);
  }

  let runId: string | undefined;
  let nextStatus: InboxActionStatus = 'failed';
  let resultSummary: string | undefined;
  let refusalReason: string | undefined;
  let fullResult = '';
  try {
    const run = await executeAgentDag(
      subAgent,
      {
        triggeredBy: 'dashboard',
        inputs: effectiveInputs,
      },
      {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot,
        llmSettings: buildLlmSettingsSnapshot(ctx),
      },
    );
    runId = run.id;
    if (run.status === 'completed') {
      nextStatus = 'completed';
      fullResult = typeof run.result === 'string' ? run.result : '';
      resultSummary = fullResult.length > ACTION_RESULT_PREVIEW_LIMIT
        ? fullResult.slice(0, ACTION_RESULT_PREVIEW_LIMIT) + '…'
        : fullResult;
    } else {
      nextStatus = 'failed';
      refusalReason = run.error ?? `Run ended in status ${run.status}.`;
    }
  } catch (err) {
    nextStatus = 'failed';
    refusalReason = err instanceof Error ? err.message : String(err);
  }
  const endedAt = Date.now();
  ctx.inboxStore.updateResponse(response.id, {
    metaJson: JSON.stringify({
      ...meta,
      status: nextStatus,
      startedAt,
      endedAt,
      runId,
      resultSummary,
      refusalReason,
    }),
  });
  publishInboxEvent(ctx, messageId, 'action:status', {
    responseId: response.id,
    status: nextStatus,
    agentId: meta.agentId,
    startedAt,
    endedAt,
    runId,
    resultSummary,
    refusalReason,
  });

  // After agent-analyzer completes successfully, look for a
  // `<yaml>...</yaml>` block in the `analyze` (or `fix`) node output —
  // NOT the run-level result, which is the trailing `validate` shell
  // node's `{valid:true}` JSON. If present + valid + targeting the
  // inbox message's agent, auto-propose an agent-editor action card
  // with the parsed YAML.
  if (meta.agentId === 'agent-analyzer' && nextStatus === 'completed' && runId) {
    maybeAutoProposeEditorAction(ctx, messageId, runId);
  }

  maybeRefireTriage(ctx, messageId);
}

/**
 * Maximum number of consecutive auto-fired triage turns between
 * operator interventions. Each completed sub-agent action triggers a
 * triage refire (so triage can summarize what came back); if triage
 * then proposes another auto-approved action that completes, that's
 * another refire, etc. The cap prevents a runaway loop when triage
 * keeps proposing actions on its own. Reset when the operator posts
 * a user response.
 *
 * 5 is a comfortable headroom for analyzer → editor → catalog-search
 * chains while still catching pathological loops within a few turns.
 */
const MAX_AUTO_TRIAGE_TURNS = 5;

/**
 * Count the number of `triage` responses since the most recent `user`
 * response (or message creation if no user reply yet). Drives the
 * auto-refire cap — the operator hitting Reply resets the counter so
 * fresh user input always gets a fresh budget.
 */
function countConsecutiveTriageTurns(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): number {
  if (!ctx.inboxStore) return 0;
  const responses = ctx.inboxStore.listResponses(messageId);
  let count = 0;
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const r = responses[i];
    if (r.role === 'user') break;
    if (r.role === 'triage') count += 1;
  }
  return count;
}

/** Hoisted from the end of `runProposedAction` so route-handled and
 *  DAG-dispatched paths share the same re-fire trigger.
 *
 *  Layer 3 of the triage follow-through plan: when a sub-agent action
 *  completes and resolves all outstanding actions on the thread,
 *  re-invoke triage so it can summarize the result and either propose
 *  the next step, mark `awaiting_user`, or mark resolved. The
 *  CONVERSATION snapshot already includes each action's status +
 *  resultSummary, so triage sees what came back without any new
 *  input plumbing.
 *
 *  The cap (MAX_AUTO_TRIAGE_TURNS) prevents runaway loops. When hit,
 *  we post a system note + mark the thread awaiting_user so the
 *  operator can decide whether to continue. */
function maybeRefireTriage(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): void {
  if (!ctx.inboxStore) return;
  if (!(allActionsResolved(ctx, messageId) && atLeastOneActionExecuted(ctx, messageId))) return;
  if (countConsecutiveTriageTurns(ctx, messageId) >= MAX_AUTO_TRIAGE_TURNS) {
    const note = `Auto-follow-up paused after ${MAX_AUTO_TRIAGE_TURNS} consecutive triage turns. Reply or dismiss to continue.`;
    const sysReply = ctx.inboxStore.addResponse(messageId, 'system', note);
    publishInboxEvent(ctx, messageId, 'message:created', {
      responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
    });
    try {
      ctx.inboxStore.updateStatus(messageId, 'awaiting_user');
    } catch { /* ignore */ }
    publishInboxEvent(ctx, messageId, 'state', { phase: 'done', since: Date.now() });
    return;
  }
  void runTriageAgent(ctx, messageId).catch(() => { /* swallow */ });
}

/**
 * Synchronous executor for agents listed in `ROUTE_HANDLED_AGENTS`.
 * Today that's just `agent-editor`, which commits a YAML change via
 * `agentStore.upsertAgent` after validation. Returns the action's
 * terminal status + a summary line for the conversation thread.
 */
async function executeRouteHandledAgent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  meta: InboxActionMeta,
): Promise<{ status: InboxActionStatus; summary?: string; refusalReason?: string }> {
  if (meta.agentId === 'agent-editor') {
    return executeAgentEditor(ctx, messageId, meta);
  }
  return {
    status: 'failed',
    refusalReason: `Route-handled agent "${meta.agentId}" has no executor.`,
  };
}

/**
 * Apply a YAML change to an existing agent. Validates:
 *   - `AGENT_ID` input is present
 *   - `NEW_YAML` parses cleanly via `parseAgent`
 *   - parsed `id` matches `AGENT_ID` (prevents accidentally targeting
 *     the wrong agent if triage hallucinates an id mismatch)
 *
 * On success commits via `agentStore.upsertAgent` (creates a new
 * version — undo via the agent detail page). On failure leaves the
 * agent untouched and surfaces the reason in the action card.
 */
function executeAgentEditor(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  meta: InboxActionMeta,
): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  void messageId;
  const agentId = meta.inputs.AGENT_ID;
  const newYaml = meta.inputs.NEW_YAML;
  if (!agentId || !newYaml) {
    return {
      status: 'failed',
      refusalReason: 'agent-editor requires both AGENT_ID and NEW_YAML inputs.',
    };
  }
  let parsed;
  try {
    parsed = parseAgent(newYaml);
  } catch (err) {
    return {
      status: 'failed',
      refusalReason: `NEW_YAML failed validation: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed.id !== agentId) {
    return {
      status: 'failed',
      refusalReason: `NEW_YAML parsed id "${parsed.id}" does not match AGENT_ID "${agentId}". Refusing the edit.`,
    };
  }
  try {
    ctx.agentStore.upsertAgent(parsed, 'dashboard', 'Inbox triage applied YAML fix');
  } catch (err) {
    return {
      status: 'failed',
      refusalReason: `upsertAgent failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const after = ctx.agentStore.getAgent(agentId);
  const version = after?.version ?? '?';
  return {
    status: 'completed',
    summary: `Updated agent \`${agentId}\` to v${version}.`,
  };
}

/**
 * Extract a `<yaml>...</yaml>` block from agent-analyzer's run
 * result, validate it, and (if it targets the inbox message's agent)
 * auto-insert a proposed `agent-editor` action card. Silently no-ops
 * if no yaml block is present, if it doesn't parse, if it targets a
 * different agent, or if the per-message action cap has been hit.
 */
function maybeAutoProposeEditorAction(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  analyzerRunId: string,
): void {
  if (!ctx.inboxStore) return;
  // The analyzer DAG ends in a `validate` shell node whose tiny
  // {valid:true} output overshadows the LLM's full response at the
  // run-level `.result`. The actual YAML lives in the `analyze` or
  // `fix` node's output. Prefer `fix` (later in the chain, runs only
  // when validate found issues) over `analyze`.
  const execs = ctx.runStore.listNodeExecutions(analyzerRunId);
  const fix = execs.find((e) => e.nodeId === 'fix' && e.status === 'completed');
  const analyze = execs.find((e) => e.nodeId === 'analyze' && e.status === 'completed');
  const source = (fix?.result ?? analyze?.result ?? '').toString();
  const match = source.match(/<yaml>\s*\n?([\s\S]*?)<\/yaml>/);
  if (!match) return;
  const proposedYaml = match[1].trim();
  if (proposedYaml.length < 10) return;
  let parsed;
  try { parsed = parseAgent(proposedYaml); } catch { return; }

  const message = ctx.inboxStore.get(messageId);
  if (!message?.agentId || parsed.id !== message.agentId) return;

  // Respect the cap so a chatty analyzer can't fan out unbounded edits.
  if (countActionsOnMessage(ctx, messageId) >= MAX_ACTIONS_PER_MESSAGE) return;

  // Avoid duplicate proposals if the same YAML was already proposed
  // and is still pending — operator might be mid-decision.
  for (const r of ctx.inboxStore.listResponses(messageId)) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    if (m && m.agentId === 'agent-editor'
      && (m.status === 'proposed' || m.status === 'running')
      && m.inputs.NEW_YAML === proposedYaml) return;
  }

  const action: InboxActionMeta = {
    kind: 'action',
    status: 'proposed',
    agentId: 'agent-editor',
    inputs: { AGENT_ID: message.agentId, NEW_YAML: proposedYaml },
    rationale: `Apply the YAML fix that agent-analyzer produced.`,
  };
  const editorResp = ctx.inboxStore.addResponse(
    messageId,
    'action',
    action.rationale!,
    JSON.stringify(action),
  );
  publishInboxEvent(ctx, messageId, 'action:created', {
    responseId: editorResp.id,
    agentId: action.agentId,
    rationale: action.rationale,
    inputs: action.inputs,
    createdAt: editorResp.createdAt,
  });
}

function allActionsResolved(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): boolean {
  if (!ctx.inboxStore) return false;
  const responses = ctx.inboxStore.listResponses(messageId);
  for (const r of responses) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    if (m && (m.status === 'proposed' || m.status === 'running')) return false;
  }
  return true;
}

function atLeastOneActionExecuted(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): boolean {
  if (!ctx.inboxStore) return false;
  const responses = ctx.inboxStore.listResponses(messageId);
  for (const r of responses) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    if (m && (m.status === 'completed' || m.status === 'failed')) return true;
  }
  return false;
}

/**
 * Count `action`-role responses for a message regardless of status.
 * Used to enforce MAX_ACTIONS_PER_MESSAGE — once we've fanned out N
 * actions on a single thread, refuse new proposals as a runaway
 * guard.
 */
function countActionsOnMessage(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): number {
  if (!ctx.inboxStore) return 0;
  let n = 0;
  for (const r of ctx.inboxStore.listResponses(messageId)) {
    if (r.role === 'action') n++;
  }
  return n;
}

/**
 * Spawn the inbox-triage system agent for a message. Lazy-installs the
 * YAML on first call (mirrors layout-planner). After the run
 * completes, parses the `<plan>{...}</plan>` block and appends a
 * `triage`-role response to the conversation. Sets the message
 * status to `awaiting_user` so subsequent renders carry the
 * recommendation context.
 */
async function runTriageAgent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): Promise<void> {
  if (!ctx.inboxStore) return;
  const message = ctx.inboxStore.get(messageId);
  if (!message) return;

  // Auto-install + auto-refresh inbox-triage from the bundled YAML.
  // Pre-PR #399 this only handled the install case — operators who
  // installed inbox-triage before PR #395's VOICE-section update kept
  // emitting stage directions ("Reply with X: ...") in every triage
  // turn because the older prompt was still cached in the store.
  // Reuses the same diff-and-refresh helper that
  // getSubAgentAllowlist uses for the sub-agent allowlist.
  if (!ensureSystemAgentCurrent(ctx, TRIAGE_AGENT_ID, 'inbox triage')) {
    process.stderr.write(
      `[inbox-triage] could not load agent yaml from agents/examples/${TRIAGE_AGENT_ID}.yaml\n`,
    );
    return;
  }
  const triage = ctx.agentStore.getAgent(TRIAGE_AGENT_ID);
  if (!triage) return;

  // SSE: announce the thinking phase so connected clients can show
  // the witty waiting label immediately, without waiting for the
  // 1.5s poll heuristic to flip the indicator on.
  publishInboxEvent(ctx, messageId, 'triage:started', {});
  publishInboxEvent(ctx, messageId, 'state', { phase: 'thinking', since: Date.now() });

  // Build conversation snapshot for the prompt. For action-role rows,
  // include the structured status so the model can see what already
  // ran rather than just the rationale body.
  const conversation = ctx.inboxStore.listResponses(messageId)
    .map((r) => {
      if (r.role === 'action') {
        const m = parseActionMeta(r);
        const suffix = m ? ` (status=${m.status}${m.resultSummary ? `; result=${m.resultSummary.slice(0, 200)}` : ''})` : '';
        return `[action] ${r.body}${suffix}`;
      }
      return `[${r.role}] ${r.body}`;
    })
    .join('\n');

  const allowlist = getSubAgentAllowlist(ctx);

  // Pre-generate the runId + AbortController so the cancel route
  // (/inbox/:id/triage/cancel) can find and abort the in-flight run
  // without scanning the runs table. Replace any prior in-flight
  // triage controller for this message — last writer wins, the
  // older run's abort will run to completion safely.
  const runId: string = randomUUID();
  const abortController = new AbortController();
  ctx.activeRuns.set(runId, abortController);
  ctx.inboxTriageAbortControllers.set(messageId, { runId, controller: abortController });
  // Set the triageRunId on the message immediately so the
  // run-detail page and the inbox modal can both point at the
  // in-flight run. We refresh the status post-run anyway.
  try {
    ctx.inboxStore.updateStatus(
      messageId,
      message.status === 'open' ? 'triaged' : message.status,
      { triageRunId: runId },
    );
  } catch { /* ignore — message may have been dismissed mid-flight */ }

  try {
    const runPromise = executeAgentDag(
      triage,
      {
        triggeredBy: 'dashboard',
        inputs: {
          MESSAGE_ID: message.id,
          MESSAGE_TITLE: message.title,
          MESSAGE_BODY: message.body,
          MESSAGE_PRIORITY: message.priority,
          MESSAGE_SOURCE: message.source,
          CONTEXT_JSON: message.contextJson ?? '',
          CONVERSATION: conversation,
          ALLOWED_SUB_AGENTS: allowlist.join(', '),
        },
        runId,
        signal: abortController.signal,
      },
      {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot,
        llmSettings: buildLlmSettingsSnapshot(ctx),
        // Forward token-level progress from the triage LLM node to
        // the SSE bus. Filtered to output_chunk so we don't spam
        // clients with turn_start / tool_use markers (those still
        // land in progressJson via the DB path). Other progress
        // types remain DB-only.
        inboxOnProgress: ({ nodeId, progress }) => {
          if (progress.type !== 'output_chunk') return;
          if (!progress.message) return;
          publishInboxEvent(ctx, messageId, 'triage:token', {
            nodeId,
            chunk: progress.message,
            at: Date.now(),
          });
        },
      },
    );
    const finished = await runPromise;
    void finished;

    // Operator-cancelled via the stop button? Bail without adding the
    // unfriendly "did not complete" continuation — the cancel route
    // already posted "Triage stopped by operator." and finalized the
    // run. Hits BOTH races: the executor returning 'failed' before
    // the cancel route force-updates to 'cancelled', and the executor
    // returning 'cancelled' cleanly. Either way, the signal-aborted
    // bit is the load-bearing operator-intent signal.
    if (abortController.signal.aborted) return;

    const run = runId ? ctx.runStore.getRun(runId) : null;
    // Also catch the case where the run row itself ended up cancelled
    // (e.g. /runs/:id/cancel hit by a sibling tab while we were
    // waiting) — same friendly silence.
    if (run?.status === 'cancelled') return;
    if (!run || run.status !== 'completed' || !run.result) {
      ctx.inboxStore.addResponse(
        messageId,
        'system',
        `Triage agent did not complete (${run?.status ?? 'unknown'}). ${run?.error ?? ''}`.trim(),
      );
      return;
    }
    const planJson = extractPlanJson(run.result);
    if (!planJson) {
      ctx.inboxStore.addResponse(
        messageId,
        'system',
        'Triage agent returned no <plan>…</plan> block; raw response was discarded.',
      );
      return;
    }
    let parsed: { recommendation?: unknown; verifyHint?: unknown; actions?: unknown; commitmentSummary?: unknown };
    try {
      parsed = JSON.parse(planJson);
    } catch {
      ctx.inboxStore.addResponse(messageId, 'system', 'Triage agent returned malformed JSON.');
      return;
    }
    const rec = typeof parsed.recommendation === 'string' ? parsed.recommendation.trim() : '';
    if (!rec || rec.length < 10 || rec.length > 2000) {
      const sysReply = ctx.inboxStore.addResponse(messageId, 'system', 'Triage agent recommendation failed validation.');
      publishInboxEvent(ctx, messageId, 'message:created', {
        responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
      });
      return;
    }
    const verifyHint = typeof parsed.verifyHint === 'string' && parsed.verifyHint.trim()
      ? parsed.verifyHint.trim()
      : undefined;
    // Pending-work chip text. Only honored when this turn also
    // proposes at least one action (enforced post-action-parse below)
    // — a commitment with no job behind it is the prose-only failure
    // mode the chip exists to prevent.
    const commitmentRaw = typeof parsed.commitmentSummary === 'string'
      ? parsed.commitmentSummary.trim()
      : '';
    const commitmentSummary = commitmentRaw.length >= 3 && commitmentRaw.length <= 60
      ? commitmentRaw
      : undefined;
    const triageMeta: Record<string, string> = {};
    if (verifyHint) triageMeta.verifyHint = verifyHint;
    if (commitmentSummary) triageMeta.commitmentSummary = commitmentSummary;
    const triageReply = ctx.inboxStore.addResponse(
      messageId,
      'triage',
      rec,
      Object.keys(triageMeta).length > 0 ? JSON.stringify(triageMeta) : undefined,
    );
    // The canonical "triage finished" signal. Clients use this to
    // replace any in-progress typewriter bubble (PR 4) with the
    // persisted entry.
    publishInboxEvent(ctx, messageId, 'triage:complete', {
      responseId: triageReply.id,
      role: 'triage',
      body: rec,
      verifyHint,
      commitmentSummary,
      createdAt: triageReply.createdAt,
    });

    // Parse + persist any proposed actions (only when allowlist is
    // non-empty). Refusals (out-of-allowlist or malformed) get a
    // single grouped `system` note so the operator can see what was
    // declined and why.
    if (allowlist.length > 0) {
      const { accepted, rejected } = parseProposedActions(parsed.actions, allowlist);
      const existing = countActionsOnMessage(ctx, messageId);
      const budget = Math.max(0, MAX_ACTIONS_PER_MESSAGE - existing);
      const toInsert = accepted.slice(0, budget);
      const overflow = accepted.length - toInsert.length;
      for (const action of toInsert) {
        const body = action.rationale
          ?? `Run agent \`${action.agentId}\`.`;
        const actionResp = ctx.inboxStore.addResponse(messageId, 'action', body, JSON.stringify(action));
        publishInboxEvent(ctx, messageId, 'action:created', {
          responseId: actionResp.id,
          agentId: action.agentId,
          rationale: action.rationale,
          inputs: action.inputs,
          createdAt: actionResp.createdAt,
        });
        // Auto-approve trusted system agents. The proposed -> running
        // transition is atomic via transitionActionStatus, so a
        // concurrent operator click on /run no-ops idempotently. The
        // chip Layer 1 added stays pulsing through the run; on
        // completion runProposedAction publishes the terminal
        // action:status event and (when all actions resolve) fires
        // the follow-up triage turn.
        if (TRIAGE_AUTO_APPROVE_AGENTS.has(action.agentId)) {
          const startedAt = Date.now();
          const runningMeta: InboxActionMeta = { ...action, status: 'running', startedAt };
          const claimed = ctx.inboxStore.transitionActionStatus(
            actionResp.id,
            'proposed',
            JSON.stringify(runningMeta),
          );
          if (claimed) {
            publishInboxEvent(ctx, messageId, 'action:status', {
              responseId: actionResp.id,
              status: 'running',
              agentId: action.agentId,
              startedAt,
            });
            const claimedResponse = ctx.inboxStore.getResponse(actionResp.id) ?? actionResp;
            void runProposedAction(ctx, messageId, claimedResponse, runningMeta).catch((err) => {
              process.stderr.write(`[inbox-triage] auto-approved action ${actionResp.id} crashed: ${(err as Error)?.message ?? err}\n`);
            });
          }
        }
      }
      const notes: string[] = [];
      for (const r of rejected) {
        notes.push(`Refused action on \`${r.agentId}\`: ${r.reason}.`);
      }
      if (overflow > 0) {
        notes.push(`Skipped ${overflow} additional proposed action${overflow === 1 ? '' : 's'} — message has reached the per-thread action cap (${MAX_ACTIONS_PER_MESSAGE}).`);
      }
      if (notes.length > 0) {
        const sysReply = ctx.inboxStore.addResponse(messageId, 'system', notes.join('\n'));
        publishInboxEvent(ctx, messageId, 'message:created', {
          responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
        });
      }
    }

    try {
      ctx.inboxStore.updateStatus(messageId, 'awaiting_user', { recommendation: rec, triageRunId: runId });
    } catch { /* ignore */ }
    publishInboxEvent(ctx, messageId, 'state', { phase: 'done', since: Date.now() });
  } catch (err) {
    // Operator-cancelled exceptions look like crashes here (the
    // abort signal surfaces as a thrown error inside the executor).
    // Skip the "Triage agent crashed" system note — the cancel route
    // already posted "Triage stopped by operator." and the state:done
    // event below still fires so the modal clears its pending UI.
    if (!abortController.signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[inbox-triage] run failed: ${msg}\n${(err as Error)?.stack ?? ''}\n`);
      try {
        const sysReply = ctx.inboxStore.addResponse(messageId, 'system', `Triage agent crashed: ${msg}`);
        publishInboxEvent(ctx, messageId, 'message:created', {
          responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
        });
      } catch { /* ignore */ }
    }
    publishInboxEvent(ctx, messageId, 'state', { phase: 'done', since: Date.now() });
  } finally {
    // Clear the abort-controller registry entries for this run.
    // Cancel-route already deletes activeRuns when it fires; this
    // covers the normal-completion path. Use ?-checks because a
    // re-entry would have already replaced the entry with a fresh
    // controller pointing at a newer runId.
    ctx.activeRuns.delete(runId);
    const existing = ctx.inboxTriageAbortControllers.get(messageId);
    if (existing && existing.runId === runId) {
      ctx.inboxTriageAbortControllers.delete(messageId);
    }
  }
}
