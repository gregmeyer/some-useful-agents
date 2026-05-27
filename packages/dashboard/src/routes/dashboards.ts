/**
 * Routes for `/dashboards/:id` — render a stored dashboard.
 *
 * The Default Dashboard backing /pulse is NOT served from here; it
 * stays in routes/pulse.ts (synthesised from pulseVisible). This
 * router only handles named, persisted dashboards from
 * DashboardsStore — pack-owned (e.g. "starter:media") or user-created
 * (added via the editor in PR 5).
 */

import { Router, type Request, type Response } from 'express';
import { dashboardToPackManifest, type Agent, type AgentSignal } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import {
  renderDashboardPage,
  type AvailableAgent,
  type DashboardSectionRender,
} from '../views/dashboards.js';
import { buildPulseTile, attachLayoutHints } from '../views/pulse-tile-builder.js';
import type { PulseTile } from '../views/pulse-types.js';
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

  // Build tiles for each section. Agents that aren't installed render
  // as muted placeholder cards so the user knows what's missing.
  const sections: DashboardSectionRender[] = dashboard.layout.sections.map((s) => {
    const tiles: PulseTile[] = [];
    const missingAgentIds: string[] = [];
    for (const agentId of s.agentIds) {
      const agent = ctx.agentStore.getAgent(agentId);
      if (!agent || !agent.signal) {
        missingAgentIds.push(agentId);
        continue;
      }
      tiles.push(buildPulseTile(agent as Agent & { signal: AgentSignal }, { runStore: ctx.runStore }));
    }
    // Decorate with the agent-global hint first, then layer this
    // section's per-placement overrides on top. Each defined placement
    // field wins; undefined fields fall through to the hint, signal,
    // or default — same precedence as Pulse, plus a dashboard-scoped
    // layer above it.
    attachLayoutHints(tiles, ctx.layoutHintsStore);
    if (s.placements) {
      for (const tile of tiles) {
        const placement = s.placements[tile.agent.id];
        if (!placement) continue;
        const base = tile.layoutHint ?? { agentId: tile.agent.id, updatedAt: 0 };
        tile.layoutHint = {
          ...base,
          ...(placement.size !== undefined ? { size: placement.size } : {}),
          ...(placement.tileFit !== undefined ? { tileFit: placement.tileFit } : {}),
          ...(placement.height !== undefined ? { height: placement.height } : {}),
        };
      }
    }
    return { title: s.title, tiles, missingAgentIds, agentIds: [...s.agentIds] };
  });

  const installedDashboards = ctx.dashboardsStore.listDashboards();
  const flash = parseFlash(req);

  // Pool of agents the user could add to any section: every signal-bearing
  // agent. The modal filters out ones already placed in the section it was
  // opened from, but we expose the whole pool so the "Suggested" row (by
  // recency) is stable across sections.
  const availableAgents: AvailableAgent[] = ctx.agentStore
    .listAgents()
    .filter((a) => a.signal)
    .map((a) => {
      let lastFiredAt: string | null = null;
      try {
        const recent = ctx.runStore.listRuns({ agentName: a.id, limit: 1 });
        if (recent.length > 0) lastFiredAt = recent[0].startedAt;
      } catch { /* no runs */ }
      return {
        id: a.id,
        name: a.name,
        icon: a.signal?.icon ?? null,
        template: a.signal?.template ?? null,
        description: a.description ?? null,
        lastFiredAt,
      };
    });

  // Offer to delete the dashboard when the tile-delete redirect flagged
  // it empty (?emptyDashboard=1), it's user-owned, and it really has no
  // tiles left. Server-driven so the client doesn't depend on parsing
  // the query string itself.
  const totalTiles = sections.reduce((n, s) => n + s.tiles.length + s.missingAgentIds.length, 0);
  const offerDeleteEmpty = req.query.emptyDashboard === '1'
    && dashboard.packId === null
    && totalTiles === 0;

  res.type('html').send(renderDashboardPage({
    dashboard,
    sections,
    installedDashboards,
    availableAgents,
    flash,
    offerDeleteEmpty,
  }));
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
  const dashboard = ctx.dashboardsStore.getDashboard(id);
  if (!dashboard) {
    res.status(404).type('html').send(renderNotFoundPage({ path: req.originalUrl, message: `No dashboard with id "${id}".` }));
    return;
  }

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
