import { Router, type Request, type Response } from 'express';
import { parseAgent, type Agent, type AgentSignal, type SignalTemplate, type SignalAccent, type Run } from '@some-useful-agents/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getContext } from '../context.js';
import { renderPulsePage, tileWrap, type PulseTile } from '../views/pulse.js';
import { renderTile } from '../views/pulse-renderers.js';
import { buildPulseTile, attachLayoutHints } from '../views/pulse-tile-builder.js';
import { normalizeSignal, TEMPLATE_REGISTRY } from '../views/pulse-templates.js';

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
  return buildPulseTile(agent, { runStore: ctx.runStore });
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

/**
 * Assemble the live Pulse board data: the 4 virtual system tiles + a tile per
 * visible signal agent (two visibility gates) + the hidden count + dashboards
 * and available packs. Shared by GET /pulse and the Mission Control home (`/`)
 * so both render the identical board with zero divergence. Idempotent —
 * `autoImportSignalExamples` only upserts examples not already installed.
 */
export function buildPulseBoardData(ctx: ReturnType<typeof getContext>): {
  systemTiles: PulseTile[];
  tiles: PulseTile[];
  hiddenTiles: PulseTile[];
  installedDashboards: ReturnType<NonNullable<ReturnType<typeof getContext>['dashboardsStore']>['listDashboards']>;
  availablePacks: ReturnType<NonNullable<ReturnType<typeof getContext>['packsStore']>['listPacks']>;
} {
  autoImportSignalExamples(ctx);

  const agents = ctx.agentStore.listAgents();
  const tiles: PulseTile[] = [];
  const hiddenTiles: PulseTile[] = [];

  // System tiles (virtual, not from the agent store).
  const systemTiles = buildSystemTiles(ctx);

  // Agent tiles. Two visibility gates:
  //  - `pulseVisible: false` is the explicit master switch (top-level).
  //  - `signal.hidden: true` is the legacy per-tile toggle (kept for back-compat).
  // pulseVisible takes precedence when set.
  for (const agent of agents) {
    if (!agent.signal) continue;
    const pulseHidden = agent.pulseVisible === false
      || (agent.pulseVisible === undefined && agent.signal.hidden === true);
    if (pulseHidden) {
      // Hidden agents are surfaced only as a count + bulk-restore link
      // in the view — skip the (expensive) buildTile call so the page
      // doesn't load their data needlessly.
      hiddenTiles.push({} as unknown as typeof tiles[number]);
    } else {
      tiles.push(buildTile(agent as Agent & { signal: AgentSignal }, ctx));
    }
  }

  // Decorate built tiles with any layout-planner-written hints. One
  // batched lookup keyed by agent id; missing rows leave tiles
  // untouched (renderer falls back to signal.size / outputWidget.tileFit).
  attachLayoutHints(tiles, ctx.layoutHintsStore);

  const installedDashboards = ctx.dashboardsStore?.listDashboards() ?? [];
  const availablePacks = (ctx.packsStore?.listPacks() ?? []).filter((p) => p.installedAt === null);
  return { systemTiles, tiles, hiddenTiles, installedDashboards, availablePacks };
}

pulseRouter.get('/pulse', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const data = buildPulseBoardData(ctx);
  res.type('html').send(renderPulsePage({ ...data, flash: parsePulseFlash(req) }));
});

function parsePulseFlash(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  if (typeof req.query.ok === 'string') return { kind: 'ok', message: req.query.ok };
  if (typeof req.query.error === 'string') return { kind: 'error', message: req.query.error };
  if (typeof req.query.info === 'string') return { kind: 'info', message: req.query.info };
  return undefined;
}

pulseRouter.post('/agents/:id/signal/toggle', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent || !agent.signal) {
    res.redirect(303, '/pulse');
    return;
  }

  // Flip pulseVisible — the master visibility switch that the pulse
  // page filter actually reads. Toggling signal.hidden here used to
  // appear to do nothing once an agent had pulseVisible set, because
  // the filter prefers pulseVisible when it's not undefined.
  // Currently-visible includes `undefined` (default) and `true`; we
  // collapse both to false on the click.
  const currentlyVisible = agent.pulseVisible !== false;
  try {
    ctx.agentStore.updateAgentMeta(id, { pulseVisible: !currentlyVisible });
    res.redirect(303, '/pulse');
  } catch {
    res.redirect(303, '/pulse');
  }
});

