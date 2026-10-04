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

import { answerQuestion, questionForMessage } from '../lib/ask-human.js';
import { Router, type Request, type Response } from 'express';
import {
  AUTONOMY_MODES,
  GLOBAL_TRUST_KEY,
  INBOX_SOURCES,
  type RunStatus,
  type InboxActionMeta,
  type InboxResponse,
  type AutonomyMode,
  type AgentTrustLevel,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderInboxDetailFragment, type AgentTrustInfo } from '../views/inbox-detail.js';
import { renderInboxPage } from '../views/inbox-page.js';
import { render } from '../views/html.js';
import { renderPanelHome, renderPanelList, renderPanelNew, renderPanelRows } from '../views/panel-home.js';
import { buildPanelList, panelFacets, parsePanelFilters, parsePanelTab } from '../lib/panel-inbox.js';
import { renderNotFoundPage } from '../views/not-found.js';
import {
  deriveTitleFromBody,
  publishInboxEvent,
  publishInboxChanged,
  addSystemMessage,
  summarizeInline,
  updateThreadAgentLink,
  parseFlash,
  isAjax,
  parseActionMeta,
  buildRowPreview,
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
  isAutoApprovable,
  proposeAgentFix,
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

/** Home's inbox canvas: list + thread side by side (views/inbox-page.ts). Also served at `/`. */
export function sendInboxPage(req: Request, res: Response, threadId?: string): void {
  const ctx = getContext(req.app.locals);
  let autonomyMode: AutonomyMode = 'full';
  try { autonomyMode = ctx.inboxStore?.getAutonomyMode() ?? 'full'; } catch { /* default */ }
  const agentCount = ctx.agentStore.listAgents().length;
  const availableDashboards = agentCount === 0 && ctx.dashboardsStore
    ? ctx.dashboardsStore.listDashboards().filter((d) => !d.packId).map((d) => ({ id: d.id, name: d.name }))
    : [];
  res.type('html').send(renderInboxPage({ autonomyMode, threadId, flash: parseFlash(req), agentCount, availableDashboards }));
}

inboxRouter.get('/inbox', (req: Request, res: Response) => sendInboxPage(req, res));

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
  // The inbox canvas with this thread open beside the list.
  sendInboxPage(req, res, message.id);
});

/**
 * Which Agent Behavior specs conditioned each run referenced by this thread.
 *
 * Keyed by runId so the view can render a chip without a runStore dependency.
 * Runs that were not conditioned are simply absent from the map, so the chip
 * costs nothing on the overwhelming majority of threads.
 */
function buildRunBehaviors(
  ctx: ReturnType<typeof getContext>,
  responses: InboxResponse[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of responses) {
    let runId: string | undefined;
    try {
      runId = (JSON.parse(r.metaJson ?? '{}') as { runId?: string }).runId;
    } catch { runId = undefined; }
    if (!runId || out[runId]) continue;
    try {
      const run = ctx.runStore.getRun(runId);
      if (run?.behaviors && run.behaviors.length > 0) out[runId] = run.behaviors;
    } catch { /* a missing run must never break a thread render */ }
  }
  return out;
}

/**
 * Build the per-agent trust map (B2) for the action cards in a thread: for each
 * dispatched sub-agent that appears as an action AND is auto-approvable (in the
 * default set or explicitly trusted), record its approvability + explicit
 * override so the card can render the auto-run/require-approval toggle.
 */
function buildAgentTrustMap(
  ctx: ReturnType<typeof getContext>,
  responses: InboxResponse[],
): Map<string, AgentTrustInfo> {
  const map = new Map<string, AgentTrustInfo>();
  if (!ctx.inboxStore) return map;
  for (const r of responses) {
    const meta = parseActionMeta(r);
    if (!meta || meta.mode === 'resolve' || meta.mode === 'show-widget') continue;
    if (map.has(meta.agentId)) continue;
    const level = ctx.inboxStore.getAgentTrust(meta.agentId);
    const approvable = isAutoApprovable(ctx, meta.agentId);
    if (approvable || level) map.set(meta.agentId, { approvable, level });
  }
  return map;
}

