/**
 * GET /api/items: the item index (ADR-0049, S1). Everything that needs you or
 * matters now, as typed items with stable ids, most urgent first.
 *
 * Query: `kind` (repeatable or comma-separated), `agent`, `ok=0` to leave out
 * healthy context items, `limit` (1..200).
 */
import { Router, type Request, type Response } from 'express';
import { collectItems, itemSourcesFromHandle, ItemDismissals, ITEM_KINDS, type ItemKind } from '@some-useful-agents/core';
import { publishInboxChanged } from './inbox-shared.js';
import { getContext } from '../context.js';
import { readHomeSurface, findSurfaceEntry } from '../lib/home-surface.js';
import { renderItemPane } from '../views/home-surface.js';
import { render } from '../views/html.js';
import type { CompiledEntry } from '@some-useful-agents/core';

export const itemsRouter: Router = Router();

itemsRouter.get('/api/items', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const raw = ([] as unknown[]).concat(req.query.kind ?? []).flatMap((k) => String(k).split(','));
  const kinds = raw.map((k) => k.trim()).filter((k): k is ItemKind => (ITEM_KINDS as readonly string[]).includes(k));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const sources = itemSourcesFromHandle(ctx.runStore.databaseHandle(), ctx.agentStore, ctx.runStore, ctx.dataDir);
  const items = collectItems(sources, {
    ...(kinds.length ? { kinds } : {}),
    ...(typeof req.query.agent === 'string' && req.query.agent ? { agentId: req.query.agent } : {}),
    includeOk: req.query.ok !== '0',
    limit,
  });
  res.json({ items, generatedAt: new Date().toISOString() });
});

/** GET /items/:id/fragment: one item on Home, for the panel's right pane (S3). */
itemsRouter.get('/items/:id/fragment', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const entry = findSurfaceEntry(readHomeSurface(ctx), id) as CompiledEntry | undefined;
  res.type('html').send(render(renderItemPane(entry, id)));
});

/**
 * POST /items/:id/dismiss: off Today until it changes. A conversation is
 * dismissed as a conversation; anything else (an agent problem, a draft, a
 * notebook) is remembered as dismissed, and comes back when something newer
 * happens to it (a new failure, an edit).
 */
itemsRouter.post('/items/:id/dismiss', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  if (id.startsWith('thread:')) {
    const threadId = id.slice('thread:'.length);
    if (!ctx.inboxStore?.get(threadId)) { res.status(404).json({ error: 'That conversation is gone.' }); return; }
    ctx.inboxStore.dismiss(threadId);
    publishInboxChanged(ctx, threadId, 'dismissed');
  } else {
    ItemDismissals.fromHandle(ctx.runStore.databaseHandle()).dismiss(id, 'you');
  }
  res.json({ ok: true, itemId: id });
});

/** POST /items/:id/undismiss: the Undo for a dismiss. */
itemsRouter.post('/items/:id/undismiss', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  if (id.startsWith('thread:')) {
    const threadId = id.slice('thread:'.length);
    if (!ctx.inboxStore?.get(threadId)) { res.status(404).json({ error: 'That conversation is gone.' }); return; }
    ctx.inboxStore.updateStatus(threadId, 'awaiting_user');
    publishInboxChanged(ctx, threadId, 'awaiting_user');
  } else {
    ItemDismissals.fromHandle(ctx.runStore.databaseHandle()).undismiss(id);
  }
  res.json({ ok: true, itemId: id });
});
