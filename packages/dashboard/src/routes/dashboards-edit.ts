/**
 * Editor routes for stored dashboards.
 *
 * Each action mutates the layout via DashboardsStore.updateLayout and
 * 303s back to the editor. No JS, no batching — every click is one
 * server round-trip.
 */

import { Router, type Request, type Response } from 'express';
import { allocateUserDashboardId, mutateSections } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderDashboardEditPage } from '../views/dashboard-edit.js';
import { renderNotFoundPage } from '../views/not-found.js';
import { maybeKickoffFirstRun } from './dashboard-first-run.js';

export const dashboardsEditRouter: Router = Router();

const DASHBOARD_ID_RE = /^[a-z0-9][a-z0-9:_-]*$/;

dashboardsEditRouter.get('/dashboards/:id/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.dashboardsStore) {
    res.status(404).type('html').send(renderNotFoundPage({
      path: req.originalUrl,
      message: 'Dashboards store unavailable.',
    }));
    return;
  }
  const id = pickId(req);
  const dashboard = ctx.dashboardsStore.getDashboard(id);
  if (!dashboard) {
    res.status(404).type('html').send(renderNotFoundPage({
      path: req.originalUrl,
      message: `No dashboard with id "${id}".`,
    }));
    return;
  }
  // Only signal-bearing agents can render as Pulse tiles. Filter so the
  // add-tile dropdown doesn't surface agents that would render empty.
  const signalAgents = ctx.agentStore.listAgents().filter((a) => a.signal);
  res.type('html').send(renderDashboardEditPage({
    dashboard,
    signalAgents,
    flash: parseFlash(req),
  }));
});

// ── Layout mutations (one redirect per action) ─────────────────────────────

dashboardsEditRouter.post('/dashboards/:id/sections', (req: Request, res: Response) => {
  withDashboard(req, res, (id, dashboard, ctx) => {
    const title = pickString(req.body, 'title');
    if (!title) return redirectErr(res, id, 'Section title is required.');
    const sections = [...dashboard.layout.sections, { title, agentIds: [] }];
    ctx.dashboardsStore!.updateLayout(id, { sections });
    redirectOk(res, id, `Added section "${title}".`);
  });
});

dashboardsEditRouter.post('/dashboards/:id/sections/:idx/rename', (req: Request, res: Response) => {
  withDashboard(req, res, (id, dashboard, ctx) => {
    const idx = parseInt(pickParam(req, 'idx'), 10);
    const title = pickString(req.body, 'title');
    if (!title) return redirectErr(res, id, 'Title is required.');
    const sections = mutateSections(dashboard.layout, (arr) => {
      if (!arr[idx]) throw new Error('Section index out of range.');
      arr[idx] = { ...arr[idx], title };
    });
    ctx.dashboardsStore!.updateLayout(id, { sections });
    redirectOk(res, id, `Renamed.`);
  });
});

dashboardsEditRouter.post('/dashboards/:id/sections/:idx/delete', (req: Request, res: Response) => {
  withDashboard(req, res, (id, dashboard, ctx) => {
    const idx = parseInt(pickParam(req, 'idx'), 10);
    const sections = mutateSections(dashboard.layout, (arr) => {
      if (!arr[idx]) throw new Error('Section index out of range.');
      arr.splice(idx, 1);
    });
    ctx.dashboardsStore!.updateLayout(id, { sections });
    redirectOk(res, id, `Section removed.`);
  });
});

dashboardsEditRouter.post('/dashboards/:id/sections/:idx/move', (req: Request, res: Response) => {
  withDashboard(req, res, (id, dashboard, ctx) => {
    const idx = parseInt(pickParam(req, 'idx'), 10);
    const dir = req.query.dir === 'down' ? 'down' : 'up';
    const sections = mutateSections(dashboard.layout, (arr) => {
      if (!arr[idx]) throw new Error('Section index out of range.');
      const target = dir === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= arr.length) return;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
    });
    ctx.dashboardsStore!.updateLayout(id, { sections });
    redirectOk(res, id, `Section moved ${dir}.`);
  });
});

