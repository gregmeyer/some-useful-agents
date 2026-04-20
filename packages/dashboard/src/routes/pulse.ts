import { Router, type Request, type Response } from 'express';
import { parseAgent, type Run } from '@some-useful-agents/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getContext } from '../context.js';
import { renderPulsePage, type PulseTile } from '../views/pulse.js';
import { normalizeSignal, extractMappedValues } from '../views/pulse-templates.js';

export const pulseRouter: Router = Router();

/**
 * Auto-import any example agents that have a `signal:` field so they
 * show up on the Pulse page without manual CLI steps.
 */
function autoImportSignalExamples(ctx: ReturnType<typeof getContext>): void {
  try {
    const dir = join(resolve('agents/examples'));
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.yaml')) continue;
      try {
        const text = readFileSync(join(dir, file), 'utf-8');
        if (!text.includes('signal:')) continue;
        const parsed = parseAgent(text);
        if (!parsed.signal) continue;
        // Only import if the agent doesn't already exist. Never overwrite
        // dashboard-configured agents (provider, model, signal edits, etc.).
        if (!ctx.agentStore.getAgent(parsed.id)) {
          ctx.agentStore.upsertAgent(parsed, 'import', 'Auto-imported for Pulse');
        }
      } catch { /* skip invalid files */ }
    }
  } catch { /* examples dir may not exist */ }
}

/**
 * Build a PulseTile for an agent with a signal declaration.
 */
function buildTile(agent: ReturnType<ReturnType<typeof getContext>['agentStore']['getAgent']> & { signal: NonNullable<unknown> }, ctx: ReturnType<typeof getContext>): PulseTile {
  const signal = agent.signal!;
  let lastRun: Run | undefined;
  let outputsJson: string | undefined;
  try {
    const runs = ctx.runStore.listRuns({ agentName: agent.id, status: 'completed', limit: 1 });
    if (runs.length > 0) {
      lastRun = runs[0];
      const execs = ctx.runStore.listNodeExecutions(lastRun.id);
      const lastExec = execs.filter((e) => e.status === 'completed').pop();
      if (lastExec?.outputsJson) outputsJson = lastExec.outputsJson;
    }
  } catch { /* run store may not have runs */ }

  const { mapping } = normalizeSignal(signal);
  const slots = extractMappedValues(lastRun, mapping, outputsJson);
  return { agent, signal, lastRun, slots };
}

/**
 * GET /pulse — Signal tile dashboard.
 */
pulseRouter.get('/pulse', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  autoImportSignalExamples(ctx);

  const agents = ctx.agentStore.listAgents();
  const tiles: PulseTile[] = [];
  const hiddenTiles: PulseTile[] = [];

  for (const agent of agents) {
    if (!agent.signal) continue;
    const tile = buildTile(agent as typeof agent & { signal: NonNullable<unknown> }, ctx);
    if (agent.signal.hidden) {
      hiddenTiles.push(tile);
    } else {
      tiles.push(tile);
    }
  }

  // Compute health stats.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let runsToday = 0;
  let failedToday = 0;
  let totalDurationSec = 0;
  let completedCount = 0;
  try {
    const allRecent = ctx.runStore.queryRuns({ limit: 200, offset: 0 });
    for (const r of allRecent.rows) {
      if (r.startedAt >= dayAgo) {
        runsToday++;
        if (r.status === 'failed') failedToday++;
        if (r.status === 'completed' && r.completedAt) {
          const dur = (new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000;
          totalDurationSec += dur;
          completedCount++;
        }
      }
    }
  } catch { /* ignore */ }

  res.type('html').send(renderPulsePage({
    tiles,
    hiddenTiles,
    stats: {
      runsToday,
      failedToday,
      avgDurationSec: completedCount > 0 ? Math.round(totalDurationSec / completedCount) : 0,
      agentCount: agents.length,
    },
  }));
});

/**
 * POST /agents/:id/signal/toggle — toggle the hidden state of a signal tile.
 * Creates a new version with signal.hidden flipped.
 */
pulseRouter.post('/agents/:id/signal/toggle', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent || !agent.signal) {
    res.redirect(303, '/pulse');
    return;
  }

  try {
    const updated = {
      ...agent,
      signal: { ...agent.signal, hidden: !agent.signal.hidden },
    };
    ctx.agentStore.upsertAgent(updated, 'dashboard', agent.signal.hidden ? 'Unhide signal tile' : 'Hide signal tile');
    res.redirect(303, '/pulse');
  } catch {
    res.redirect(303, '/pulse');
  }
});
