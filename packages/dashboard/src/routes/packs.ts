/**
 * Routes for `/packs` — browse, view, install, uninstall widget packs.
 *
 * Built on the PacksStore + DashboardsStore from PR 1 and the
 * installPack / uninstallPack orchestration from PR 2. The pack
 * registry is auto-populated by the daemon's loadBuiltinPacks call;
 * users see and act on those packs here.
 */

import { Router, type Request, type Response } from 'express';
import { installPack, uninstallPack } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderPacksList, renderPackDetail } from '../views/packs.js';

export const packsRouter: Router = Router();

packsRouter.get('/packs', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.packsStore) {
    // Stores not initialised (e.g. test harness skipped them). Render an
    // empty list rather than 500.
    res.type('html').send(renderPacksList({ packs: [] }));
    return;
  }
  const flash = parseFlash(req);
  res.type('html').send(renderPacksList({ packs: ctx.packsStore.listPacks(), flash }));
});

packsRouter.get('/packs/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.packsStore) {
    res.status(404).redirect(303, '/packs');
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const pack = ctx.packsStore.getPack(id);
  if (!pack) {
    res.status(404).redirect(303, '/packs');
    return;
  }
  const flash = parseFlash(req);
  res.type('html').send(renderPackDetail({ pack, flash }));
});

packsRouter.post('/packs/:id/install', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.packsStore || !ctx.dashboardsStore) {
    res.status(503).redirect(303, '/packs');
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const result = installPack(id, {
      packsStore: ctx.packsStore,
      dashboardsStore: ctx.dashboardsStore,
      agentStore: ctx.agentStore,
    });
    const parts: string[] = [];
    if (result.dashboardsCreated.length) parts.push(`${result.dashboardsCreated.length} dashboard${result.dashboardsCreated.length === 1 ? '' : 's'}`);
    if (result.agentsCreated.length) parts.push(`${result.agentsCreated.length} agent${result.agentsCreated.length === 1 ? '' : 's'}`);
    const detail = parts.length ? ` (${parts.join(', ')})` : '';
    res.redirect(303, `/packs/${encodeURIComponent(id)}?ok=${encodeURIComponent('Installed' + detail + '.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/packs/${encodeURIComponent(id)}?error=${encodeURIComponent('Install failed: ' + msg)}`);
  }
});

packsRouter.post('/packs/:id/uninstall', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.packsStore || !ctx.dashboardsStore) {
    res.status(503).redirect(303, '/packs');
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const result = uninstallPack(id, {
      packsStore: ctx.packsStore,
      dashboardsStore: ctx.dashboardsStore,
    });
    res.redirect(303, `/packs/${encodeURIComponent(id)}?ok=${encodeURIComponent(`Uninstalled (${result.dashboardsRemoved} dashboard${result.dashboardsRemoved === 1 ? '' : 's'} removed; agents kept).`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/packs/${encodeURIComponent(id)}?error=${encodeURIComponent('Uninstall failed: ' + msg)}`);
  }
});

function parseFlash(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  if (typeof req.query.ok === 'string') return { kind: 'ok', message: req.query.ok };
  if (typeof req.query.error === 'string') return { kind: 'error', message: req.query.error };
  if (typeof req.query.info === 'string') return { kind: 'info', message: req.query.info };
  return undefined;
}
