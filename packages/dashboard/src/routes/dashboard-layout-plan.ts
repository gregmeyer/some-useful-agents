/**
 * Routes for the "Improve layout" wizard on named user-dashboards
 * (`/dashboards/<id>`). Parallel to the Pulse routes in
 * `pulse-layout-plan.ts` but scoped to a single dashboard:
 *
 *   POST /dashboards/:id/layout-plan/suggestions  — pills + metadata
 *   POST /dashboards/:id/layout-plan              — kick off planner
 *   GET  /dashboards/:id/layout-plan/:runId       — poll
 *   POST /dashboards/:id/layout-plan/commit       — rewrite section
 *                                                   memberships
 *
 * Differences from Pulse:
 * - `agentMetadata` is filtered to the dashboard's current section
 *   members (the planner curates *within* the dashboard's pool).
 * - The commit endpoint rewrites `dashboard.layout.sections[].agentIds`
 *   so un-surfaced agents are REMOVED from the dashboard. Unlike Pulse
 *   (`pulseVisible: false`), there's no per-dashboard hide flag, so
 *   curation modifies the dashboard config directly. Recovery: the
 *   "Add tile" button on the dashboard page.
 */

import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  executeAgentDag,
  extractPlanJson,
  layoutPlanSchema,
  parseAgent,
  type Agent,
  type Dashboard,
  type DashboardLayout,
  type LayoutPlan,
  type RunStatus,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import {
  computeLayoutSuggestions,
  type CurrentLayout,
  type LayoutSuggestionAgent,
} from '../lib/layout-suggestions.js';

export const dashboardLayoutPlanRouter: Router = Router();

const LAYOUT_PLANNER_AGENT_ID = 'layout-planner';
const STALE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────

function parseCurrentLayout(body: Record<string, unknown>): CurrentLayout | null {
  const raw = body.currentLayout;
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw) as CurrentLayout; } catch { return null; }
  }
  if (raw && typeof raw === 'object') return raw as CurrentLayout;
  return null;
}

/**
 * Build metadata for the agents currently declared in this dashboard's
 * sections. Includes run-history aggregates (lastRunAt, successRate,
 * runCount30d) so the planner can rank intelligently. Agents without a
 * signal block are excluded — they can't render as tiles anyway.
 */
function gatherDashboardAgentMetadata(
  ctx: ReturnType<typeof getContext>,
  dashboard: Dashboard,
  now: number,
): LayoutSuggestionAgent[] {
  const memberIds = new Set<string>();
  for (const section of dashboard.layout.sections) {
    for (const id of section.agentIds) memberIds.add(id);
  }
  // No early return on empty dashboards — the planner can still suggest
  // adding installed agents via `toAdd`.

  // Pull recent run window once and aggregate by agent.
  let recent: Array<{ agentName: string; status: string; startedAt: string }> = [];
  try {
    const { rows } = ctx.runStore.queryRuns({ limit: 500, offset: 0 });
    recent = rows.map((r) => ({ agentName: r.agentName, status: r.status, startedAt: r.startedAt }));
  } catch {
    /* run store unavailable */
  }

  const byAgent = new Map<string, { last?: number; successes: number; total: number }>();
  for (const r of recent) {
    if (!memberIds.has(r.agentName)) continue;
    const ts = new Date(r.startedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    if (now - ts > STALE_WINDOW_MS) continue;
    const cell = byAgent.get(r.agentName) ?? { last: undefined, successes: 0, total: 0 };
    if (cell.last === undefined || ts > cell.last) cell.last = ts;
    cell.total += 1;
    if (r.status === 'completed') cell.successes += 1;
    byAgent.set(r.agentName, cell);
  }

  let allTimeLast = new Map<string, number>();
  try {
    const { rows } = ctx.runStore.queryRuns({ limit: 1000, offset: 0 });
    for (const r of rows) {
      if (!memberIds.has(r.agentName)) continue;
      const ts = new Date(r.startedAt).getTime();
      if (!Number.isFinite(ts)) continue;
      const prev = allTimeLast.get(r.agentName);
      if (prev === undefined || ts > prev) allTimeLast.set(r.agentName, ts);
    }
  } catch {
    /* run store unavailable */
  }

  // Walk the section membership in declared order, filter out agents
  // that can't render (no agent or no signal), emit metadata rows.
  const out: LayoutSuggestionAgent[] = [];
  for (const id of memberIds) {
    const agent = ctx.agentStore.getAgent(id);
    if (!agent || !agent.signal) continue;
    const cell = byAgent.get(id);
    const allTime = allTimeLast.get(id);
    const lastTs = cell?.last ?? allTime;
    const row: LayoutSuggestionAgent = {
      id,
      title: agent.signal.title,
    };
    if (lastTs !== undefined) row.lastRunAt = new Date(lastTs).toISOString();
    if (cell && cell.total > 0) {
      row.successRate = cell.successes / cell.total;
      row.runCount30d = cell.total;
    } else {
      row.runCount30d = 0;
    }
    out.push(row);
  }

  // Available agents: installed and renderable (have a signal block) but
  // not currently a member of this dashboard. The planner may surface
  // them via `toAdd`; the commit step appends them into containers.
  for (const agent of ctx.agentStore.listAgents()) {
    if (memberIds.has(agent.id)) continue;
    if (!agent.signal) continue;
    const row: LayoutSuggestionAgent = {
      id: agent.id,
      title: agent.signal.title,
      available: true,
    };
    if (agent.description) row.description = agent.description;
    out.push(row);
  }
  return out;
}

/**
 * Spawn the layout-planner agent run for a named dashboard. Identical
 * to the Pulse kickoff except for the inputs (FOCUS still primary,
 * CURRENT_LAYOUT and AGENT_METADATA are scoped to the dashboard).
 */
async function kickoffDashboardPlannerRun(args: {
  ctx: ReturnType<typeof getContext>;
  focus: string;
  currentLayoutJson: string;
  agentMetadataJson: string;
}): Promise<string | null> {
  const { ctx, focus, currentLayoutJson, agentMetadataJson } = args;

  let planner: ReturnType<typeof ctx.agentStore.getAgent> = null;
  try {
    const yamlPath = join(resolve('agents/examples'), `${LAYOUT_PLANNER_AGENT_ID}.yaml`);
    const yamlText = readFileSync(yamlPath, 'utf-8');
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
    },
  );

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

/** Resolve the dashboardsStore + dashboard, or short-circuit with 404. */
function resolveDashboard(req: Request, res: Response): Dashboard | null {
  const ctx = getContext(req.app.locals);
  if (!ctx.dashboardsStore) {
    res.status(404).json({ ok: false, error: 'Dashboards store unavailable.' });
    return null;
  }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const dashboard = ctx.dashboardsStore.getDashboard(id);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: `Dashboard "${id}" not found.` });
    return null;
  }
  return dashboard;
}

