/**
 * Routes for the Inbox surface:
 *
 *   GET  /inbox                 — single sortable grid of active items
 *   GET  /inbox/:id             — full-page detail (fallback, direct link)
 *   GET  /inbox/:id/fragment    — inner detail HTML for the modal
 *   POST /inbox/:id/dismiss     — terminal-state the message
 *   POST /inbox/:id/respond     — append user-role response; auto-fires triage
 *   POST /inbox/:id/triage      — run the inbox-triage system agent; on
 *                                 completion the result is parsed and
 *                                 appended as a triage-role response
 *
 * Mutation routes return:
 *   - 303 redirect for non-AJAX (form posts without fetch) so the
 *     existing detail page still works
 *   - 204 with no body for AJAX (modal's fetch wrapper)
 *
 * The `Accept: text/html` heuristic plus the explicit
 * `X-Requested-With: fetch` header (set by the modal JS) keep the two
 * cases distinguishable without sniffing user agents.
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
  // The modal JS uses fetch with default headers; supertest tests use
  // the same. We treat any non-form-encoded Accept of application/json
  // OR a fetch-style XHR header as "wants 204 not 303". Form posts
  // from the fallback detail page get the redirect.
  const xrw = req.get('x-requested-with');
  if (xrw && xrw.toLowerCase() === 'fetch') return true;
  const accept = req.get('accept') ?? '';
  return accept.includes('application/json');
}

inboxRouter.get('/inbox', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const rows = ctx.inboxStore ? ctx.inboxStore.list() : [];
  const { sort, dir } = parseSort(req);
  res.type('html').send(renderInboxList({ rows, sort, dir, flash: parseFlash(req) }));
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
  const triagePending = isTriagePending(req, message.triageRunId);
  res.type('html').send(renderInboxDetail({ message, responses, flash: parseFlash(req), triagePending }));
});

/**
 * The modal's fetch target. Returns the same content as the detail
 * page but without layout chrome, so it can be injected directly into
 * the modal's content container.
 */
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
  const triagePending = isTriagePending(req, message.triageRunId);
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
  // Auto-trigger triage so the agent joins the conversation. Fire and
  // forget — the modal polls /fragment for the response. Failures are
  // logged via the dashboard's error middleware; the user's reply is
  // safely stored regardless.
  void runTriageAgent(ctx, id).catch(() => { /* logged inside */ });

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
  void runTriageAgent(ctx, id).catch(() => { /* swallow */ });
  if (isAjax(req)) { res.status(204).end(); return; }
  res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Triage agent invoked.')}`);
});

// ── helpers ─────────────────────────────────────────────────────────

/**
 * Is the triage agent currently running for this message? We use the
 * message's recorded triageRunId + the run-store's status. Cheap
 * read; modal poll calls it every 1.5s while the spinner is visible.
 */
function isTriagePending(req: Request, triageRunId: string | undefined): boolean {
  if (!triageRunId) return false;
  const ctx = getContext(req.app.locals);
  try {
    const run = ctx.runStore.getRun(triageRunId);
    if (!run) return false;
    return run.status === 'pending' || run.status === 'running';
  } catch { return false; }
}

/**
 * Spawn the inbox-triage system agent for a given message. Loads the
 * YAML from `agents/examples/inbox-triage.yaml` on first call and
 * upserts it into the agent store (mirrors how layout-planner is
 * lazy-installed). After the run completes, parses the
 * `<plan>{...}</plan>` block and appends a `triage`-role response to
 * the message's conversation thread + transitions the message status
 * to `triaged`.
 */
async function runTriageAgent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): Promise<void> {
  if (!ctx.inboxStore) return;
  const message = ctx.inboxStore.get(messageId);
  if (!message) return;

  // Lazy-install the triage agent from disk.
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

  // Snapshot the conversation so the LLM sees prior turns. The thread
  // is appended after we start the agent run too, but the snapshot at
  // start time is what the agent reasons over for THIS turn.
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
    // Record the runId on the message so the modal can poll
    // `/fragment` and see triagePending=true while it runs. Race the
    // dag-executor so we get the runId without blocking.
    await Promise.race([runPromise, new Promise((r) => setTimeout(r, 200))]);
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
        ctx.inboxStore.updateStatus(messageId, message.status === 'open' ? 'triaged' : message.status, { triageRunId: runId });
      } catch { /* ignore — message may have been dismissed mid-flight */ }
    }
    const finished = await runPromise;
    void finished; // result text accessed via the runStore record below

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
    let parsed: { messageId?: unknown; recommendation?: unknown; verifyHint?: unknown };
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
    // Mirror the recommendation onto the message itself for the
    // recommendation-card render path (full detail page).
    try {
      ctx.inboxStore.updateStatus(messageId, 'awaiting_user', { recommendation: rec, triageRunId: runId });
    } catch { /* ignore terminal-state races */ }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[inbox-triage] run failed: ${msg}\n${(err as Error)?.stack ?? ''}\n`);
    try {
      ctx.inboxStore.addResponse(messageId, 'system', `Triage agent crashed: ${msg}`);
    } catch { /* ignore */ }
  }
}