// ── Update signal config ────────────────────────────────────────────────

pulseRouter.post('/agents/:id/signal', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.redirect(303, '/pulse');
    return;
  }

  const body = req.body as Record<string, string>;
  const template = body.template as SignalTemplate | undefined;
  const accent = body.accent as SignalAccent | undefined;
  const title = body.title?.trim();
  const icon = body.icon?.trim();
  const size = body.size as AgentSignal['size'] | undefined;
  const refresh = body.refresh?.trim();

  // Validate template exists in registry.
  if (template && !TEMPLATE_REGISTRY[template]) {
    res.redirect(303, '/pulse');
    return;
  }

  // Parse mapping from JSON string.
  let mapping: Record<string, string> | undefined;
  if (body.mapping) {
    try {
      mapping = JSON.parse(body.mapping);
    } catch {
      res.redirect(303, '/pulse');
      return;
    }
  }

  const signal: AgentSignal = {
    ...(agent.signal ?? { title: agent.id }),
    ...(title ? { title } : {}),
    ...(icon !== undefined ? { icon: icon || undefined } : {}),
    ...(template ? { template } : {}),
    ...(mapping ? { mapping } : {}),
    ...(accent ? { accent } : {}),
    ...(size ? { size } : {}),
    ...(refresh !== undefined ? { refresh: refresh || undefined } : {}),
  };

  try {
    const updated = { ...agent, signal };
    ctx.agentStore.upsertAgent(updated, 'dashboard', `Update signal config via Pulse`);
    res.redirect(303, '/pulse');
  } catch {
    res.redirect(303, '/pulse');
  }
});

// ── Tile fragment (for auto-refresh polling) ────────────────────────────

/**
 * POST /pulse/hide-all — bulk-flip pulseVisible=false on every agent that
 * has a signal block AND isn't already hidden. Use case: "clear the slate
 * before installing a pack so only its dashboards show through". Reversible
 * via `/pulse/show-all` or per-agent toggle.
 */
pulseRouter.post('/pulse/hide-all', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  let hidden = 0;
  for (const agent of ctx.agentStore.listAgents()) {
    if (!agent.signal) continue;
    const alreadyHidden = agent.pulseVisible === false
      || (agent.pulseVisible === undefined && agent.signal.hidden === true);
    if (alreadyHidden) continue;
    ctx.agentStore.updateAgentMeta(agent.id, { pulseVisible: false });
    hidden++;
  }
  res.redirect(303, `/pulse?ok=${encodeURIComponent(`Hid ${hidden} signal${hidden === 1 ? '' : 's'} from Pulse.`)}`);
});

/**
 * POST /pulse/show-all — counterpart to hide-all. Sets pulseVisible=true
 * on every agent that has a signal block. Useful after a "clear and
 * curate" cycle if the user changes their mind.
 */
pulseRouter.post('/pulse/show-all', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  let shown = 0;
  for (const agent of ctx.agentStore.listAgents()) {
    if (!agent.signal) continue;
    if (agent.pulseVisible === true) continue;
    ctx.agentStore.updateAgentMeta(agent.id, { pulseVisible: true });
    shown++;
  }
  res.redirect(303, `/pulse?ok=${encodeURIComponent(`Restored ${shown} signal${shown === 1 ? '' : 's'} to Pulse.`)}`);
});

pulseRouter.get('/pulse/tile/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // System tiles.
  if (id.startsWith('_system-')) {
    const systemTiles = buildSystemTiles(ctx);
    const tile = systemTiles.find((t) => t.agent.id === id);
    if (!tile) { res.status(404).send('Tile not found'); return; }
    res.type('html').send(renderTile(tile, tileWrap).toString());
    return;
  }

  // Agent tiles.
  const agent = ctx.agentStore.getAgent(id);
  if (!agent || !agent.signal) { res.status(404).send('Tile not found'); return; }
  const tile = buildTile(agent as Agent & { signal: AgentSignal }, ctx);
  res.type('html').send(renderTile(tile, tileWrap).toString());
});
