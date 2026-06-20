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
import {
  executeAgentDag,
  extractPlanJson,
  extractTaggedJson,
  exportAgent,
  isAppleIntegrationEnabled,
  isTriageLearningsEnabled,
  parseAgent,
  LEARNING_CATEGORIES,
  LEARNING_SCOPES,
  type Agent,
  type Run,
  type RunStatus,
  type InboxActionMeta,
  type InboxActionStatus,
  type InboxResponse,
  type LearningCategory,
  type LearningScope,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import { autoFixYaml } from './run-now-build.js';
import { applyProviderPin } from './build-orchestrator.js';
import { loadTriageKernel, loadTriagePlaybook } from './triage-prompt.js';
import { resolveRunBackend } from '../lib/run-backend.js';
import { renderInboxList } from '../views/inbox-list.js';
import { renderInboxDetail, renderInboxDetailFragment } from '../views/inbox-detail.js';
import { render } from '../views/html.js';
import { renderNotFoundPage } from '../views/not-found.js';
import {
  deriveTitleFromBody,
  publishInboxEvent,
  addSystemMessage,
  summarizeInline,
  latestUserRequest,
  localIsoNow,
  updateThreadAgentLink,
  parseSort,
  parseFlash,
  isAjax,
  parseActionMeta,
  formatLearnings,
  formatConversationSnapshot,
  TRIAGE_REJECTION_RECOVERY_NOTE,
  PENDING_USER_REPLY_WINDOW_MS,
  SYSTEM_AGENT_IDS,
} from './inbox-shared.js';
import {
  getSubAgentAllowlist,
  getRunnableCandidates,
  ensureSystemAgentCurrent,
  buildTriageCatalogJson,
  buildRunnableAgentSpecsJson,
  enrichAgentAnalyzerInputs,
  enrichAgentCatalogSearchInputs,
  enrichAgentBuilderInputs,
  extractAgentBuilderProviderPin,
  deriveRunFailureReason,
} from './inbox-catalog.js';
import {
  parseProposedActions,
  parseTriageLinks,
  hasRecoveryRefireSinceLastUser,
  postTriageFailureFallback,
  planTriageCrashRecovery,
  hasMatchingFailedAction,
} from './inbox-plan.js';
import {
  buildThreadSummary,
  listForkableAgents,
  buildInlineActionWidgets,
  exportTargetAgentYaml,
} from './inbox-widgets.js';

// Re-export shims so sibling test files that import these from './inbox.js'
// keep resolving after the leaf split.
export {
  latestUserRequest,
  localIsoNow,
  formatLearnings,
  getSubAgentAllowlist,
  getRunnableCandidates,
  parseProposedActions,
  parseTriageLinks,
  planTriageCrashRecovery,
  hasMatchingFailedAction,
};
export { type TriageLink } from './inbox-plan.js';

export const inboxRouter: Router = Router();

export const TRIAGE_AGENT_ID = 'inbox-triage';
/** Experimental learnings extractor — route-dispatched on thread resolve. */
const LEARNING_EXTRACTOR_AGENT_ID = 'inbox-learning-extractor';
/** Sources rich enough to learn from (agentId reliably present). */
const LEARNING_SOURCES: ReadonlySet<string> = new Set(['run-failure', 'permission-request']);
/** Cap a stored lesson; the extractor is told ~280, this is the hard limit. */
const LEARNING_MAX_CHARS = 600;

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
 * Agent IDs handled by the route directly rather than dispatched as a
 * sub-agent run. The "agent" entry here exists so the allowlist + UI
 * affordances behave consistently, but the actual side effect (e.g.
 * committing a YAML change via `agentStore.upsertAgent`) is performed
 * synchronously inside `runProposedAction`.
 */
const ROUTE_HANDLED_AGENTS: ReadonlySet<string> = new Set(['agent-editor']);

/**
 * Hard cap on `action`-role responses per inbox message. Triage gets a
 * follow-up turn after each action resolves; without a cap, a bad
 * prompt could fan out indefinitely. 10 is enough room for a few rounds
 * of "run X, summarize, run Y on the result" without going wild.
 */
const MAX_ACTIONS_PER_MESSAGE = 10;

/** Truncate the sub-agent run output that's stored in action meta. */
const ACTION_RESULT_PREVIEW_LIMIT = 500;

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
  const inlineActionWidgets = buildInlineActionWidgets(ctx, message.id, responses);
  res.type('html').send(renderInboxDetail({
    message,
    responses,
    flash: parseFlash(req),
    triagePending,
    currentTargetYaml,
    inlineActionWidgets,
    threadSummary: responses.length >= 3 ? buildThreadSummary(message, responses) : undefined,
    forkableAgents: listForkableAgents(ctx),
    pendingLearnings: ctx.inboxStore.listLearnings({ messageId: id, status: 'pending' }),
  }));
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
  const inlineActionWidgets = buildInlineActionWidgets(ctx, message.id, responses);
  res.type('html').send(render(renderInboxDetailFragment({
    message,
    responses,
    triagePending,
    currentTargetYaml,
    inlineActionWidgets,
    threadSummary: responses.length >= 3 ? buildThreadSummary(message, responses) : undefined,
    forkableAgents: listForkableAgents(ctx),
    pendingLearnings: ctx.inboxStore.listLearnings({ messageId: id, status: 'pending' }),
  })));
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

/**
 * Mark a thread resolved (the operator fixed it). Distinct from dismiss
 * ("I don't care") — resolve is the high-signal terminal state, so it's the
 * trigger for learning extraction. Fire-and-forget: the extractor runs in the
 * background (flag-gated; no-op when the flag is off), so the response returns
 * immediately.
 */
inboxRouter.post('/inbox/:id/resolve', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  try {
    ctx.inboxStore.updateStatus(id, 'resolved');
    void maybeExtractLearning(ctx, id).catch(() => { /* logged in helper */ });
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `/inbox?ok=${encodeURIComponent('Resolved.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `/inbox/${encodeURIComponent(id)}?error=${encodeURIComponent(`Resolve failed: ${msg}`)}`);
  }
});

inboxRouter.post('/inbox/bulk-dismiss', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.inboxStore) {
    if (isAjax(req)) { res.status(503).end(); return; }
    res.redirect(303, '/inbox?error=' + encodeURIComponent('Inbox is unavailable.'));
    return;
  }
  const rawIds = typeof req.body?.ids === 'string' ? req.body.ids : '';
  const ids: string[] = Array.from(new Set(
    rawIds
      .split(',')
      .map((id: string) => id.trim())
      .filter(Boolean),
  ));
  const returnTo = typeof req.body?.returnTo === 'string' && req.body.returnTo.startsWith('/inbox')
    ? req.body.returnTo
    : '/inbox';
  if (ids.length === 0) {
    if (isAjax(req)) { res.status(400).json({ error: 'No messages selected.' }); return; }
    res.redirect(303, `${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent('No messages selected.')}`);
    return;
  }

  let dismissed = 0;
  for (const id of ids) {
    const row = ctx.inboxStore.get(id);
    if (!row) continue;
    try {
      ctx.inboxStore.dismiss(id);
      dismissed += 1;
    } catch {
      // Skip per-row failures so one bad id doesn't block the whole bulk action.
    }
  }

  if (isAjax(req)) {
    res.status(dismissed > 0 ? 200 : 404).json({ dismissed, requested: ids.length });
    return;
  }
  if (dismissed === 0) {
    res.redirect(303, `${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent('No selected messages could be dismissed.')}`);
    return;
  }
  const label = dismissed === 1 ? 'Dismissed 1 message.' : `Dismissed ${dismissed} messages.`;
  res.redirect(303, `${returnTo}${returnTo.includes('?') ? '&' : '?'}ok=${encodeURIComponent(label)}`);
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
  // A RUNNING action is mid-execution — we can't safely yank it, so
  // hold off: don't fire triage and don't touch the card. The
  // follow-up turn `maybeRefireTriage` schedules at completion picks
  // up this reply (same CONVERSATION snapshot), so nothing is lost.
  //
  // A PROPOSED action is just awaiting a click. The operator typing a
  // reply instead of clicking Run usually means they've redirected, so
  // we auto-retire the proposed card (attributed to triage — it's a
  // supersede, not the operator declining) and fire a fresh triage
  // turn that re-plans against their latest request (CURRENT_REQUEST).
  // If the reply didn't actually supersede it, triage just re-proposes.
  const responsesNow = ctx.inboxStore.listResponses(id);
  const runningPending = responsesNow.some((r) => parseActionMeta(r)?.status === 'running');
  if (!runningPending) {
    for (const r of responsesNow) {
      const m = parseActionMeta(r);
      if (!m || m.status !== 'proposed') continue;
      const superseded: InboxActionMeta = { ...m, status: 'skipped', skippedBy: 'triage', endedAt: Date.now() };
      if (ctx.inboxStore.transitionActionStatus(r.id, 'proposed', JSON.stringify(superseded))) {
        publishInboxEvent(ctx, id, 'action:status', {
          responseId: r.id,
          status: 'skipped',
          agentId: m.agentId,
          endedAt: superseded.endedAt,
        });
      }
    }
    // A fresh operator reply restores the transient-crash retry budget — this
    // is genuine new input, not a crash loop, so it deserves a clean slate.
    resetTriageCrashRetries(ctx, id);
    // Fire-and-forget; the modal polls /fragment for the response.
    // The conversation thread itself signals "in progress" via the
    // user-reply-within-30s heuristic in isTriagePending.
    void runTriageAgent(ctx, id).catch(() => { /* logged in helper */ });
  }

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
  // Operator explicitly asked for another look — fresh retry budget.
  resetTriageCrashRetries(ctx, id);
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

// ── Thread usability: reopen / summarize / fork / retarget ──────────────
// Make one thread a stable working surface — reopen a closed thread, pin a
// derived summary, and move work to a different agent (fork = new thread with
// provenance; retarget = rewrite this thread's agent link in place).

inboxRouter.post('/inbox/:id/reopen', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  try {
    ctx.inboxStore.updateStatus(id, 'open');
    addSystemMessage(ctx, id, 'Thread reopened.');
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Reopened.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Reopen failed: ${msg}`)}`);
  }
});

inboxRouter.post('/inbox/:id/summarize', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore) {
    if (isAjax(req)) { res.status(503).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Inbox unavailable.')}`);
    return;
  }
  const message = ctx.inboxStore.get(id);
  if (!message) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const summary = buildThreadSummary(message, ctx.inboxStore.listResponses(id));
  const body = [
    `Thread summary`,
    `Goal: ${summary.currentGoal}`,
    `Status: ${summary.currentStatus}`,
    summary.latestResult ? `Latest result: ${summary.latestResult}` : '',
    summary.nextStep ? `Next step: ${summary.nextStep}` : '',
  ].filter(Boolean).join('\n');
  addSystemMessage(ctx, id, body);
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Summary added.')}`);
});

