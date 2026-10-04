/**
 * GET /api/items: the item index (ADR-0049, S1). Everything that needs you or
 * matters now, as typed items with stable ids, most urgent first.
 *
 * Query: `kind` (repeatable or comma-separated), `agent`, `ok=0` to leave out
 * healthy context items, `limit` (1..200).
 */
import { Router, type Request, type Response } from 'express';
import { collectItems, itemSourcesFromHandle, ITEM_KINDS, type ItemKind } from '@some-useful-agents/core';
import { getContext } from '../context.js';

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
