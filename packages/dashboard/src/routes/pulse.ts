import { Router, type Request, type Response } from 'express';
import { parseAgent, type Run } from '@some-useful-agents/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getContext } from '../context.js';
import { renderPulsePage, extractSignalValue, type PulseTile } from '../views/pulse.js';

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
 * GET /pulse — Signal tile dashboard. Shows live output from agents
 * that declare a `signal:` field in their YAML.
 */
pulseRouter.get('/pulse', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  // Ensure signal-enabled example agents are imported.
  autoImportSignalExamples(ctx);

  const agents = ctx.agentStore.listAgents();

  // Collect agents with a signal declaration.
  const tiles: PulseTile[] = [];
  for (const agent of agents) {
    if (!agent.signal) continue;

    // Fetch the most recent completed run for this agent.
    let lastRun: Run | undefined;
    let outputsJson: string | undefined;
    try {
      const runs = ctx.runStore.listRuns({ agentName: agent.id, status: 'completed', limit: 1 });
      if (runs.length > 0) {
        lastRun = runs[0];
        // Try to get structured output from the last node execution.
        const execs = ctx.runStore.listNodeExecutions(lastRun.id);
        const lastExec = execs.filter((e) => e.status === 'completed').pop();
        if (lastExec?.outputsJson) {
          outputsJson = lastExec.outputsJson;
        }
      }
    } catch { /* run store may not have runs for this agent */ }

    const value = extractSignalValue(lastRun, agent.signal, outputsJson);
    tiles.push({ agent, signal: agent.signal, lastRun, value });
  }

  // Compute health stats.
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
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

  const avgDurationSec = completedCount > 0 ? Math.round(totalDurationSec / completedCount) : 0;

  res.type('html').send(renderPulsePage({
    tiles,
    stats: {
      runsToday,
      failedToday,
      avgDurationSec,
      agentCount: agents.length,
    },
  }));
});