inboxRouter.post('/inbox/:id/fork', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore) {
    if (isAjax(req)) { res.status(503).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Inbox unavailable.')}`);
    return;
  }
  const message = ctx.inboxStore.get(id);
  if (!message) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId.trim() : '';
  const targetAgent = agentId ? ctx.agentStore.getAgent(agentId) : null;
  if (!agentId || !targetAgent || SYSTEM_AGENT_IDS.has(agentId)) {
    if (isAjax(req)) { res.status(400).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Agent "${agentId || '<none>'}" is not available for forking.`)}`);
    return;
  }
  const summary = buildThreadSummary(message, ctx.inboxStore.listResponses(id));
  const forkBody = [
    `Forked from thread ${id}.`,
    `Goal: ${summary.currentGoal}`,
    summary.latestResult ? `Latest result: ${summary.latestResult}` : '',
    summary.nextStep ? `Next step: ${summary.nextStep}` : '',
  ].filter(Boolean).join('\n');
  try {
    const forked = ctx.inboxStore.add({
      priority: message.priority,
      source: 'manual',
      title: `${message.title} → ${agentId}`,
      body: forkBody,
      agentId,
      contextJson: JSON.stringify({
        forkedFromThreadId: id,
        forkedFromAgentId: message.agentId ?? null,
        summary,
      }),
    });
    addSystemMessage(ctx, id, `Forked this thread to \`${agentId}\` as ${forked.id.slice(0, 8)}.`,
      JSON.stringify({ links: [{ label: 'Open forked thread', href: `/inbox/${forked.id}` }] }));
    addSystemMessage(ctx, forked.id, `Forked from thread ${id.slice(0, 8)} into agent \`${agentId}\`.`,
      JSON.stringify({ links: [{ label: 'Open source thread', href: `/inbox/${id}` }] }));
    if (isAjax(req)) { res.setHeader('X-Inbox-Id', forked.id); res.status(204).end(); return; }
    res.redirect(303, `/inbox/${encodeURIComponent(forked.id)}?ok=${encodeURIComponent('Thread forked.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Fork failed: ${msg}`)}`);
  }
});

inboxRouter.post('/inbox/:id/retarget', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    if (isAjax(req)) { res.status(404).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId.trim() : '';
  const targetAgent = agentId ? ctx.agentStore.getAgent(agentId) : null;
  if (!agentId || !targetAgent || SYSTEM_AGENT_IDS.has(agentId)) {
    if (isAjax(req)) { res.status(400).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Agent "${agentId || '<none>'}" is not available to retarget to.`)}`);
    return;
  }
  try {
    updateThreadAgentLink(ctx, id, agentId);
    addSystemMessage(ctx, id, `Retargeted this thread to \`${agentId}\`.`,
      JSON.stringify({ links: [{ label: `Open ${agentId}`, href: `/agents/${agentId}` }] }));
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Thread retargeted.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Retarget failed: ${msg}`)}`);
  }
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
  const skippedMeta: InboxActionMeta = { ...meta, status: 'skipped', skippedBy: 'operator', endedAt: Date.now() };
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