dashboardsEditRouter.post('/dashboards/:id/sections/:idx/tiles', (req: Request, res: Response) => {
  withDashboard(req, res, (id, dashboard, ctx) => {
    const idx = parseInt(pickParam(req, 'idx'), 10);
    const agentId = pickString(req.body, 'agentId');
    if (!agentId) return redirectErr(res, id, 'agentId is required.');
    const alreadyPresent = dashboard.layout.sections[idx]?.agentIds.includes(agentId) ?? false;
    const sections = mutateSections(dashboard.layout, (arr) => {
      if (!arr[idx]) throw new Error('Section index out of range.');
      if (arr[idx].agentIds.includes(agentId)) return; // already there
      arr[idx] = { ...arr[idx], agentIds: [...arr[idx].agentIds, agentId] };
    });
    ctx.dashboardsStore!.updateLayout(id, { sections });
    // Newly added tile renders blank until its agent has output — fire a
    // courtesy run so it populates in place. Skip if it was already in the
    // section (no-op add).
    if (!alreadyPresent) maybeKickoffFirstRun(ctx, agentId);
    // returnTo=live = in-place add-tile modal on /dashboards/:id; default
    // is the editor at /dashboards/:id/edit.
    if (pickString(req.body, 'returnTo') === 'live') {
      res.redirect(303, `/dashboards/${encodeURIComponent(id)}?ok=${encodeURIComponent(`Added "${agentId}".`)}`);
      return;
    }
    redirectOk(res, id, `Added "${agentId}".`);
  });
});

dashboardsEditRouter.post('/dashboards/:id/sections/:idx/tiles/:tileIdx/delete', (req: Request, res: Response) => {
  withDashboard(req, res, (id, dashboard, ctx) => {
    const idx = parseInt(pickParam(req, 'idx'), 10);
    const tileIdx = parseInt(pickParam(req, 'tileIdx'), 10);
    const sections = mutateSections(dashboard.layout, (arr) => {
      if (!arr[idx] || !arr[idx].agentIds[tileIdx]) throw new Error('Tile index out of range.');
      const agentIds = [...arr[idx].agentIds];
      agentIds.splice(tileIdx, 1);
      arr[idx] = { ...arr[idx], agentIds };
    });
    ctx.dashboardsStore!.updateLayout(id, { sections });
    // The × button on a tile in the dashboard view (not the
    // edit-sections page) passes returnTo=dashboard so we land the
    // user back where they were, instead of bouncing them to
    // /dashboards/<id>/edit. The flash carries through to either page.
    const returnTo = typeof req.body?.returnTo === 'string' ? req.body.returnTo : '';
    if (returnTo === 'dashboard') {
      // If that was the last tile, flag the redirect so the dashboard
      // view can offer to delete the now-empty dashboard. Only for
      // user-owned dashboards — pack-owned ones can't be deleted here.
      const remainingTiles = sections.reduce((n, s) => n + s.agentIds.length, 0);
      const offerDelete = remainingTiles === 0 && dashboard.packId === null;
      const suffix = offerDelete ? '&emptyDashboard=1' : '';
      res.redirect(303, `/dashboards/${encodeURIComponent(id)}?ok=${encodeURIComponent('Tile removed.')}${suffix}`);
      return;
    }
    redirectOk(res, id, `Tile removed.`);
  });
});

dashboardsEditRouter.post('/dashboards/:id/sections/:idx/tiles/:tileIdx/move', (req: Request, res: Response) => {
  withDashboard(req, res, (id, dashboard, ctx) => {
    const idx = parseInt(pickParam(req, 'idx'), 10);
    const tileIdx = parseInt(pickParam(req, 'tileIdx'), 10);
    const dir = req.query.dir === 'down' ? 'down' : 'up';
    const sections = mutateSections(dashboard.layout, (arr) => {
      if (!arr[idx] || !arr[idx].agentIds[tileIdx]) throw new Error('Tile index out of range.');
      const agentIds = [...arr[idx].agentIds];
      const target = dir === 'up' ? tileIdx - 1 : tileIdx + 1;
      if (target < 0 || target >= agentIds.length) return;
      [agentIds[tileIdx], agentIds[target]] = [agentIds[target], agentIds[tileIdx]];
      arr[idx] = { ...arr[idx], agentIds };
    });
    ctx.dashboardsStore!.updateLayout(id, { sections });
    redirectOk(res, id, `Tile moved ${dir}.`);
  });
});

