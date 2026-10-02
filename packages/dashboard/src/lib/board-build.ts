/**
 * Build a board from a request (docs/boards.md § Build a board). A background
 * job, so the person can leave and be told when it's done:
 *
 *   planning   the board-builder agent picks agents from the catalog,
 *              groups and sizes them, and names what no agent covers
 *   arranging  the plan becomes the board's canvas (same tree operations as
 *              Arrange) and the dashboard's sections
 *   running    every tile's agent runs once, so the board isn't blank
 *   done       an inbox item: the board is ready, what failed, what's missing
 *
 * Progress is stored (BoardBuildStore), so the board page shows it and a
 * restart mid-build is reported instead of leaving a silent half-board.
 */
import {
  BoardBuildStore,
  BoardsStore,
  allocateUserDashboardId,
  boardDocFromBuildPlan,
  executeAgentWithRetry,
  extractBoardBuildPlan,
  parseAgent,
  readExampleYaml,
  sectionsFromBoardDoc,
  type Agent,
  type BoardBuild,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { withTileSignal } from '../views/pulse-tile-builder.js';
import { TEMPLATE_REGISTRY, normalizeSignal } from '../views/pulse-templates.js';

type Ctx = ReturnType<typeof getContext>;
export const BOARD_BUILDER_AGENT_ID = 'board-builder';
/** How many tiles run at once in the "running" phase. */
const RUN_CONCURRENCY = 3;

const buildsOf = (ctx: Ctx) => new BoardBuildStore(ctx.runStore.databaseHandle());

function runDeps(ctx: Ctx) {
  return {
    runStore: ctx.runStore,
    secretsStore: ctx.secretsStore,
    variablesStore: ctx.variablesStore,
    integrationsStore: ctx.integrationsStore,
    toolStore: ctx.toolStore,
    agentStore: ctx.agentStore,
    allowUntrustedShell: ctx.allowUntrustedShell,
    dashboardBaseUrl: ctx.dashboardBaseUrl,
    dataRoot: ctx.agentStore.dataRoot,
    llmSettings: buildLlmSettingsSnapshot(ctx),
    spawnNode: ctx.workflowSpawnNode,
    onRunComplete: ctx.onRunComplete,
  };
}

/** Required inputs with no default: such an agent can't run unattended. */
const needsInput = (a: Agent) => Object.values(a.inputs ?? {}).some((s) => s.required === true && s.default === undefined);

/** The agents a board can show, described for the board builder. */
export function boardCatalog(ctx: Ctx): Array<Record<string, unknown>> {
  return ctx.agentStore.listAgents()
    .filter((a) => a.status !== 'archived' && !a.id.startsWith('_'))
    .map(withTileSignal)
    .filter((a): a is NonNullable<typeof a> => Boolean(a?.signal))
    .map((a) => ({
      id: a.id,
      title: a.signal!.title || a.name,
      ...(a.description ? { description: a.description.slice(0, 300) } : {}),
      ...(a.sampleQuestions?.length ? { examples: a.sampleQuestions.slice(0, 3) } : {}),
      ...(needsInput(a) ? { needsInput: true } : {}),
      kind: TEMPLATE_REGISTRY[normalizeSignal(a.signal!).template] ? normalizeSignal(a.signal!).template : 'widget',
    }));
}

/** Start building: the dashboard exists straight away (showing progress); the work runs in the background. */
export function startBoardBuild(ctx: Ctx, args: { request: string; name?: string }): { boardId: string; build: BoardBuild } {
  if (!ctx.dashboardsStore) throw new Error('Dashboards are not available.');
  const request = args.request.trim().slice(0, 2000);
  if (!request) throw new Error('Say what the board should show.');
  const provisional = (args.name?.trim() || request.split(/\s+/).slice(0, 4).join(' ')).slice(0, 60);
  const boardId = allocateUserDashboardId(provisional, (id) => Boolean(ctx.dashboardsStore!.getDashboard(id)));
  ctx.dashboardsStore.upsertDashboard({ id: boardId, packId: null, name: provisional, layout: { sections: [] } });
  const build = buildsOf(ctx).create(boardId, request);
  void runBoardBuild(ctx, build.id, { keepName: Boolean(args.name?.trim()) }).catch((err) => {
    finish(ctx, build.id, { error: (err as Error).message || 'The build stopped unexpectedly.' });
  });
  return { boardId, build };
}

async function runBoardBuild(ctx: Ctx, buildId: string, opts: { keepName: boolean }): Promise<void> {
  const builds = buildsOf(ctx);
  const build = builds.get(buildId)!;

  // 1. Planning: the board-builder agent.
  // The bundled builder (kept current on upgrade), unless someone replaced it with their own.
  let builder: Agent | null = ctx.agentStore.getAgent(BOARD_BUILDER_AGENT_ID);
  if (!builder || builder.source === 'examples') {
    try {
      const yaml = readExampleYaml(BOARD_BUILDER_AGENT_ID);
      if (yaml) {
        ctx.agentStore.upsertAgent(parseAgent(yaml), 'import', 'Auto-imported for building boards');
        builder = ctx.agentStore.getAgent(BOARD_BUILDER_AGENT_ID);
      }
    } catch { /* keep what's there */ }
  }
  if (!builder) return finish(ctx, buildId, { error: 'The board builder agent is missing (board-builder.yaml in the examples).' });
  const catalog = boardCatalog(ctx);
  if (catalog.length === 0) return finish(ctx, buildId, { error: 'There are no agents with a tile to put on a board yet.' });
  const plannerRun = await executeAgentWithRetry(builder, {
    triggeredBy: 'dashboard',
    inputs: { REQUEST: build.request, CATALOG: JSON.stringify(catalog) },
  }, runDeps(ctx));
  builds.update(buildId, { plannerRunId: plannerRun.id });
  if (plannerRun.status !== 'completed' || !plannerRun.result) {
    return finish(ctx, buildId, { error: plannerRun.error || `The board builder didn't finish (${plannerRun.status}).` });
  }
  const parsed = extractBoardBuildPlan(plannerRun.result);
  if (!parsed.ok) return finish(ctx, buildId, { error: parsed.error });
  const plan = parsed.plan;

  // 2. Arranging: the canvas, the dashboard's name and sections.
  builds.update(buildId, { phase: 'arranging', detail: 'Arranging the board…', missing: plan.missing });
  const tileable = new Set(catalog.map((c) => String(c.id)));
  const { doc, placed } = boardDocFromBuildPlan(plan, (id) => tileable.has(id));
  const dashboard = ctx.dashboardsStore!.getDashboard(build.boardId);
  const name = opts.keepName && dashboard ? dashboard.name : plan.name;
  ctx.dashboardsStore!.upsertDashboard({ id: build.boardId, packId: null, name, layout: { sections: sectionsFromBoardDoc(doc) } });
  const boards = new BoardsStore(ctx.runStore.databaseHandle());
  const current = boards.get(build.boardId);
  boards.saveDoc({ id: build.boardId, name, doc, expectedVersion: current?.version ?? 0 });
  if (placed.length === 0) {
    return finish(ctx, buildId, { placed, summary: plan.summary, name, error: plan.missing.length ? undefined : 'None of your agents fit that request.' });
  }

  // 3. Running: each tile once, a few at a time, so the board opens with results.
  const runnable = placed.map((id) => ctx.agentStore.getAgent(id)).filter((a): a is Agent => Boolean(a) && !needsInput(a!));
  builds.update(buildId, { phase: 'running', placed, detail: `Running ${runnable.length} tile${runnable.length === 1 ? '' : 's'}…` });
  const failed: string[] = [];
  let next = 0;
  let doneCount = 0;
  const worker = async () => {
    while (next < runnable.length) {
      const agent = runnable[next++];
      try {
        const run = await executeAgentWithRetry(agent, { triggeredBy: 'dashboard' }, runDeps(ctx));
        if (run.status !== 'completed') failed.push(agent.id);
      } catch { failed.push(agent.id); }
      doneCount += 1;
      builds.update(buildId, { detail: `Ran ${doneCount} of ${runnable.length} tiles…`, failed: [...failed] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(RUN_CONCURRENCY, runnable.length) }, worker));
  finish(ctx, buildId, { placed, failed, summary: plan.summary, name });
}

/** Mark the build done (or failed) and tell the person in the inbox. */
function finish(ctx: Ctx, buildId: string, r: { error?: string; placed?: string[]; failed?: string[]; summary?: string; name?: string }): void {
  const builds = buildsOf(ctx);
  const build = builds.get(buildId);
  if (!build) return;
  const failedBuild = Boolean(r.error) && !(r.placed?.length);
  builds.update(buildId, {
    phase: failedBuild ? 'failed' : 'done',
    detail: failedBuild ? 'The build stopped.' : (r.summary || 'Ready.'),
    ...(r.error ? { error: r.error } : {}),
    ...(r.placed ? { placed: r.placed } : {}),
    ...(r.failed ? { failed: r.failed } : {}),
  });
  const done = builds.get(buildId)!;
  const name = r.name ?? ctx.dashboardsStore?.getDashboard(build.boardId)?.name ?? build.boardId;
  const link = `/dashboards/${encodeURIComponent(build.boardId)}`;
  const lines = failedBuild
    ? [`Your request: "${build.request}"`, '', `What went wrong: ${r.error}`, '', `The empty board is at ${link}; delete it, or try again with a different request.`]
    : [
      r.summary || '',
      '',
      `Open it: ${link}`,
      `${done.placed.length} tile${done.placed.length === 1 ? '' : 's'} from your agents${done.failed.length ? `; ${done.failed.length} didn't run cleanly (${done.failed.join(', ')}) — their tiles show what happened` : ', all run'}.`,
      ...(done.missing.length ? ['', 'Not covered by any of your agents yet:', ...done.missing.map((m) => `- ${m.purpose}${m.suggestedName ? ` (${m.suggestedName})` : ''}`), '', 'Build an agent for any of these (Build from goal), then add it with Arrange.'] : []),
    ];
  try {
    ctx.inboxStore?.add({
      priority: failedBuild ? 'high' : 'medium',
      source: 'board',
      title: failedBuild ? 'Couldn\'t build your board' : `Your board "${name}" is ready`,
      body: lines.join('\n').trim(),
      dedupeKey: `board-build:${buildId}`,
      contextJson: JSON.stringify({ kind: 'board-build', buildId, boardId: build.boardId }),
    });
  } catch { /* the board page still shows the outcome */ }
}

/** After a restart: builds that were mid-way can't resume; say so. */
export function reportInterruptedBoardBuilds(ctx: Ctx): void {
  try {
    for (const b of buildsOf(ctx).unfinished()) {
      finish(ctx, b.id, { error: 'The dashboard restarted while this board was being built.', placed: b.placed, failed: b.failed });
    }
  } catch { /* no table yet */ }
}

/** The latest build of a board, for its page. */
export function latestBoardBuild(ctx: Ctx, boardId: string): BoardBuild | undefined {
  try { return buildsOf(ctx).latestFor(boardId); } catch { return undefined; }
}