/**
 * POST /inbox/:id/learnings/:lid/(approve|reject) — operator decides on a
 * `pending` triage learning. Approve makes it retrievable into future triage;
 * reject leaves it dead (never retrieved). Atomic via updateLearningStatus, so
 * a double-click resolves once.
 */
function handleLearningDecision(decision: 'approved' | 'rejected') {
  return (req: Request, res: Response): void => {
    const ctx = getContext(req.app.locals);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const lid = Array.isArray(req.params.lid) ? req.params.lid[0] : req.params.lid;
    const detailUrl = `/inbox/${encodeURIComponent(id)}`;
    if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
      if (isAjax(req)) { res.status(404).end(); return; }
      res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
      return;
    }
    const learning = ctx.inboxStore.getLearning(lid);
    if (!learning || learning.sourceMessageId !== id) {
      if (isAjax(req)) { res.status(404).end(); return; }
      res.redirect(303, `${detailUrl}?error=${encodeURIComponent('Learning not found.')}`);
      return;
    }
    const committed = ctx.inboxStore.updateLearningStatus(lid, decision);
    if (committed) {
      publishInboxEvent(ctx, id, 'learning:status', { learningId: lid, status: decision });
    }
    if (isAjax(req)) { res.status(204).end(); return; }
    const ok = decision === 'approved' ? 'Learning approved.' : 'Learning discarded.';
    const stale = 'Learning already decided.';
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent(committed ? ok : stale)}`);
  };
}
inboxRouter.post('/inbox/:id/learnings/:lid/approve', handleLearningDecision('approved'));
inboxRouter.post('/inbox/:id/learnings/:lid/reject', handleLearningDecision('rejected'));

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

/** Poll the shared run row until it reaches a terminal status (the worker
 * activity owns the lifecycle for durable runs). Returns the last-seen run on
 * timeout so a long build isn't mis-reported as failed prematurely. */
async function awaitRunTerminal(
  ctx: ReturnType<typeof getContext>,
  runId: string,
  capMs = 600_000,
): Promise<Run | null> {
  const terminal = new Set<RunStatus>(['completed', 'failed', 'cancelled']);
  const deadline = Date.now() + capMs;
  for (;;) {
    let run: Run | null;
    try { run = ctx.runStore.getRun(runId); } catch { run = null; }
    if (run && terminal.has(run.status)) return run;
    if (Date.now() >= deadline) return run;
    await new Promise((r) => setTimeout(r, 750));
  }
}

/**
 * Run a dispatched sub-agent to completion via the right backend.
 *
 * Temporal: submit the WHOLE DAG to the worker (submitDagRun) and poll the run
 * row to terminal — NOT per-node orchestration from the dashboard. Integration
 * tools (apple, csv, sqlite, postgres) only resolve where an IntegrationsStore
 * exists (the worker activity builds one), and the apple runner needs the GUI
 * worker's TCC grants; orchestrating here would fail to resolve or execute in
 * the grant-less dashboard. Local: no worker, so run in-process WITH the
 * integration/tool/agent stores. Either way the experimental Apple gate is
 * read from this (reliable) process and threaded to wherever the run lands.
 */
async function runDispatchedAgentToTerminal(
  ctx: ReturnType<typeof getContext>,
  agent: Agent,
  inputs: Record<string, string>,
): Promise<{ id: string; status: RunStatus; result?: string; error?: string }> {
  if (resolveRunBackend(ctx.provider, agent) === 'temporal' && ctx.provider.submitDagRun) {
    const submitted = await ctx.provider.submitDagRun(agent, {
      inputs,
      triggeredBy: 'dashboard',
      variablesPath: ctx.variablesPath,
      dataRoot: ctx.agentStore.dataRoot,
      llmProviders: buildLlmSettingsSnapshot(ctx)?.providers,
      allowUntrustedShell: ctx.allowUntrustedShell ? [...ctx.allowUntrustedShell] : undefined,
      experimentalApple: isAppleIntegrationEnabled(),
    });
    const final = await awaitRunTerminal(ctx, submitted.id);
    return {
      id: submitted.id,
      status: final?.status ?? 'failed',
      result: typeof final?.result === 'string' ? final.result : undefined,
      error: final?.error ?? (final ? undefined : 'Run did not finish within the dispatch window.'),
    };
  }
  const run = await executeAgentDag(
    agent,
    { triggeredBy: 'dashboard', inputs },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
      integrationsStore: ctx.integrationsStore,
      toolStore: ctx.toolStore,
      agentStore: ctx.agentStore,
      dataRoot: ctx.agentStore.dataRoot,
      llmSettings: buildLlmSettingsSnapshot(ctx),
      onRunFailure: ctx.onRunFailure,
      experimentalApple: isAppleIntegrationEnabled(),
    },
  );
  return {
    id: run.id,
    status: run.status,
    result: typeof run.result === 'string' ? run.result : undefined,
    error: run.error,
  };
}

/**
 * Execute a single proposed action: walks meta through `running`,
 * dispatches the sub-agent (on the Temporal worker when that's the backend),
 * then patches meta to `completed | failed` with run lineage + a short result
 * preview. When all proposed actions on the parent message have resolved (any
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

  // "Enable & run": the operator approved running an agent that hadn't
  // been granted inbox-run permission. The approval IS the grant — flip
  // permissions.inboxRunnable durably, then fall through to the normal
  // run. Idempotent if it's somehow already set. Revocable from the
  // agent's Config tab. Never auto-runs without this explicit approval.
  if (meta.grantsInboxRunnable && !subAgent.permissions?.inboxRunnable) {
    try {
      ctx.agentStore.upsertAgent(
        { ...subAgent, permissions: { ...subAgent.permissions, inboxRunnable: true } },
        'dashboard',
        'Granted inboxRunnable via inbox approve-to-run',
      );
      // Past-tense + no "running it now…": the grant note's created_at is
      // later than the action card (proposed earlier), so it renders BELOW
      // the run result. "Running it now…" then reads as if the run hasn't
      // happened — confusing the operator AND the follow-up triage turn into
      // "wait for the result" when it already finished. State only the durable
      // fact; the action card itself shows the run's outcome.
      const note = `Enabled **${subAgent.name}** to run from inbox threads — revoke any time in its Config tab.`;
      const sysReply = ctx.inboxStore.addResponse(messageId, 'system', note);
      publishInboxEvent(ctx, messageId, 'message:created', {
        responseId: sysReply.id, role: 'system', body: note, createdAt: sysReply.createdAt,
      });
    } catch { /* grant is best-effort — fall through and let the run proceed */ }
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

  // Provider pin from triage's action inputs. agent-builder is the
  // only consumer today — operator says "build it on apple" and triage
  // emits PROVIDER=apple-foundation-models. The pin runs first in the
  // waterfall; the global fallback chain still applies on classified
  // failures. Strip is already handled inside enrichAgentBuilderInputs.
  let dispatchAgent = subAgent;
  if (meta.agentId === 'agent-builder') {
    const providerPin = extractAgentBuilderProviderPin(meta.inputs);
    if (providerPin) dispatchAgent = applyProviderPin(subAgent, providerPin);
  }

  let runId: string | undefined;
  let nextStatus: InboxActionStatus = 'failed';
  let resultSummary: string | undefined;
  let refusalReason: string | undefined;
  let fullResult = '';
  try {
    const run = await runDispatchedAgentToTerminal(ctx, dispatchAgent, effectiveInputs);
    runId = run.id;
    if (run.status === 'completed') {
      nextStatus = 'completed';
      fullResult = run.result ?? '';
      resultSummary = fullResult.length > ACTION_RESULT_PREVIEW_LIMIT
        ? fullResult.slice(0, ACTION_RESULT_PREVIEW_LIMIT) + '…'
        : fullResult;
    } else {
      nextStatus = 'failed';
      refusalReason = deriveRunFailureReason(ctx, run.id, run.error ?? `Run ended in status ${run.status}.`);
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
  } else if (meta.agentId === 'agent-builder' && nextStatus === 'completed' && runId) {
    maybeAutoProposeBuilderInstallAction(ctx, messageId, runId);
  }

  // After agent-builder completes, the designed agent only exists as a
  // `<yaml>` block in the run output — agent-builder validates but never
  // commits. Persist it (as a draft) so `/agents/<id>` actually resolves
  // and triage can propose running it. Without this the agent is a ghost:
  // triage reports success on a build that produced text, not a catalog
  // entry.
  if (meta.agentId === 'agent-builder' && nextStatus === 'completed' && runId) {
    maybeCommitBuiltAgent(ctx, messageId, runId);
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

/** Delay before an auto-retry so a transient backend has a moment to recover. */
const TRIAGE_CRASH_RETRY_DELAY_MS = 2000;

/** Lazily-initialized per-message crash-retry counter (see DashboardContext). */
function triageCrashRetries(ctx: ReturnType<typeof getContext>): Map<string, number> {
  return (ctx.inboxTriageCrashRetries ??= new Map());
}

/** Clear a thread's crash-retry budget (a fresh user turn or a success). */
function resetTriageCrashRetries(ctx: ReturnType<typeof getContext>, messageId: string): void {
  triageCrashRetries(ctx).delete(messageId);
}

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

/**
 * Commit the agent that agent-builder just designed. The build DAG
 * (design → validate → fix) emits a validated `<yaml>` block in the
 * `design` (or `fix`) node output but never writes to the catalog — the
 * dashboard wizard commits separately via `/agents/build/commit`. When a
 * build runs as an inbox action there's no such step, so the agent is a
 * ghost: `/agents/<id>` 404s and triage can't run it.
 *
 * This closes that gap: parse the YAML and upsert the agent as a DRAFT
 * (visible + runnable on demand, but not live/scheduled until the operator
 * reviews it). Emits a system note with a REAL link so the operator — and
 * triage's follow-up turn — see an agent that actually exists.
 *
 * Guards: never clobber an existing non-draft agent (a real user agent
 * sharing the id wins); skip silently when no parseable YAML is present.
 */
export function maybeCommitBuiltAgent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  builderRunId: string,
): void {
  if (!ctx.inboxStore) return;
  const execs = ctx.runStore.listNodeExecutions(builderRunId);
  // Prefer `fix` (runs only when validate found issues) over `design`.
  const fix = execs.find((e) => e.nodeId === 'fix' && e.status === 'completed');
  const design = execs.find((e) => e.nodeId === 'design' && e.status === 'completed');
  const source = (fix?.result ?? design?.result ?? '').toString();
  const match = source.match(/<yaml>\s*\n?([\s\S]*?)<\/yaml>/);
  if (!match) return;
  // Run the same repair the dashboard wizard applies before committing an
  // LLM-built agent. Most important here: autoFixYaml un-escapes `{ {` back to
  // `{{` in outputWidget.template / prompts — the template pipeline escapes
  // `{{` → `{ {` to prevent re-expansion, and without this repair the inbox path
  // persists the escaped form, so the widget renders a literal `{ {outputs.X}}`.
  const builtYaml = autoFixYaml(match[1].trim());
  if (builtYaml.length < 10) return;

  let parsed;
  try { parsed = parseAgent(builtYaml); } catch { return; }

  // Never overwrite a real (non-draft) agent that already owns this id.
  // A draft of the same id is fair game to re-commit (iterating a build).
  const existing = ctx.agentStore.getAgent(parsed.id);
  if (existing && existing.status !== 'draft') {
    const note = `Built **${parsed.name}** but an agent with id \`${parsed.id}\` already exists and is not a draft — not overwriting it. Review the build output and pick a different id if needed.`;
    const sysReply = ctx.inboxStore.addResponse(messageId, 'system', note);
    publishInboxEvent(ctx, messageId, 'message:created', {
      responseId: sysReply.id, role: 'system', body: note, createdAt: sysReply.createdAt,
    });
    return;
  }

  // Commit as a draft regardless of what status the YAML declared — an
  // LLM-designed agent should not go live or scheduled without review.
  // Stamp `permissions.inboxRunnable` so the draft is immediately runnable
  // from this thread via the runnable-agent model (getSubAgentAllowlist),
  // approval-gated — "build me an agent, now run it" in one thread.
  try {
    ctx.agentStore.upsertAgent(
      {
        ...parsed,
        status: 'draft',
        permissions: { ...parsed.permissions, inboxRunnable: true },
      },
      'import',
      `Auto-committed (draft) from inbox build on thread ${messageId}`,
    );
  } catch {
    return; // store rejected it (e.g. constraint) — leave the thread untouched
  }

  const href = `/agents/${parsed.id}`;
  const note = `Created **${parsed.name}** as a draft at ${href}. Review it, then approve a run to see its output here.`;
  const sysReply = ctx.inboxStore.addResponse(
    messageId,
    'system',
    note,
    JSON.stringify({ links: [{ label: `Open ${parsed.name}`, href }] }),
  );
  publishInboxEvent(ctx, messageId, 'message:created', {
    responseId: sysReply.id, role: 'system', body: note, createdAt: sysReply.createdAt,
  });
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
  const message = ctx.inboxStore?.get(messageId);
  const installed = !message?.agentId || message.agentId !== agentId;
  return {
    status: 'completed',
    summary: installed
      ? `Installed agent \`${agentId}\` at v${version}.`
      : `Updated agent \`${agentId}\` to v${version}.`,
  };
}

function extractYamlBlockFromRunNodes(
  ctx: ReturnType<typeof getContext>,
  runId: string,
  preferredNodeIds: readonly string[],
): string | undefined {
  const execs = ctx.runStore.listNodeExecutions(runId);
  for (const nodeId of preferredNodeIds) {
    const exec = execs.find((entry) => entry.nodeId === nodeId && entry.status === 'completed');
    const source = (exec?.result ?? '').toString();
    const match = source.match(/<yaml>\s*\n?([\s\S]*?)<\/yaml>/);
    if (!match) continue;
    const yaml = match[1].trim();
    if (yaml.length >= 10) return yaml;
  }
  return undefined;
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
  const proposedYaml = extractYamlBlockFromRunNodes(ctx, analyzerRunId, ['fix', 'analyze']);
  if (!proposedYaml) return;
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

function maybeAutoProposeBuilderInstallAction(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  builderRunId: string,
): void {
  if (!ctx.inboxStore) return;
  const rawYaml = extractYamlBlockFromRunNodes(ctx, builderRunId, ['fix', 'design']);
  if (!rawYaml) return;
  let parsed;
  try { parsed = parseAgent(rawYaml); } catch { return; }
  parsed = {
    ...parsed,
    permissions: {
      ...(parsed.permissions ?? {}),
      inboxRunnable: true,
    },
  };
  const proposedYaml = exportAgent(parsed);

  if (countActionsOnMessage(ctx, messageId) >= MAX_ACTIONS_PER_MESSAGE) return;

  for (const r of ctx.inboxStore.listResponses(messageId)) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    if (m && m.agentId === 'agent-editor'
      && (m.status === 'proposed' || m.status === 'running' || m.status === 'completed')
      && m.inputs.NEW_YAML === proposedYaml) return;
  }

  const alreadyInstalled = ctx.agentStore.getAgent(parsed.id);
  const rationale = alreadyInstalled
    ? `Apply the drafted update for \`${parsed.id}\`.`
    : `Install the drafted agent \`${parsed.id}\` into this catalog.`;
  const action: InboxActionMeta = {
    kind: 'action',
    status: 'proposed',
    agentId: 'agent-editor',
    inputs: { AGENT_ID: parsed.id, NEW_YAML: proposedYaml },
    rationale,
    ctaLabel: alreadyInstalled ? 'Apply draft' : 'Install draft',
  };
  const editorResp = ctx.inboxStore.addResponse(
    messageId,
    'action',
    rationale,
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
 * After a thread is RESOLVED, distill a durable lesson via the
 * inbox-learning-extractor sub-agent and store it as a `pending` learning for
 * the operator to approve. Experimental + flag-gated. Cheapest-first gates keep
 * the common case free; only run-failure / permission-request threads with real
 * triage activity ever reach the (one) LLM call. Best-effort — never throws
 * into the resolve route.
 */
async function maybeExtractLearning(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): Promise<void> {
  if (!isTriageLearningsEnabled()) return;                 // global kill switch
  if (!ctx.inboxStore) return;
  const message = ctx.inboxStore.get(messageId);
  if (!message) return;
  if (!LEARNING_SOURCES.has(message.source)) return;       // only lesson-rich sources
  const responses = ctx.inboxStore.listResponses(messageId);
  if (!responses.some((r) => r.role === 'triage')) return; // nothing was triaged
  if (!ensureSystemAgentCurrent(ctx, LEARNING_EXTRACTOR_AGENT_ID, 'inbox learning extraction')) return;
  const extractor = ctx.agentStore.getAgent(LEARNING_EXTRACTOR_AGENT_ID);
  if (!extractor) return;

  try {
    const run = await runDispatchedAgentToTerminal(ctx, extractor, {
      MESSAGE_SOURCE: message.source,
      AGENT_ID: message.agentId ?? '',
      TERMINAL_STATE: 'resolved',
      CONVERSATION: formatConversationSnapshot(responses),
      CONTEXT_JSON: message.contextJson ?? '',
    });
    if (run.status !== 'completed' || !run.result) return;
    const json = extractTaggedJson(run.result, 'learning');
    if (!json) return;
    let parsed: { lesson?: unknown; category?: unknown; scope?: unknown };
    try { parsed = JSON.parse(json); } catch { return; }
    const lesson = typeof parsed.lesson === 'string' ? parsed.lesson.trim() : '';
    if (!lesson) return;                                    // null/empty ⇒ no durable lesson
    const category = (LEARNING_CATEGORIES as readonly string[]).includes(parsed.category as string)
      ? (parsed.category as LearningCategory) : undefined;
    const scope = (LEARNING_SCOPES as readonly string[]).includes(parsed.scope as string)
      ? (parsed.scope as LearningScope) : 'agent';
    const created = ctx.inboxStore.addLearning({
      source: message.source,
      agentId: message.agentId,
      scope,
      category,
      lesson: lesson.slice(0, LEARNING_MAX_CHARS),
      sourceMessageId: messageId,
      sourceRunId: message.triageRunId,
    });
    if (created) {
      publishInboxEvent(ctx, messageId, 'learning:created', {
        learningId: created.id, lesson: created.lesson, category: created.category,
      });
    }
  } catch (err) {
    process.stderr.write(`[inbox-learning] extraction failed for ${messageId}: ${(err as Error)?.message ?? err}\n`);
  }
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

  // Concurrent-triage guard. PR #425 added an in-flight controller
  // registry; if one already exists, an earlier triage run is mid-
  // flight and a second concurrent run would race against the
  // first's response + the message-status updates. The deferred
  // call lands in `inboxTriagePendingRefires`; the in-flight run's
  // `finally` block schedules a fresh triage turn after it clears
  // its own controller, so any reply the operator posted while
  // triage was thinking still gets a response. Operator can hit the
  // stop button to abandon the prior run if they want fresh.
  if (ctx.inboxTriageAbortControllers.has(messageId)) {
    ctx.inboxTriagePendingRefires.add(messageId);
    return;
  }

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
  const responsesSnapshot = ctx.inboxStore.listResponses(messageId);
  const conversation = formatConversationSnapshot(responsesSnapshot);

  // The operator's latest real ask is the authoritative current intent.
  // MESSAGE_BODY is frozen at thread creation, so on a mid-thread pivot
  // (or an auto-follow-up turn after a pivot) it would otherwise pull
  // triage back to the original request. Falls back to the message body
  // when the operator hasn't replied yet (triage is first responder).
  const currentRequest = latestUserRequest(responsesSnapshot) ?? message.body;

  const allowlist = getSubAgentAllowlist(ctx);
  const runnableAgentSpecs = buildRunnableAgentSpecsJson(ctx, allowlist);
  // Installed agents triage may propose running even though they aren't
  // granted yet — proposing one yields an approval-gated "Enable & run".
  const candidates = getRunnableCandidates(ctx);
  const candidateAgentSpecs = buildRunnableAgentSpecsJson(ctx, candidates);
  // Approved cross-thread lessons relevant to this thread (experimental).
  // Empty string when the flag is off → the kernel section degrades to a no-op.
  const relevantLearnings = isTriageLearningsEnabled()
    ? formatLearnings(ctx.inboxStore.listApprovedLearningsForTriage({ agentId: message.agentId, source: message.source }))
    : '';

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
          CURRENT_REQUEST: currentRequest,
          NOW: localIsoNow(),
          MESSAGE_PRIORITY: message.priority,
          MESSAGE_SOURCE: message.source,
          CONTEXT_JSON: message.contextJson ?? '',
          RELEVANT_LEARNINGS: relevantLearnings,
          CONVERSATION: conversation,
          ALLOWED_SUB_AGENTS: allowlist.join(', '),
          RUNNABLE_AGENT_SPECS: runnableAgentSpecs,
          RUNNABLE_CANDIDATES: candidates.join(', '),
          RUNNABLE_CANDIDATE_SPECS: candidateAgentSpecs,
          // Trimmed installed-agent catalog (newest first) so triage can answer
          // recency / "what does agent X do" directly, with a link, instead of
          // dispatching agent-catalog-search for a simple lookup.
          AGENT_CATALOG: buildTriageCatalogJson(ctx),
          // Compose the prompt from fragments on disk: the shared kernel
          // (voice, action mechanics, <plan> schema) + the one playbook that
          // matches this thread's source. Deterministic — no classifier LLM.
          TRIAGE_KERNEL: loadTriageKernel(),
          SOURCE_PLAYBOOK: loadTriagePlaybook(message.source),
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
        spawnNode: ctx.workflowSpawnNode,
        onRunFailure: ctx.onRunFailure,
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
      addSystemMessage(
        ctx,
        messageId,
        `Triage agent did not complete (${run?.status ?? 'unknown'}). ${run?.error ?? ''}`.trim(),
      );
      postTriageFailureFallback(ctx, message, ctx.inboxStore.listResponses(messageId));
      return;
    }
    const planJson = extractPlanJson(run.result);
    if (!planJson) {
      addSystemMessage(
        ctx,
        messageId,
        'Triage agent returned no <plan>…</plan> block; raw response was discarded.',
      );
      postTriageFailureFallback(ctx, message, ctx.inboxStore.listResponses(messageId));
      return;
    }
    let parsed: { recommendation?: unknown; verifyHint?: unknown; actions?: unknown; commitmentSummary?: unknown; links?: unknown };
    try {
      parsed = JSON.parse(planJson);
    } catch {
      addSystemMessage(ctx, messageId, 'Triage agent returned malformed JSON.');
      postTriageFailureFallback(ctx, message, ctx.inboxStore.listResponses(messageId));
      return;
    }
    const rec = typeof parsed.recommendation === 'string' ? parsed.recommendation.trim() : '';
    if (!rec || rec.length < 10 || rec.length > 2000) {
      const sysReply = ctx.inboxStore.addResponse(messageId, 'system', 'Triage agent recommendation failed validation.');
      publishInboxEvent(ctx, messageId, 'message:created', {
        responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
      });
      postTriageFailureFallback(ctx, message, ctx.inboxStore.listResponses(messageId));
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
    const links = parseTriageLinks(parsed.links, (id) => Boolean(ctx.agentStore.getAgent(id)));
    const triageMeta: Record<string, string> = {};
    if (verifyHint) triageMeta.verifyHint = verifyHint;
    if (commitmentSummary) triageMeta.commitmentSummary = commitmentSummary;
    if (links.length > 0) triageMeta.links = JSON.stringify(links);
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
      const { accepted, rejected, deferred } = parseProposedActions(parsed.actions, allowlist, candidates);
      const dedupedAccepted: InboxActionMeta[] = [];
      for (const action of accepted) {
        if (hasMatchingFailedAction(ctx, messageId, action)) {
          rejected.push({
            agentId: action.agentId,
            reason: 'same action already failed on this thread; revise the inputs or choose a different next step',
          });
          continue;
        }
        dedupedAccepted.push(action);
      }
      const existing = countActionsOnMessage(ctx, messageId);
      const budget = Math.max(0, MAX_ACTIONS_PER_MESSAGE - existing);
      const toInsert = dedupedAccepted.slice(0, budget);
      const overflow = dedupedAccepted.length - toInsert.length;
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
      if (deferred.length > 0) {
        notes.push(`Holding ${deferred.length} more side-effecting action${deferred.length === 1 ? '' : 's'} until the one above completes — I'll propose the next once it's done.`);
      }
      if (notes.length > 0) {
        const sysReply = ctx.inboxStore.addResponse(messageId, 'system', notes.join('\n'));
        publishInboxEvent(ctx, messageId, 'message:created', {
          responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
        });
      }
      if (rejected.length > 0
        && toInsert.length === 0
        && !hasRecoveryRefireSinceLastUser(ctx, messageId)
        && countConsecutiveTriageTurns(ctx, messageId) < MAX_AUTO_TRIAGE_TURNS) {
        addSystemMessage(ctx, messageId, TRIAGE_REJECTION_RECOVERY_NOTE);
        void runTriageAgent(ctx, messageId).catch(() => { /* swallow */ });
      }
    }

    try {
      ctx.inboxStore.updateStatus(messageId, 'awaiting_user', { recommendation: rec, triageRunId: runId });
    } catch { /* ignore */ }
    // A turn completed cleanly — the thread isn't in a crash loop, so refund
    // the auto-retry budget for any future transient failure.
    resetTriageCrashRetries(ctx, messageId);
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
      // A triage crash is almost always a transient infra failure (provider
      // hiccup, worker dispatch race, network). Don't strand the thread on the
      // first blip: auto-retry a bounded number of times with a short backoff,
      // and only post a terminal "crashed" note once the budget is spent. The
      // thread is left `awaiting_user` either way so it stays actionable (the
      // operator can reply or hit "ask triage" even if the retry never lands).
      const retries = triageCrashRetries(ctx);
      const used = retries.get(messageId) ?? 0;
      const { willRetry, noteBody } = planTriageCrashRecovery(used, msg);
      try {
        const sysReply = ctx.inboxStore.addResponse(messageId, 'system', noteBody);
        publishInboxEvent(ctx, messageId, 'message:created', {
          responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
        });
      } catch { /* ignore */ }
      try { ctx.inboxStore.updateStatus(messageId, 'awaiting_user'); } catch { /* ignore */ }
      if (willRetry) {
        retries.set(messageId, used + 1);
        // Fire AFTER this run's `finally` clears the abort-controller guard
        // (the delay comfortably outlasts the synchronous teardown), so the
        // retry isn't deferred as a concurrent run.
        setTimeout(() => {
          void runTriageAgent(ctx, messageId).catch(() => { /* swallow — terminal note posts on final failure */ });
        }, TRIAGE_CRASH_RETRY_DELAY_MS);
      } else {
        retries.delete(messageId);
      }
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
    // Drain a pending re-fire (queued while this run was holding the
    // guard). Use setImmediate so the new run starts AFTER the
    // current frame's state mutations settle and any SSE listeners
    // see this run's `state:done` before the next one's
    // `triage:started`. The cancel-aborted path skips the drain —
    // operator-cancelled means "stop responding," not "queue up the
    // next turn."
    if (!abortController.signal.aborted && ctx.inboxTriagePendingRefires.delete(messageId)) {
      setImmediate(() => {
        runTriageAgent(ctx, messageId).catch(() => { /* swallow */ });
      });
    }
  }
}
