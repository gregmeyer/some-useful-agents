/**
 * Routes for the Pulse "Improve layout" wizard.
 *
 *   POST /pulse/layout-plan              — kick off the layout-planner agent
 *   GET  /pulse/layout-plan/:runId       — poll a planner run
 *
 * Mirrors the build-from-goal route shape but skips the critic-retry loop
 * (PlannerLoopRunner is tightly coupled to BuildPlan; layout uses a
 * simpler validate-once flow). Memory injection and retries are deferred
 * to a follow-on PR.
 */

import { Router, type Request, type Response } from 'express';
import { join } from 'node:path';
import {
  executeAgentDag,
  extractPlanJson,
  layoutPlanSchema,
  parseAgent,
  type Agent,
  type LayoutPlan,
  type RunStatus,
  readExampleYaml,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import {
  type CurrentLayout,
  type LayoutSuggestionAgent,
} from '../lib/layout-suggestions.js';

export const pulseLayoutPlanRouter: Router = Router();

const LAYOUT_PLANNER_AGENT_ID = 'layout-planner';
const STALE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * True when the agent currently renders as a tile on the Pulse grid.
 * Mirrors the filter in the /pulse route exactly — anything that route
 * shows, curation should be able to hide; anything it doesn't show,
 * curation has nothing to do with. Notably: status (archived/draft) is
 * NOT a filter in the Pulse route, so we don't filter on it here.
 * Agents without a signal are skipped because they can't render at all.
 */
function isVisibleOnPulse(agent: Agent): boolean {
  if (!agent.signal) return false;
  if (agent.pulseVisible === false) return false;
  if (agent.pulseVisible === undefined && agent.signal.hidden === true) return false;
  return true;
}

/**
 * Walk the run history once and roll up per-agent stats: lastRunAt,
 * successRate (over the last 30 days), runCount30d. Avoids N+1 queries
 * for typical installs.
 */
function gatherAgentMetadata(ctx: ReturnType<typeof getContext>, now: number): LayoutSuggestionAgent[] {
  const all = ctx.agentStore.listAgents();
  const agents = all.filter(isVisibleOnPulse);
  // Available = installed agents that COULD render on Pulse (have a
  // signal block) but are currently hidden. The planner can surface
  // them via `toAdd`. Agents with no signal block are skipped — they
  // can't render as Pulse tiles regardless.
  const availableAgents = all.filter((a) => a.signal && !isVisibleOnPulse(a));
  // Pull the recent run window once.
  let recent: Array<{ agentName: string; status: string; startedAt: string }> = [];
  try {
    const { rows } = ctx.runStore.queryRuns({ limit: 500, offset: 0 });
    recent = rows.map((r) => ({ agentName: r.agentName, status: r.status, startedAt: r.startedAt }));
  } catch {
    /* run store unavailable — emit metadata with no run history */
  }

  const byAgent = new Map<string, { last?: number; successes: number; total: number }>();
  for (const r of recent) {
    const ts = new Date(r.startedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    if (now - ts > STALE_WINDOW_MS) continue;
    const cell = byAgent.get(r.agentName) ?? { last: undefined, successes: 0, total: 0 };
    if (cell.last === undefined || ts > cell.last) cell.last = ts;
    cell.total += 1;
    if (r.status === 'completed') cell.successes += 1;
    byAgent.set(r.agentName, cell);
  }

  // lastRunAt all-time (not just 30d). Pull a thin global-last lookup so
  // agents that haven't run in 30+ days still show *when* they last ran.
  let allTimeLast = new Map<string, number>();
  try {
    const { rows } = ctx.runStore.queryRuns({ limit: 1000, offset: 0 });
    for (const r of rows) {
      const ts = new Date(r.startedAt).getTime();
      if (!Number.isFinite(ts)) continue;
      const prev = allTimeLast.get(r.agentName);
      if (prev === undefined || ts > prev) allTimeLast.set(r.agentName, ts);
    }
  } catch {
    /* run store unavailable */
  }

  const members = agents.map((a) => {
    const cell = byAgent.get(a.id);
    const allTime = allTimeLast.get(a.id);
    const lastTs = cell?.last ?? allTime;
    const out: LayoutSuggestionAgent = {
      id: a.id,
      title: a.signal?.title,
    };
    if (lastTs !== undefined) out.lastRunAt = new Date(lastTs).toISOString();
    if (cell && cell.total > 0) {
      out.successRate = cell.successes / cell.total;
      out.runCount30d = cell.total;
    } else {
      out.runCount30d = 0;
    }
    return out;
  });

  const available = availableAgents.map((a) => {
    const row: LayoutSuggestionAgent = {
      id: a.id,
      title: a.signal?.title,
      available: true,
    };
    if (a.description) row.description = a.description;
    const allTime = allTimeLast.get(a.id);
    if (allTime !== undefined) row.lastRunAt = new Date(allTime).toISOString();
    return row;
  });

  return [...members, ...available];
}

function parseCurrentLayout(body: Record<string, unknown>): CurrentLayout | null {
  const raw = body.currentLayout;
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw) as CurrentLayout; } catch { return null; }
  }
  if (raw && typeof raw === 'object') return raw as CurrentLayout;
  return null;
}

/**
 * Spawn a single layout-planner agent run and return its run-id.
 * Returns null when the planner agent file can't be loaded.
 */