/**
 * The conversation panel with no thread open is your inbox (views/panel-home.ts):
 * `/panel/home` is the whole thing, `/panel/list` just the tabs + rows for a
 * tab switch, search or "Show more" (`?rows=1` returns only the rows).
 * Query: tab (needs | open | conversations | done), q, offset.
 */
function panelListFor(req: Request) {
  const ctx = getContext(req.app.locals);
  if (!ctx.inboxStore) return undefined;
  const offset = Number.parseInt(String(req.query.offset ?? '0'), 10);
  return buildPanelList(ctx.inboxStore, {
    tab: parsePanelTab(req.query.tab),
    q: typeof req.query.q === 'string' ? req.query.q : '',
    offset: Number.isFinite(offset) ? offset : 0,
    // Home's full-width list (`wide=1`) adds filters, stars and selection.
    wide: req.query.wide === '1',
    filters: parsePanelFilters(req.query as Record<string, unknown>),
  });
}
inboxRouter.get('/panel/home', (req: Request, res: Response) => {
  const list = panelListFor(req);
  if (!list) { res.status(404).type('html').send('<p>Inbox unavailable.</p>'); return; }
  const ctx = getContext(req.app.locals);
  res.type('html').send(render(renderPanelHome(list, list.wide && ctx.inboxStore ? panelFacets(ctx.inboxStore) : undefined)));
});
inboxRouter.get('/panel/new', (_req: Request, res: Response) => {
  res.type('html').send(render(renderPanelNew()));
});
inboxRouter.get('/panel/list', (req: Request, res: Response) => {
  const list = panelListFor(req);
  if (!list) { res.status(404).type('html').send('<p>Inbox unavailable.</p>'); return; }
  res.setHeader('X-Panel-Tab', list.tab);
  res.setHeader('X-Panel-Has-More', list.hasMore ? '1' : '0');
  res.type('html').send(render(req.query.rows === '1' ? renderPanelRows(list.rows, list.wide) : renderPanelList(list)));
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
  const runBehaviors = buildRunBehaviors(ctx, responses);
  res.type('html').send(render(renderInboxDetailFragment({
    message,
    responses,
    question: questionForMessage(ctx, message),
    triagePending,
    currentTargetYaml,
    inlineActionWidgets,
    runBehaviors,
    threadSummary: responses.length >= 3 ? buildThreadSummary(message, responses) : undefined,
    forkableAgents: listForkableAgents(ctx),
    pendingLearnings: ctx.inboxStore.listLearnings({ messageId: id, status: 'pending' }),
    agentTrust: buildAgentTrustMap(ctx, responses),
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

/**
 * "Ask sua to fix this" on an agent's page: a conversation about the agent,
 * started with sua looking at why it isn't working and drafting a fix you
 * approve (proposeAgentFix). Fetch callers get `X-Inbox-Id` and open it in
 * the panel; a plain form post lands on the thread.
 */
inboxRouter.post('/agents/:id/ask-fix', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agent = ctx.agentStore.getAgent(agentId);
  if (!ctx.inboxStore || !agent) {
    if (isAjax(req)) { res.status(404).json({ error: 'No such agent.' }); return; }
    res.redirect(303, '/agents');
    return;
  }
  const created = ctx.inboxStore.add({
    priority: 'medium',
    source: 'manual',
    agentId: agent.id,
    title: `Fix ${agent.name || agent.id}`,
    body: '(empty)',
  });
  // sua asks first: what you saw is the best lead. Its analysis waits for a
  // click, and replying instead hands sua your description with the agent attached.
  const proposed = proposeAgentFix(ctx, created.id, agent.id,
    `What's going wrong with **${agent.id}**? Tell me what you saw (an error, a wrong answer, too slow), or I can look at its recent runs first. Nothing changes until you approve a fix.`,
    { asks: true });
  if (proposed) ctx.inboxStore.updateStatus(created.id, 'awaiting_user');
  // Archived or otherwise not fixable this way: let sua answer the request itself.
  else {
    ctx.inboxStore.addResponse(created.id, 'user', `\`${agent.id}\` isn't working well. What can I do about it?`);
    void runTriageAgent(ctx, created.id).catch(() => { /* logged in helper */ });
  }
  publishInboxChanged(ctx, created.id, created.status);
  if (isAjax(req)) {
    res.setHeader('X-Inbox-Id', created.id);
    res.status(204).end();
    return;
  }
  res.redirect(303, `/inbox/${encodeURIComponent(created.id)}`);
});

inboxRouter.post('/inbox/new', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.inboxStore) {
    if (isAjax(req)) { res.status(503).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Inbox unavailable.')}`);
    return;
  }
  const titleRaw = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  // Optional first message (the front-door composer). When present, the thread
  // is born with the operator's words as its first `user` message and triage
  // fires immediately — the "type → sua answers" hero flow. When absent, the
  // old behavior stands: an empty stub that /respond seeds later.
  const bodyRaw = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (bodyRaw.length > 8192) {
    if (isAjax(req)) { res.status(400).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message is too long (max 8 KB).')}`);
    return;
  }
  const title = titleRaw.length > 0
    ? titleRaw.slice(0, 200)
    : bodyRaw
      ? deriveTitleFromBody(bodyRaw)
      : DEFAULT_NEW_CONVERSATION_TITLE;
  try {
    const created = ctx.inboxStore.add({
      priority: 'medium',
      source: 'manual',
      title,
      // The thread body stays a placeholder; the conversation lives in
      // responses (the detail view renders responses, not the body).
      body: '(empty)',
    });
    if (bodyRaw) {
      const userResponse = ctx.inboxStore.addResponse(created.id, 'user', bodyRaw);
      publishInboxEvent(ctx, created.id, 'message:created', {
        responseId: userResponse.id, role: 'user', body: bodyRaw, createdAt: userResponse.createdAt,
      });
      // Fire triage now — same path a first /respond takes on a manual thread.
      void runTriageAgent(ctx, created.id).catch(() => { /* logged in helper */ });
    }
    publishInboxChanged(ctx, created.id, created.status);
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
    publishInboxChanged(ctx, id, 'dismissed');
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
    publishInboxChanged(ctx, id, 'resolved');
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
  const dismissedIds: string[] = [];
  for (const id of ids) {
    const row = ctx.inboxStore.get(id);
    if (!row) continue;
    try {
      ctx.inboxStore.dismiss(id);
      dismissed += 1;
      dismissedIds.push(id);
    } catch {
      // Skip per-row failures so one bad id doesn't block the whole bulk action.
    }
  }
  // One coarse global event per dismissed thread so the live list/badge
  // catch up. Published after the loop (not per store call) to keep the
  // hot path tight; the events themselves are idempotent refetch triggers.
  for (const id of dismissedIds) publishInboxChanged(ctx, id, 'dismissed');

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

inboxRouter.post('/inbox/bulk-resolve', (req: Request, res: Response) => {
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

  let resolved = 0;
  const resolvedIds: string[] = [];
  for (const id of ids) {
    const row = ctx.inboxStore.get(id);
    if (!row) continue;
    try {
      // Operator-driven bulk resolve — leave auto_resolved 0 (this isn't a
      // sua-closed loop). Learning extraction fires per thread like the
      // single-thread resolve.
      ctx.inboxStore.updateStatus(id, 'resolved');
      void maybeExtractLearning(ctx, id).catch(() => { /* logged in helper */ });
      resolved += 1;
      resolvedIds.push(id);
    } catch {
      // Skip per-row failures so one bad id doesn't block the whole bulk action.
    }
  }
  for (const id of resolvedIds) publishInboxChanged(ctx, id, 'resolved');

  if (isAjax(req)) {
    res.status(resolved > 0 ? 200 : 404).json({ resolved, requested: ids.length });
    return;
  }
  if (resolved === 0) {
    res.redirect(303, `${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent('No selected messages could be resolved.')}`);
    return;
  }
  const label = resolved === 1 ? 'Resolved 1 message.' : `Resolved ${resolved} messages.`;
  res.redirect(303, `${returnTo}${returnTo.includes('?') ? '&' : '?'}ok=${encodeURIComponent(label)}`);
});

// ════════════════════════════════════════════════════════════════
// Conversation + triage
// ════════════════════════════════════════════════════════════════

/**
 * Answer a run's question (a `question` item from an ask node). The answer
 * is recorded once, and the waiting run resumes. Plain form posts redirect
 * back to the thread; the modal's AJAX posts get 204 and re-fetch.
 */
inboxRouter.post('/inbox/:id/answer', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  const message = ctx.inboxStore?.get(id);
  const question = message ? questionForMessage(ctx, message) : undefined;
  const fail = (status: number, error: string) => {
    if (isAjax(req)) { res.status(status).type('text').send(error); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(error)}`);
  };
  if (!message || !question) { fail(404, 'No question here to answer.'); return; }
  const answer = typeof req.body?.answer === 'string' ? req.body.answer : '';
  if (!answer.trim()) { fail(400, 'The answer is empty.'); return; }
  const result = await answerQuestion(ctx, question, answer);
  if (!result.ok) { fail(409, result.error ?? 'Could not answer.'); return; }
  try { publishInboxChanged(ctx, id, 'resolved'); } catch { /* best-effort */ }
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?flash=${encodeURIComponent('Answered. The run is carrying on.')}`);
});

/**
 * Add the operator's reply to a thread and start the triage turn that
 * answers it. Shared by POST /inbox/:id/respond and the chat WebSocket's
 * `inbox.send` (lib/chat-socket.ts).
 */
export function addInboxReply(
  ctx: ReturnType<typeof getContext>,
  id: string,
  body: string,
): { ok: true } | { ok: false; status: number; message: string } {
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) return { ok: false, status: 404, message: 'Message not found.' };
  const bodyRaw = body.trim();
  if (!bodyRaw) return { ok: false, status: 400, message: 'Reply cannot be empty.' };
  if (bodyRaw.length > 8192) return { ok: false, status: 400, message: 'Reply is too long (max 8 KB).' };
  // A fresh reply is genuine re-engagement, so lift any operator Stop and let
  // triage run again for this turn. Clears both the in-memory set and the
  // persisted `paused` column (the restart-surviving form of Stop).
  ctx.inboxTriageStopped?.delete(id);
  try { ctx.inboxStore.setPaused(id, false); } catch { /* best-effort */ }
  let userResponse;
  try {
    userResponse = ctx.inboxStore.addResponse(id, 'user', bodyRaw);
  } catch (err) {
    return { ok: false, status: 500, message: `Reply failed: ${err instanceof Error ? err.message : String(err)}` };
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
  // Publish so any client watching this thread sees the persisted user
  // reply within a network RTT. The fragment poll fallback still works for
  // clients that haven't subscribed.
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
    // Fire-and-forget; the modal hears about it on the thread's channel.
    void runTriageAgent(ctx, id).catch(() => { /* logged in helper */ });
  }
  return { ok: true };
}

inboxRouter.post('/inbox/:id/respond', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  const out = addInboxReply(ctx, id, typeof req.body?.body === 'string' ? req.body.body : '');
  if (!out.ok) {
    if (isAjax(req)) { res.status(out.status).end(); return; }
    res.redirect(303, out.status === 404
      ? `/inbox?error=${encodeURIComponent(out.message)}`
      : `${detailUrl}?error=${encodeURIComponent(out.message)}`);
    return;
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
 * Force-finalize a run row + any node executions still flagged running, in
 * case the executor's normal teardown didn't fire before the response
 * returns. Mirrors POST /runs/:id/cancel. Shared by the triage-run cancel
 * and the in-flight action cancel in the Stop route.
 */
function forceFinalizeCancelledRun(ctx: ReturnType<typeof getContext>, runId: string): void {
  try {
    const run = ctx.runStore.getRun(runId);
    if (run && (run.status === 'running' || run.status === 'pending')) {
      const completedAt = new Date().toISOString();
      ctx.runStore.updateRun(runId, {
        status: 'cancelled' as RunStatus,
        completedAt,
        error: 'Cancelled by user.',
      });
      const nodeExecs = ctx.runStore.listNodeExecutions(runId);
      for (const exec of nodeExecs) {
        if (exec.status === 'running' || exec.status === 'pending') {
          ctx.runStore.updateNodeExecution(runId, exec.nodeId, {
            status: 'cancelled',
            errorCategory: 'cancelled',
            completedAt,
            error: 'Cancelled by user.',
          });
        }
      }
    }
  } catch { /* ignore */ }
}

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
  // Mark the thread STOPPED regardless of whether a triage run is in flight.
  // The runaway loop is driven by auto-approved ACTIONS completing and
  // refiring triage, so the stop must hold even when the thing running right
  // now is a sub-agent action (no triage abort entry) — maybeRefireTriage and
  // the auto-approve dispatch both honor this flag. Cleared on the next reply.
  if (!ctx.inboxTriageStopped) ctx.inboxTriageStopped = new Set();
  ctx.inboxTriageStopped.add(id);
  // Persist the stop so it survives a dashboard restart — without this the
  // boot reconciler / auto-triage sweeper would happily re-engage a thread
  // the operator explicitly silenced. Cleared on the next reply.
  try { ctx.inboxStore.setPaused(id, true); } catch { /* best-effort */ }
  // Cancel in-flight sub-agent ACTION runs too — Stop halts moving parts,
  // not just the next turn. Local dispatches registered an AbortController
  // in activeRuns; aborting cascades into the executor and the dispatch's
  // own await finalizes the action card as failed through the normal path
  // (with the pause suppressing the follow-up refire). Temporal runs get a
  // best-effort provider cancel + a local force-finalize so the dashboard
  // stops waiting — the worker may still finish server-side.
  const cancelledActionAgents: string[] = [];
  try {
    for (const r of ctx.inboxStore.listResponses(id)) {
      const m = parseActionMeta(r);
      if (!m || m.status !== 'running') continue;
      cancelledActionAgents.push(m.agentId);
      if (m.runId) {
        // Normal case: the dispatch persisted its runId onto the card, so we
        // can reach the registered AbortController / cancel the provider run
        // and force-finalize the run row. The dispatch's own await then
        // settles the action card through the normal finalize path.
        ctx.activeRuns.get(m.runId)?.abort();
        ctx.activeRuns.delete(m.runId);
        try { await ctx.provider.cancelRun(m.runId); } catch { /* best-effort */ }
        forceFinalizeCancelledRun(ctx, m.runId);
      } else {
        // Claimed `running` but no runId yet — the tiny window before the
        // dispatch registers one, or any non-dispatched path. There's no run
        // to abort, so settle the CARD directly to a terminal state; otherwise
        // it stays `running` forever and the modal's pending spinner never
        // clears (the "Stop didn't respond" report). No enum `cancelled` for
        // actions, so use `failed` with an explicit cancel reason.
        const endedAt = Date.now();
        const refusalReason = 'Cancelled by Stop before the run started.';
        try {
          ctx.inboxStore.updateResponse(r.id, {
            metaJson: JSON.stringify({ ...m, status: 'failed', endedAt, refusalReason }),
          });
          publishInboxEvent(ctx, id, 'action:status', {
            responseId: r.id, status: 'failed', agentId: m.agentId, endedAt, refusalReason,
          });
        } catch { /* best-effort */ }
      }
    }
  } catch { /* never let action-cancel break the Stop ack */ }
  const entry = ctx.inboxTriageAbortControllers.get(id);
  if (!entry) {
    // No triage LLM turn in flight, but the stop flag halts the chain and
    // any running actions were just cancelled above. Acknowledge it so the
    // operator sees it took.
    try {
      const note = cancelledActionAgents.length > 0
        ? `Stopped — cancelled ${cancelledActionAgents.length} running action${cancelledActionAgents.length === 1 ? '' : 's'} (${cancelledActionAgents.join(', ')}). Reply to continue.`
        : 'Auto-follow-up stopped. Reply to continue.';
      const sysReply = ctx.inboxStore.addResponse(id, 'system', note);
      publishInboxEvent(ctx, id, 'message:created', {
        responseId: sysReply.id, role: 'system', body: note, createdAt: sysReply.createdAt,
      });
    } catch { /* ignore */ }
    if (isAjax(req)) { res.status(204).end(); return; }
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Stopped.')}`);
    return;
  }
  ctx.inboxTriageAbortControllers.delete(id);
  ctx.activeRuns.delete(entry.runId);
  try { entry.controller.abort(); } catch { /* ignore */ }
  // Provider cancel — belt-and-suspenders for v1 paths and any
  // pid-tracked child processes the executor spawned.
  try { await ctx.provider.cancelRun(entry.runId); } catch { /* ignore */ }
  forceFinalizeCancelledRun(ctx, entry.runId);
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
    publishInboxChanged(ctx, id, 'awaiting_user');
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

/**
 * POST /inbox/trust/mode — set the global autonomy mode. Body: `mode` ∈
 * {full, propose-only, off}. Governs whether trusted actions auto-run and
 * whether new items auto-triage at all (`off` = kill switch).
 */
inboxRouter.post('/inbox/trust/mode', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.inboxStore) {
    if (isAjax(req)) { res.status(503).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Inbox unavailable.')}`);
    return;
  }
  const mode = typeof req.body?.mode === 'string' ? req.body.mode : '';
  if (!AUTONOMY_MODES.includes(mode as AutonomyMode)) {
    if (isAjax(req)) { res.status(400).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Invalid autonomy mode.')}`);
    return;
  }
  try {
    ctx.inboxStore.setAutonomyMode(mode as AutonomyMode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent(`Set mode failed: ${msg}`)}`);
    return;
  }
  const label = mode === 'off' ? 'Autonomy paused' : mode === 'propose-only' ? 'Approval required for all actions' : 'Full autonomy';
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `/inbox?ok=${encodeURIComponent(label)}`);
});

/**
 * POST /inbox/trust/agent — set or clear an agent's trust level. Body:
 * `agentId` + `level` ∈ {auto, propose, default}. `default` clears the
 * explicit policy, reverting to the engine's compiled default.
 */
inboxRouter.post('/inbox/trust/agent', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.inboxStore) {
    if (isAjax(req)) { res.status(503).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Inbox unavailable.')}`);
    return;
  }
  const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId.trim() : '';
  const level = typeof req.body?.level === 'string' ? req.body.level : '';
  if (!agentId || agentId === GLOBAL_TRUST_KEY || !['auto', 'propose', 'default'].includes(level)) {
    if (isAjax(req)) { res.status(400).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent('Invalid trust request.')}`);
    return;
  }
  try {
    if (level === 'default') ctx.inboxStore.clearAgentTrust(agentId);
    else ctx.inboxStore.setAgentTrust(agentId, level as AgentTrustLevel);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `/inbox?error=${encodeURIComponent(`Set trust failed: ${msg}`)}`);
    return;
  }
  if (isAjax(req)) { res.status(204).end(); return; }
  const back = typeof req.body?.returnTo === 'string' && req.body.returnTo.startsWith('/inbox')
    ? req.body.returnTo : '/inbox';
  res.redirect(303, `${back}?ok=${encodeURIComponent('Trust updated.')}`);
});

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
    publishInboxChanged(ctx, id, 'open');
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
    publishInboxChanged(ctx, forked.id, forked.status);
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
  const runningMeta: InboxActionMeta = { ...meta, status: 'running', startedAt, approvedBy: 'operator' };
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