dashboardLayoutPlanRouter.post('/dashboards/:id/layout-plan/suggestions', (req: Request, res: Response) => {
  const dashboard = resolveDashboard(req, res);
  if (!dashboard) return;
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const now = Date.now();

  const agentMetadata = gatherDashboardAgentMetadata(ctx, dashboard, now);
  const currentLayout = parseCurrentLayout(body);
  const suggestions = computeLayoutSuggestions(agentMetadata, currentLayout, now);

  res.json({ ok: true, suggestions, agentMetadata });
});

dashboardLayoutPlanRouter.post('/dashboards/:id/layout-plan', async (req: Request, res: Response) => {
  const dashboard = resolveDashboard(req, res);
  if (!dashboard) return;
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
  const currentLayout = parseCurrentLayout(body);

  let agentMetadata: LayoutSuggestionAgent[];
  if (Array.isArray(body.agentMetadata)) {
    agentMetadata = body.agentMetadata as LayoutSuggestionAgent[];
  } else {
    agentMetadata = gatherDashboardAgentMetadata(ctx, dashboard, Date.now());
  }

  if (agentMetadata.length === 0) {
    res.json({ ok: false, error: 'No installed agents with a Pulse signal — create one before planning a layout.' });
    return;
  }

  const runId = await kickoffDashboardPlannerRun({
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

dashboardLayoutPlanRouter.get('/dashboards/:id/layout-plan/:runId', (req: Request, res: Response) => {
  const dashboard = resolveDashboard(req, res);
  if (!dashboard) return;
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

/**
 * Apply the plan's curation to the dashboard's persisted layout.
 * Unlike Pulse, named dashboards have no per-tile hide flag — agent
 * membership is declared in `dashboard.layout.sections[].agentIds[]`.
 * Curation rewrites that membership: un-surfaced agents are REMOVED
 * from the dashboard config. Section structure (titles, ordering)
 * is replaced by the plan's containers — labels become section titles.
 *
 * Body: { containers: Array<{ label: string; tiles: string[] }> }
 * Returns: { ok, removed: string[], retained: string[] }
 *
 * System tiles (`_system-*`) are ignored — they're Pulse-only.
 */
dashboardLayoutPlanRouter.post('/dashboards/:id/layout-plan/commit', (req: Request, res: Response) => {
  const dashboard = resolveDashboard(req, res);
  if (!dashboard) return;
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const containersRaw = Array.isArray(body.containers) ? body.containers : [];
  const topAgentsRaw = Array.isArray(body.topAgents) ? body.topAgents : [];

  // Build a per-agent placement map from the planner's topAgents entries.
  // These become per-section overrides on the new layout — dashboard-scoped,
  // unlike LayoutHintsStore which is agent-global. Invalid field values
  // are silently dropped (the renderer falls through to the next link in
  // the chain).
  const placementByAgentId = new Map<string, { size?: '1x1' | '2x1' | '1x2' | '2x2'; tileFit?: 'grow' | 'scroll'; height?: number }>();
  for (const entry of topAgentsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id : '';
    if (!id || id.startsWith('_')) continue;
    const placement: { size?: '1x1' | '2x1' | '1x2' | '2x2'; tileFit?: 'grow' | 'scroll'; height?: number } = {};
    if (typeof e.suggestedSize === 'string' && (e.suggestedSize === '1x1' || e.suggestedSize === '2x1' || e.suggestedSize === '1x2' || e.suggestedSize === '2x2')) {
      placement.size = e.suggestedSize;
    }
    if (typeof e.suggestedTileFit === 'string' && (e.suggestedTileFit === 'grow' || e.suggestedTileFit === 'scroll')) {
      placement.tileFit = e.suggestedTileFit;
    }
    if (typeof e.suggestedHeight === 'number' && Number.isInteger(e.suggestedHeight) && e.suggestedHeight >= 80 && e.suggestedHeight <= 1200) {
      placement.height = e.suggestedHeight;
    }
    if (Object.keys(placement).length > 0) placementByAgentId.set(id, placement);
  }

  // Build the new section list from the plan's containers, filtering
  // out system tiles, de-duplicating ids, and dropping ids that don't
  // resolve to a real installed agent (phantom suggestions from the LLM).
  // Section TITLES are also deduped (case-insensitive): if two containers
  // share a title, their agent ids are merged into a single section. This
  // prevents the dashboard renderer from drawing two sections with the
  // same header on top of each other (e.g. after a "Newly drafted" merge
  // where the planner kept a prior session's container).
  const seenIds = new Set<string>();
  const skippedUnknown: string[] = [];
  const sectionsByTitle = new Map<string, { title: string; agentIds: string[]; placements?: Record<string, { size?: '1x1' | '2x1' | '1x2' | '2x2'; tileFit?: 'grow' | 'scroll'; height?: number }> }>();
  const sectionOrder: string[] = [];
  for (const c of containersRaw) {
    if (!c || typeof c !== 'object') continue;
    const label = typeof (c as { label?: unknown }).label === 'string'
      ? (c as { label: string }).label.trim()
      : '';
    if (!label) continue;
    const titleKey = label.toLowerCase();
    const tilesRaw = Array.isArray((c as { tiles?: unknown }).tiles)
      ? (c as { tiles: unknown[] }).tiles
      : [];
    const ids: string[] = [];
    for (const t of tilesRaw) {
      if (typeof t !== 'string') continue;
      if (t.startsWith('_')) continue; // skip Pulse system tiles
      if (seenIds.has(t)) continue;
      if (!ctx.agentStore.getAgent(t)) {
        skippedUnknown.push(t);
        continue;
      }
      seenIds.add(t);
      ids.push(t);
    }
    if (ids.length === 0) continue;
    // Assemble placements for THIS section: only ids that ended up in
    // this section's agentIds AND had a placement entry from topAgents.
    const placementsHere: Record<string, { size?: '1x1' | '2x1' | '1x2' | '2x2'; tileFit?: 'grow' | 'scroll'; height?: number }> = {};
    let hasPlacement = false;
    for (const id of ids) {
      const p = placementByAgentId.get(id);
      if (p) { placementsHere[id] = p; hasPlacement = true; }
    }

    const existing = sectionsByTitle.get(titleKey);
    if (existing) {
      for (const id of ids) {
        if (!existing.agentIds.includes(id)) existing.agentIds.push(id);
      }
      if (hasPlacement) {
        existing.placements = { ...(existing.placements ?? {}), ...placementsHere };
      }
    } else {
      const section: { title: string; agentIds: string[]; placements?: Record<string, { size?: '1x1' | '2x1' | '1x2' | '2x2'; tileFit?: 'grow' | 'scroll'; height?: number }> } = { title: label, agentIds: ids };
      if (hasPlacement) section.placements = placementsHere;
      sectionsByTitle.set(titleKey, section);
      sectionOrder.push(titleKey);
    }
  }
  const newSections = sectionOrder.map((k) => sectionsByTitle.get(k)!);

  // Compute removed/retained/added vs the prior membership for the
  // response. `added` is the newly-surfaced delta (installed agents
  // that weren't on this dashboard before but are now).
  const priorIds = new Set<string>();
  for (const s of dashboard.layout.sections) {
    for (const id of s.agentIds) priorIds.add(id);
  }
  const retained: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  for (const id of priorIds) {
    if (seenIds.has(id)) retained.push(id);
    else removed.push(id);
  }
  for (const id of seenIds) {
    if (!priorIds.has(id)) added.push(id);
  }

  if (newSections.length === 0) {
    res.json({
      ok: false,
      error: 'Refusing to commit an empty dashboard — at least one section with agents is required.',
    });
    return;
  }

  const newLayout: DashboardLayout = { sections: newSections };
  try {
    ctx.dashboardsStore!.updateLayout(dashboard.id, newLayout);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: `Failed to persist dashboard layout: ${msg}` });
    return;
  }

  // Count placements written for the response (UI surfaces this as
  // "Applied N tile sizes" — a signal that the planner's hints landed).
  let placementsWritten = 0;
  for (const s of newSections) {
    if (s.placements) placementsWritten += Object.keys(s.placements).length;
  }

  res.json({ ok: true, removed, retained, added, skippedUnknown, placementsWritten });
});

// Reference unused imports defensively to keep tsc-clean if a future
// refactor drops them — Agent is used via the agent-store call signature.
void (null as unknown as Agent);
