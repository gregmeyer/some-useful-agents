/**
 * Routes for the Inbox surface:
 *   GET  /inbox                  — single sortable grid of active items
 *   GET  /inbox/:id              — message detail + conversation thread
 *   POST /inbox/:id/dismiss      — set status='dismissed' + redirect
 *   POST /inbox/:id/respond      — append a user reply to the thread
 *
 * The triage agent (auto-classify + recommend) and source-specific
 * action buttons (e.g. allow-host, retry-run) ship in a follow-up PR.
 */

import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import {
  renderInboxList,
  type InboxSortKey,
  type InboxSortDir,
  INBOX_DEFAULT_SORT,
} from '../views/inbox-list.js';
import { renderInboxDetail } from '../views/inbox-detail.js';
import { renderNotFoundPage } from '../views/not-found.js';

export const inboxRouter: Router = Router();

const SORT_KEYS = new Set<InboxSortKey>(['priority', 'source', 'agent', 'title', 'age', 'status']);
const SORT_DIRS = new Set<InboxSortDir>(['asc', 'desc']);

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
  res.type('html').send(renderInboxDetail({ message, responses, flash: parseFlash(req) }));
});

/**
 * POST /inbox/:id/dismiss — terminal-state the message and redirect
 * back to the inbox grid. Idempotent: dismissing an already-dismissed
 * message is a no-op.
 */
inboxRouter.post('/inbox/:id/dismiss', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  try {
    ctx.inboxStore.dismiss(id);
    res.redirect(303, `/inbox?ok=${encodeURIComponent('Dismissed.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/inbox/${encodeURIComponent(id)}?error=${encodeURIComponent(`Dismiss failed: ${msg}`)}`);
  }
});

/**
 * POST /inbox/:id/respond — append a `user`-role entry to the
 * conversation thread. Body: `body` (urlencoded form field). The
 * eventual triage agent will read these as the operator's side of
 * the dialogue.
 */
inboxRouter.post('/inbox/:id/respond', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detailUrl = `/inbox/${encodeURIComponent(id)}`;
  if (!ctx.inboxStore || !ctx.inboxStore.get(id)) {
    res.redirect(303, `/inbox?error=${encodeURIComponent('Message not found.')}`);
    return;
  }
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) {
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent('Reply cannot be empty.')}`);
    return;
  }
  // Cap reply size to keep one runaway paste from bloating the DB.
  // 8 KB is generous for human-typed text and an order of magnitude
  // beyond what an LLM-driven reply would carry.
  if (body.length > 8192) {
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent('Reply is too long (max 8 KB).')}`);
    return;
  }
  try {
    ctx.inboxStore.addResponse(id, 'user', body);
    res.redirect(303, `${detailUrl}?ok=${encodeURIComponent('Reply added.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `${detailUrl}?error=${encodeURIComponent(`Reply failed: ${msg}`)}`);
  }
});
