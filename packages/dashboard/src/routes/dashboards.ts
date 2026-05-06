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
import type { Agent, AgentSignal } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import {
  renderDashboardPage,
  type DashboardSectionRender,
} from '../views/dashboards.js';
import { buildPulseTile } from '../views/pulse-tile-builder.js';
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
    const tiles = [];
    const missingAgentIds: string[] = [];
    for (const agentId of s.agentIds) {
      const agent = ctx.agentStore.getAgent(agentId);
      if (!agent || !agent.signal) {
        missingAgentIds.push(agentId);
        continue;
      }
      tiles.push(buildPulseTile(agent as Agent & { signal: AgentSignal }, { runStore: ctx.runStore }));
    }
    return { title: s.title, tiles, missingAgentIds };
  });

  const installedDashboards = ctx.dashboardsStore.listDashboards();
  const flash = parseFlash(req);

  res.type('html').send(renderDashboardPage({
    dashboard,
    sections,
    installedDashboards,
    flash,
  }));
});

function parseFlash(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  if (typeof req.query.ok === 'string') return { kind: 'ok', message: req.query.ok };
  if (typeof req.query.error === 'string') return { kind: 'error', message: req.query.error };
  if (typeof req.query.info === 'string') return { kind: 'info', message: req.query.info };
  return undefined;
}