async function kickoffLayoutPlannerRun(args: {
  ctx: ReturnType<typeof getContext>;
  focus: string;
  currentLayoutJson: string;
  agentMetadataJson: string;
}): Promise<string | null> {
  const { ctx, focus, currentLayoutJson, agentMetadataJson } = args;

  let planner: ReturnType<typeof ctx.agentStore.getAgent> = null;
  try {
    const yamlText = readExampleYaml(LAYOUT_PLANNER_AGENT_ID);
    if (yamlText === null) throw new Error('no bundled layout-planner yaml');
    const parsed = parseAgent(yamlText);
    ctx.agentStore.upsertAgent(parsed, 'import', 'Auto-imported for layout planner');
    planner = ctx.agentStore.getAgent(LAYOUT_PLANNER_AGENT_ID);
  } catch { /* fall through */ }
  if (!planner) return null;

  const runPromise = executeAgentDag(
    planner,
    {
      triggeredBy: 'dashboard',
      inputs: {
        FOCUS: focus,
        CURRENT_LAYOUT: currentLayoutJson,
        AGENT_METADATA: agentMetadataJson,
      },
    },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
      dataRoot: ctx.agentStore.dataRoot,
      llmSettings: buildLlmSettingsSnapshot(ctx),
      spawnNode: ctx.workflowSpawnNode,
      onRunFailure: ctx.onRunFailure,
      onRunComplete: ctx.onRunComplete,
    },
  );

  // Race the run-record creation; we only need its id, not its result.
  await Promise.race([runPromise, new Promise((r) => setTimeout(r, 200))]);
  const { rows } = ctx.runStore.queryRuns({
    agentName: LAYOUT_PLANNER_AGENT_ID,
    statuses: ['running', 'completed', 'failed'] as RunStatus[],
    limit: 1,
    offset: 0,
  });
  if (rows.length > 0) return rows[0].id;
  try {
    const run = await runPromise;
    return run.id;
  } catch {
    return null;
  }
}

// ── Routes ─────────────────────────────────────────────────────────────

/**
 * POST /pulse/layout-plan — kick off the layout-planner agent.
 * Body: { focus?: string, currentLayout?: string | object, agentMetadata?: LayoutSuggestionAgent[] }
 * Returns: { ok, runId } or { ok: false, error }
 *
 * If agentMetadata is omitted, the route re-gathers it server-side. Most
 * clients will pass the value they got from /suggestions to avoid the
 * second DB pass.
 */
pulseLayoutPlanRouter.post('/pulse/layout-plan', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
  const currentLayout = parseCurrentLayout(body);

  let agentMetadata: LayoutSuggestionAgent[];
  if (Array.isArray(body.agentMetadata)) {
    agentMetadata = body.agentMetadata as LayoutSuggestionAgent[];
  } else {
    agentMetadata = gatherAgentMetadata(ctx, Date.now());
  }

  if (agentMetadata.length === 0) {
    res.json({ ok: false, error: 'No agents installed — nothing to lay out. Create an agent first.' });
    return;
  }

  const runId = await kickoffLayoutPlannerRun({
    ctx,
    focus,
    currentLayoutJson: JSON.stringify(currentLayout ?? {}),
    agentMetadataJson: JSON.stringify(agentMetadata),
  });
  if (!runId) {
    res.json({
      ok: false,
      error: 'Layout planner agent not found. Ensure layout-planner.yaml exists in agents/examples/.',
    });
    return;
  }
  res.json({ ok: true, runId });
});

/**
 * GET /pulse/layout-plan/:runId — poll a planner run.
 * Returns one of:
 *   { ok, status: 'running', phase? }
 *   { ok, status: 'done', plan: LayoutPlan }
 *   { ok, status: 'failed', error, rawResult? }
 */
pulseLayoutPlanRouter.get('/pulse/layout-plan/:runId', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

  const run = ctx.runStore.getRun(runId);
  if (!run) {
    res.json({ ok: false, status: 'not_found' });
    return;
  }

  if (run.status === 'running' || run.status === 'pending') {
    const execs = ctx.runStore.listNodeExecutions(runId);
    const running = execs.find((e) => e.status === 'running');
    const phase = running?.nodeId === 'plan' ? 'Designing layout...' : 'Starting...';
    res.json({ ok: true, status: 'running', phase });
    return;
  }

  if (run.status !== 'completed' || !run.result) {
    res.json({ ok: true, status: 'failed', error: run.error ?? `Layout planner failed (${run.status}).` });
    return;
  }

  // Extract <plan>{...}</plan> and validate. extractPlanJson handles the
  // canonical wrapper, JSON code fences, and bare JSON blobs.
  const planJson = extractPlanJson(run.result);
  if (!planJson) {
    res.json({ ok: true, status: 'failed', error: 'Planner did not produce a <plan>...</plan> block.', rawResult: run.result });
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(planJson);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.json({ ok: true, status: 'failed', error: `Plan JSON did not parse: ${msg}`, rawResult: planJson });
    return;
  }

  const validated = layoutPlanSchema.safeParse(parsedJson);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    res.json({
      ok: true,
      status: 'failed',
      error: 'Layout plan failed schema validation.',
      validationErrors: issues,
      rawResult: planJson,
    });
    return;
  }

  const plan: LayoutPlan = validated.data;
  res.json({ ok: true, status: 'done', plan });
});

