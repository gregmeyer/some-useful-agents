/**
 * Routes for `/dashboards/:id` — render a stored dashboard.
 *
 * The Default Dashboard backing /pulse is NOT served from here; it
 * stays in routes/pulse.ts (synthesised from pulseVisible). This
 * router only handles named, persisted dashboards from
 * DashboardsStore — pack-owned (e.g. "starter:media") or user-created
 * (added via the editor in PR 5).
 */

import { renderBoardPage } from './boards.js';
import { Router, type Request, type Response } from 'express';
import { BoardsStore, dashboardToPackManifest, sectionsFromBoardDoc, sectionsFromBoardItems } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderNotFoundPage } from '../views/not-found.js';

export const dashboardsRouter: Router = Router();

dashboardsRouter.get('/dashboards/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.dashboardsStore) {
    res.status(404).type('html').send(renderNotFoundPage({
      path: req.originalUrl,
      message: 'Dashboards store unavailable.',
    }));
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const dashboard = ctx.dashboardsStore.getDashboard(id);
  if (!dashboard) {
    res.status(404).type('html').send(renderNotFoundPage({
      path: req.originalUrl,
      message: `No dashboard with id "${id}".`,
    }));
    return;
  }
  res.type('html').send(renderBoardPage(ctx, id, { flash: parseFlash(req) })!);
});

/**
 * GET /dashboards/:id/export — download the dashboard as a Pack manifest YAML.
 *
 * Bundles the dashboard's layout + each agent it references (full YAML
 * inlined). Round-trips through pack-loader: the file the browser
 * downloads is parseable by `packManifestSchema` + installable via
 * `installPack` once dropped in the right directory.
 *
 * Missing agents (referenced in sections but not in agentStore) are
 * silently dropped from the export — surfaced as a header for the
 * caller's awareness.
 */
dashboardsRouter.get('/dashboards/:id/export', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.dashboardsStore) {
    res.status(404).type('html').send(renderNotFoundPage({ path: req.originalUrl, message: 'Dashboards store unavailable.' }));
    return;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const stored = ctx.dashboardsStore.getDashboard(id);
  if (!stored) {
    res.status(404).type('html').send(renderNotFoundPage({ path: req.originalUrl, message: `No dashboard with id "${id}".` }));
    return;
  }
  // Once the dashboard has been arranged as a board, the pack carries the
  // board's layout (headings become sections, in reading order).
  const board = new BoardsStore(ctx.runStore.databaseHandle()).get(id);
  const dashboard = board ? { ...stored, layout: { sections: board.doc ? sectionsFromBoardDoc(board.doc) : sectionsFromBoardItems(board.items) } } : stored;

  // Resolve the agents the dashboard references.
  const agentIds = new Set<string>();
  for (const s of dashboard.layout.sections) for (const aid of s.agentIds) agentIds.add(aid);
  const agents = Array.from(agentIds)
    .map((aid) => ctx.agentStore.getAgent(aid))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const result = dashboardToPackManifest({ dashboard, agents });

  // Suggest a sensible filename. Browsers honour `attachment;
  // filename="..."` for download dialogs.
  const filename = `${result.manifest.id}.pack.yaml`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (result.missingAgentIds.length) {
    res.setHeader('X-Pack-Missing-Agents', result.missingAgentIds.join(','));
  }
  res.type('text/yaml').send(result.yaml);
});

function parseFlash(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  if (typeof req.query.ok === 'string') return { kind: 'ok', message: req.query.ok };
  if (typeof req.query.error === 'string') return { kind: 'error', message: req.query.error };
  if (typeof req.query.info === 'string') return { kind: 'info', message: req.query.info };
  return undefined;
}
