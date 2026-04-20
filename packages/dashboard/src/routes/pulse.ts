import { Router, type Request, type Response } from 'express';
import { parseAgent, type Agent, type AgentSignal, type Run } from '@some-useful-agents/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getContext } from '../context.js';
import { renderPulsePage, type PulseTile } from '../views/pulse.js';
import { normalizeSignal, extractMappedValues } from '../views/pulse-templates.js';

export const pulseRouter: Router = Router();

// ── Auto-import ──────────────────────────────────────────────────────────

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
        if (!ctx.agentStore.getAgent(parsed.id)) {
          ctx.agentStore.upsertAgent(parsed, 'import', 'Auto-imported for Pulse');
        }
      } catch { /* skip */ }
    }
  } catch { /* dir may not exist */ }
}

// ── Tile building ────────────────────────────────────────────────────────

function buildTile(agent: Agent & { signal: AgentSignal }, ctx: ReturnType<typeof getContext>): PulseTile {
  const signal = agent.signal;
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
  } catch { /* no runs */ }

  const { mapping } = normalizeSignal(signal);
  const slots = extractMappedValues(lastRun, mapping, outputsJson);
  return { agent, signal, lastRun, slots };
}

// ── Virtual system tiles ─────────────────────────────────────────────────

const SYSTEM_IDS = [
  '_system-runs-today',
  '_system-failure-rate',
  '_system-avg-duration',
  '_system-agent-count',
] as const;

function virtualAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    status: 'active',
    source: 'local',
    version: 0,
    nodes: [],
  };
}

function buildSystemTiles(ctx: ReturnType<typeof getContext>): PulseTile[] {
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  let runsToday = 0;
  let failedToday = 0;
  let totalDurationSec = 0;
  let completedCount = 0;
  try {
    const allRecent = ctx.runStore.queryRuns({ limit: 500, offset: 0 });
    for (const r of allRecent.rows) {
      if (r.startedAt >= dayAgo) {
        runsToday++;
        if (r.status === 'failed') failedToday++;
        if (r.status === 'completed' && r.completedAt) {
          totalDurationSec += (new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000;
          completedCount++;
        }
      }
    }
  } catch { /* ignore */ }

  const failRate = runsToday > 0 ? Math.round((failedToday / runsToday) * 100) : 0;
  const avgDur = completedCount > 0 ? Math.round(totalDurationSec / completedCount) : 0;
  const agentCount = ctx.agentStore.listAgents().length;

  return [
    {
      agent: virtualAgent('_system-runs-today', 'Runs Today'),
      signal: { title: 'Runs Today', icon: '\uD83D\uDCCA', template: 'metric', format: 'number' },
      slots: { value: runsToday, label: 'Runs Today' },
    },
    {
      agent: virtualAgent('_system-failure-rate', 'Failure Rate'),
      signal: {
        title: 'Failure Rate', icon: '\u26A0\uFE0F', template: 'metric', format: 'number',
        thresholds: [
          { above: 20, palette: 'accent-red' },
          { below: 5, palette: 'accent-green' },
        ],
      },
      slots: { value: failRate, label: 'Failure Rate', unit: '%' },
    },
    {
      agent: virtualAgent('_system-avg-duration', 'Avg Duration'),
      signal: { title: 'Avg Duration', icon: '\u23F1\uFE0F', template: 'metric', format: 'number' },
      slots: { value: avgDur > 0 ? avgDur : '--', label: 'Avg Duration', unit: avgDur > 0 ? 's' : '' },
    },
    {
      agent: virtualAgent('_system-agent-count', 'Agents'),
      signal: { title: 'Agents', icon: '\uD83E\uDD16', template: 'metric', format: 'number' },
      slots: { value: agentCount, label: 'Agents' },
    },
  ];
}

// ── Routes ───────────────────────────────────────────────────────────────

pulseRouter.get('/pulse', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  autoImportSignalExamples(ctx);

  const agents = ctx.agentStore.listAgents();
  const tiles: PulseTile[] = [];
  const hiddenTiles: PulseTile[] = [];

  // System tiles (virtual, not from the agent store).
  const systemTiles = buildSystemTiles(ctx);

  // Agent tiles.
  for (const agent of agents) {
    if (!agent.signal) continue;
    const tile = buildTile(agent as Agent & { signal: AgentSignal }, ctx);
    if (agent.signal.hidden) {
      hiddenTiles.push(tile);
    } else {
      tiles.push(tile);
    }
  }

  res.type('html').send(renderPulsePage({
    systemTiles,
    tiles,
    hiddenTiles,
  }));
});

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
