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
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  executeAgentDag,
  extractPlanJson,
  parseAgent,
  type RunStatus,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
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
  const rows = ctx.inboxStore ? ctx.inboxStore.list({
    q: q || undefined,
    starred: starred || undefined,
    tag: tag || undefined,
  }) : [];
  const allTags = ctx.inboxStore ? ctx.inboxStore.listAllTags() : [];
  const { sort, dir } = parseSort(req);
  res.type('html').send(renderInboxList({
    rows, sort, dir, flash: parseFlash(req),
    filter: { q, starred, tag },
    allTags,
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
  res.type('html').send(renderInboxDetail({ message, responses, flash: parseFlash(req), triagePending }));
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
  res.type('html').send(render(renderInboxDetailFragment({ message, responses, triagePending })));
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
  try {
    ctx.inboxStore.addResponse(id, 'user', bodyRaw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isAjax(req)) { res.status(500).end(); return; }
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Reply failed: ${msg}`)}`);
    return;
  }
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
    ctx.inboxStore.addResponse(id, 'user', '(Asked triage to take another look.)');
  } catch { /* swallow */ }
  void runTriageAgent(ctx, id).catch(() => { /* swallow */ });
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Triage agent invoked.')}`);
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

// ── helpers ─────────────────────────────────────────────────────────

/**
 * Triage is "pending" if either:
 *   (a) the message has a triageRunId whose run is in flight, OR
 *   (b) the most recent response is from the user, posted in the
 *       last 30 seconds, with no later triage or system reply.
 *
 * Branch (b) covers the unavoidable race between POST /respond
 * returning 204 and the dag-executor inserting its run-store row
 * (which we'd later capture into triageRunId).
 */
function isTriagePending(
  ctx: ReturnType<typeof getContext>,
  message: { triageRunId?: string },
  responses: { role: string; createdAt: number }[],
): boolean {
  if (message.triageRunId) {
    try {
      const run = ctx.runStore.getRun(message.triageRunId);
      if (run && (run.status === 'pending' || run.status === 'running')) return true;
    } catch { /* ignore */ }
  }
  if (responses.length === 0) return false;
  const last = responses[responses.length - 1];
  if (last.role !== 'user') return false;
  return Date.now() - last.createdAt < PENDING_USER_REPLY_WINDOW_MS;
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

  let triage = ctx.agentStore.getAgent(TRIAGE_AGENT_ID);
  if (!triage) {
    try {
      const yamlPath = join(resolve('agents/examples'), `${TRIAGE_AGENT_ID}.yaml`);
      const yamlText = readFileSync(yamlPath, 'utf-8');
      const parsed = parseAgent(yamlText);
      ctx.agentStore.upsertAgent(parsed, 'import', 'Auto-imported for inbox triage');
      triage = ctx.agentStore.getAgent(TRIAGE_AGENT_ID);
    } catch (err) {
      process.stderr.write(
        `[inbox-triage] could not load agent yaml: ${(err as Error)?.message ?? String(err)}\n`,
      );
      return;
    }
  }
  if (!triage) return;

  const conversation = ctx.inboxStore.listResponses(messageId)
    .map((r) => `[${r.role}] ${r.body}`)
    .join('\n');

  let runId: string | undefined;
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
        },
      },
      {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot,
      },
    );
    // Capture the runId once it lands. Race the executor to avoid
    // blocking the auto-fire path; the conversation-based pending
    // heuristic carries us through if this misses.
    await Promise.race([runPromise, new Promise((r) => setTimeout(r, 250))]);
    const { rows } = ctx.runStore.queryRuns({
      agentName: TRIAGE_AGENT_ID,
      statuses: ['running', 'completed', 'failed', 'pending'] as RunStatus[],
      limit: 1,
      offset: 0,
    });
    const recent = rows[0];
    if (recent) {
      runId = recent.id;
      try {
        ctx.inboxStore.updateStatus(
          messageId,
          message.status === 'open' ? 'triaged' : message.status,
          { triageRunId: runId },
        );
      } catch { /* ignore — message may have been dismissed mid-flight */ }
    }
    const finished = await runPromise;
    void finished;

    const run = runId ? ctx.runStore.getRun(runId) : null;
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
    let parsed: { recommendation?: unknown; verifyHint?: unknown };
    try {
      parsed = JSON.parse(planJson);
    } catch {
      ctx.inboxStore.addResponse(messageId, 'system', 'Triage agent returned malformed JSON.');
      return;
    }
    const rec = typeof parsed.recommendation === 'string' ? parsed.recommendation.trim() : '';
    if (!rec || rec.length < 10 || rec.length > 2000) {
      ctx.inboxStore.addResponse(messageId, 'system', 'Triage agent recommendation failed validation.');
      return;
    }
    const verifyHint = typeof parsed.verifyHint === 'string' && parsed.verifyHint.trim()
      ? parsed.verifyHint.trim()
      : undefined;
    ctx.inboxStore.addResponse(
      messageId,
      'triage',
      rec,
      verifyHint ? JSON.stringify({ verifyHint }) : undefined,
    );
    try {
      ctx.inboxStore.updateStatus(messageId, 'awaiting_user', { recommendation: rec, triageRunId: runId });
    } catch { /* ignore */ }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[inbox-triage] run failed: ${msg}\n${(err as Error)?.stack ?? ''}\n`);
    try {
      ctx.inboxStore.addResponse(messageId, 'system', `Triage agent crashed: ${msg}`);
    } catch { /* ignore */ }
  }
}