dashboardsEditRouter.post('/dashboards/:id/rename', (req: Request, res: Response) => {
  withDashboard(req, res, (id, dashboard, ctx) => {
    const name = pickString(req.body, 'name');
    if (!name) return redirectErr(res, id, 'Dashboard name is required.');
    // Rename = re-upsert with the existing packId + layout; upsert preserves
    // createdAt. Allowed on pack-owned dashboards too (like section/tile edits);
    // only deletion is restricted to pack uninstall.
    ctx.dashboardsStore!.upsertDashboard({ id, packId: dashboard.packId, name, layout: dashboard.layout });
    redirectOk(res, id, `Renamed to "${name}".`);
  });
});

dashboardsEditRouter.post('/dashboards/:id/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.dashboardsStore) {
    res.status(404).redirect(303, '/pulse');
    return;
  }
  const id = pickId(req);
  const dashboard = ctx.dashboardsStore.getDashboard(id);
  if (!dashboard) {
    res.status(404).redirect(303, '/pulse');
    return;
  }
  if (dashboard.packId !== null) {
    res.redirect(303, `/dashboards/${encodeURIComponent(id)}/edit?error=${encodeURIComponent('Pack-owned dashboards can\'t be deleted directly. Uninstall the pack instead.')}`);
    return;
  }
  ctx.dashboardsStore.deleteDashboard(id);
  res.redirect(303, '/pulse?ok=Dashboard+deleted.');
});

// ── Create new user dashboard ──────────────────────────────────────────────

dashboardsEditRouter.post('/dashboards', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.dashboardsStore) {
    res.redirect(303, '/pulse?error=Dashboards+store+unavailable.');
    return;
  }
  const name = pickString(req.body, 'name');
  if (!name) {
    res.redirect(303, '/pulse?error=Dashboard+name+is+required.');
    return;
  }
  // Generate a slug; collision-resistant via timestamp suffix if needed.
  const id = allocateUserDashboardId(name, (cand) => Boolean(ctx.dashboardsStore!.getDashboard(cand)));
  ctx.dashboardsStore.upsertDashboard({ id, packId: null, name, layout: { sections: [] } });
  res.redirect(303, `/dashboards/${encodeURIComponent(id)}/edit?ok=Dashboard+created.`);
});

// ── Helpers ────────────────────────────────────────────────────────────────

function withDashboard(
  req: Request,
  res: Response,
  fn: (
    id: string,
    dashboard: NonNullable<ReturnType<NonNullable<ReturnType<typeof getContext>['dashboardsStore']>['getDashboard']>>,
    ctx: ReturnType<typeof getContext>,
  ) => void,
): void {
  const ctx = getContext(req.app.locals);
  if (!ctx.dashboardsStore) {
    res.status(503).redirect(303, '/pulse');
    return;
  }
  const id = pickId(req);
  const dashboard = ctx.dashboardsStore.getDashboard(id);
  if (!dashboard) {
    res.status(404).redirect(303, '/pulse');
    return;
  }
  try {
    fn(id, dashboard, ctx);
  } catch (err) {
    redirectErr(res, id, err instanceof Error ? err.message : String(err));
  }
}

function pickId(req: Request): string {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!DASHBOARD_ID_RE.test(raw)) {
    throw new Error(`Invalid dashboard id: ${raw}`);
  }
  return raw;
}

function pickParam(req: Request, name: string): string {
  const raw = req.params[name];
  return Array.isArray(raw) ? raw[0] : (raw ?? '');
}

function pickString(body: unknown, name: string): string {
  if (!body || typeof body !== 'object') return '';
  const v = (body as Record<string, unknown>)[name];
  return typeof v === 'string' ? v.trim() : '';
}

function redirectOk(res: Response, id: string, message: string): void {
  res.redirect(303, `/dashboards/${encodeURIComponent(id)}/edit?ok=${encodeURIComponent(message)}`);
}

function redirectErr(res: Response, id: string, message: string): void {
  res.redirect(303, `/dashboards/${encodeURIComponent(id)}/edit?error=${encodeURIComponent(message)}`);
}

function parseFlash(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  if (typeof req.query.ok === 'string') return { kind: 'ok', message: req.query.ok };
  if (typeof req.query.error === 'string') return { kind: 'error', message: req.query.error };
  if (typeof req.query.info === 'string') return { kind: 'info', message: req.query.info };
  return undefined;
}
