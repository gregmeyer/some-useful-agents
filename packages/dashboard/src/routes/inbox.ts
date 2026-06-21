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
 *
 * This file is the ROUTE LAYER only (handlers + router wiring). The
 * supporting logic lives in cohesive siblings; add a new endpoint here and
 * compose these — don't grow this file back into a god module:
 *   - inbox-shared.ts   — http/util helpers + shared constants + formatters
 *   - inbox-catalog.ts  — sub-agent allowlist / catalog / input enrichment
 *   - inbox-plan.ts     — plan/action/link parsing + crash recovery
 *   - inbox-widgets.ts  — thread view-data + in-thread widget assembly
 *   - inbox-engine.ts   — triage + action-execution + learning-extraction engine
 */

import { Router, type Request, type Response } from 'express';
import {
  type RunStatus,
  type InboxActionMeta,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderInboxList } from '../views/inbox-list.js';
import { renderInboxDetail, renderInboxDetailFragment } from '../views/inbox-detail.js';
import { render } from '../views/html.js';
import { renderNotFoundPage } from '../views/not-found.js';
import {
  deriveTitleFromBody,
  publishInboxEvent,
  addSystemMessage,
  summarizeInline,
  updateThreadAgentLink,
  parseSort,
  parseFlash,
  isAjax,
  parseActionMeta,
  SYSTEM_AGENT_IDS,
} from './inbox-shared.js';
import {
  buildThreadSummary,
  listForkableAgents,
  buildInlineActionWidgets,
  exportTargetAgentYaml,
} from './inbox-widgets.js';
import {
  runTriageAgent,
  runProposedAction,
  maybeExtractLearning,
  resetTriageCrashRetries,
  isTriagePending,
} from './inbox-engine.js';

export const inboxRouter: Router = Router();

/**
 * Default title for a freshly-created manual thread. POST /inbox/new
 * uses this when the client doesn't supply a title; POST /respond
 * watches for it so the first reply on the thread can replace the
 * placeholder with something derived from the operator's actual words.
 */
const DEFAULT_NEW_CONVERSATION_TITLE = 'New conversation';

// ════════════════════════════════════════════════════════════════
// Read — list + thread views
// ════════════════════════════════════════════════════════════════

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
// ════════════════════════════════════════════════════════════════
// Thread lifecycle — create, close, bulk
// ════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════
// Conversation + triage
// ════════════════════════════════════════════════════════════════

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
// ════════════════════════════════════════════════════════════════
// Thread metadata + transforms — star, tags, reopen, summarize, fork, retarget
// ════════════════════════════════════════════════════════════════

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
// ════════════════════════════════════════════════════════════════
// Sub-agent actions — run / skip a proposed action
// ════════════════════════════════════════════════════════════════

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
// ════════════════════════════════════════════════════════════════
// Learnings — approve / reject an extracted lesson (experimental)
// ════════════════════════════════════════════════════════════════

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
