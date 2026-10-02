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
  queueBoardBuild,
  BoardsStore,
  boardDocFromBuildPlan,
  applyBoardOps,
  executeAgentWithRetry,
  extractBoardBuildPlan,
  parseAgent,
  readExampleYaml,
  sectionsFromBoardDoc,
  type Agent,
  type BoardBuild,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { advanceSession, getSession, startDraftOneSession } from '../routes/build-orchestrator.js';
import { autoFixYaml } from '../routes/run-now-build.js';
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
export function startBoardBuild(ctx: Ctx, args: { request: string; name?: string; origin?: string }): { boardId: string; build: BoardBuild } {
  if (!ctx.dashboardsStore) throw new Error('Dashboards are not available.');
  const { boardId, build } = queueBoardBuild(ctx.runStore.databaseHandle(), ctx.dashboardsStore, { request: args.request, ...(args.name ? { name: args.name } : {}), origin: args.origin ?? 'dashboard' });
  launch(ctx, build.id);
  return { boardId, build };
}

function launch(ctx: Ctx, buildId: string): void {
  void runBoardBuild(ctx, buildId).catch((err) => {
    finish(ctx, buildId, { error: (err as Error).message || 'The build stopped unexpectedly.' });
  });
}

/**
 * Run builds queued from elsewhere (the MCP server's build-board tool), or
 * left queued while the dashboard was down. Each is claimed first, so two
 * dashboards on one data dir can't both run it.
 */
export function startQueuedBoardBuilds(ctx: Ctx): number {
  let started = 0;
  try {
    const builds = buildsOf(ctx);
    for (const b of builds.queued()) {
      if (!builds.claim(b.id)) continue;
      launch(ctx, b.id);
      started += 1;
    }
  } catch { /* no table yet */ }
  return started;
}

/** Check for queued builds every few seconds (the timer never keeps the process alive). */
export function watchQueuedBoardBuilds(ctx: Ctx, everyMs = 4000): () => void {
  const t = setInterval(() => startQueuedBoardBuilds(ctx), everyMs);
  t.unref?.();
  return () => clearInterval(t);
}

/** Run a build's failed tiles again; the board's banner shows the new outcome when they finish. */
export function retryFailedTiles(ctx: Ctx, buildId: string): { ok: boolean; message: string; boardId?: string } {
  const builds = buildsOf(ctx);
  const build = builds.get(buildId);
  if (!build) return { ok: false, message: 'That board build no longer exists.' };
  const agents = build.failed.map((id) => ctx.agentStore.getAgent(id)).filter((a): a is Agent => Boolean(a));
  if (agents.length === 0) return { ok: false, message: 'Nothing to retry.', boardId: build.boardId };
  builds.update(buildId, { detail: `Retrying ${agents.length} tile${agents.length === 1 ? '' : 's'}…` });
  void Promise.all(agents.map(async (agent) => {
    try { return (await executeAgentWithRetry(agent, { triggeredBy: 'dashboard' }, runDeps(ctx))).status === 'completed' ? null : agent.id; } catch { return agent.id; }
  })).then((still) => {
    const failed = still.filter((x): x is string => Boolean(x));
    builds.update(buildId, { failed, detail: failed.length ? `${failed.length} tile${failed.length === 1 ? '' : 's'} still didn't run cleanly.` : 'All tiles ran.' });
  });
  return { ok: true, message: `Running ${agents.length} tile${agents.length === 1 ? '' : 's'} again.`, boardId: build.boardId };
}

async function runBoardBuild(ctx: Ctx, buildId: string): Promise<void> {
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
  const name = build.keepName && dashboard ? dashboard.name : plan.name;
  ctx.dashboardsStore!.upsertDashboard({ id: build.boardId, packId: null, name, layout: { sections: sectionsFromBoardDoc(doc) } });
  const boards = new BoardsStore(ctx.runStore.databaseHandle());
  const current = boards.get(build.boardId);
  boards.saveDoc({ id: build.boardId, name, doc, expectedVersion: current?.version ?? 0 });
  if (placed.length === 0) {
    if (!plan.missing.length) return finish(ctx, buildId, { placed, summary: plan.summary, name, error: 'None of your agents fit that request.' });
    finish(ctx, buildId, { placed, summary: plan.summary, name, drafting: true });
    return draftMissing(ctx, buildId, { request: build.request, name, missing: plan.missing });
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
  finish(ctx, buildId, { placed, failed, summary: plan.summary, name, drafting: plan.missing.length > 0 });
  if (plan.missing.length) await draftMissing(ctx, buildId, { request: build.request, name, missing: plan.missing });
}

/** Mark the build done (or failed) and tell the person in the inbox. */
function finish(ctx: Ctx, buildId: string, r: { error?: string; placed?: string[]; failed?: string[]; summary?: string; name?: string; drafting?: boolean }): void {
  const builds = buildsOf(ctx);
  const build = builds.get(buildId);
  if (!build) return;
  const failedBuild = Boolean(r.error) && !(r.placed?.length);
  const missingCount = build.missing.length;
  builds.update(buildId, {
    phase: failedBuild ? 'failed' : r.drafting ? 'drafting' : 'done',
    detail: failedBuild ? 'The build stopped.' : r.drafting
      ? `Drafting ${missingCount} new agent${missingCount === 1 ? '' : 's'} for the parts your agents don't cover…`
      : (r.summary || 'Ready.'),
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
      ...(done.missing.length ? ['', 'Not covered by any of your agents yet:', ...done.missing.map((m) => `- ${m.purpose}${m.suggestedName ? ` (${m.suggestedName})` : ''}`), '', r.drafting
        ? 'sua is drafting agents for these now. They won\'t run until you approve them; you\'ll be asked here in your inbox.'
        : 'Build an agent for any of these (Build from goal), then add it with Arrange.'] : []),
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

// ── Drafting the missing agents (one approval) ───────────────────────────

/** How long one draft may take (drafter + critic retries). */
const DRAFT_TIMEOUT_MS = 8 * 60_000;

/**
 * Draft an agent for each part no agent covers, with Build from goal's drafter
 * and critic. Drafts are saved with status "draft": you can open them, but
 * nothing runs them. Then ONE inbox item asks to approve them all.
 */
async function draftMissing(ctx: Ctx, buildId: string, args: { request: string; name: string; missing: Array<{ purpose: string; suggestedName?: string }> }): Promise<void> {
  const builds = buildsOf(ctx);
  const build = builds.get(buildId)!;
  const drafts: BoardBuild['drafts'] = [];
  for (const [i, m] of args.missing.entries()) {
    builds.update(buildId, { detail: `Drafting agent ${i + 1} of ${args.missing.length}: ${m.purpose}…`, drafts: [...drafts] });
    drafts.push(await draftOne(ctx, m, args));
  }
  const ok = drafts.filter((d) => d.ok && d.id);
  const link = `/dashboards/${encodeURIComponent(build.boardId)}`;
  if (ok.length === 0) {
    builds.update(buildId, { phase: 'done', drafts, detail: 'Couldn\'t draft agents for the missing parts.' });
    try {
      ctx.inboxStore?.add({
        priority: 'low', source: 'board', title: `No new agents drafted for "${args.name}"`,
        body: [`sua couldn't draft agents for the parts of your board that none of your agents cover:`, ...drafts.map((d) => `- ${d.purpose}: ${d.error ?? 'no draft'}`), '', `Try Build from goal on the Agents page, then add them to ${link} with Arrange.`].join('\n'),
        dedupeKey: `board-drafts:${buildId}`, contextJson: JSON.stringify({ kind: 'board-build', buildId, boardId: build.boardId }),
      });
    } catch { /* noted on the board page */ }
    return;
  }
  let messageId: string | undefined;
  try {
    const msg = ctx.inboxStore?.add({
      priority: 'medium',
      source: 'board',
      title: `Approve ${ok.length} new agent${ok.length === 1 ? '' : 's'} for your board "${args.name}"?`,
      body: [
        `None of your agents covered ${ok.length === 1 ? 'one part' : 'some parts'} of your board, so sua drafted ${ok.length === 1 ? 'an agent' : `${ok.length} agents`}. They're saved as drafts and haven't run.`,
        '',
        ...ok.map((d) => `- **${d.name ?? d.id}** (\`${d.id}\`): ${d.purpose}. Review: /agents/${d.id}${d.hasTile ? '' : ' (no tile yet, so it won\'t show on the board)'}`),
        ...drafts.filter((d) => !d.ok).map((d) => `- Couldn't draft: ${d.purpose} (${d.error ?? 'no draft'})`),
        '',
        `**Approve** makes them active, adds them to ${link} and runs them once. **Decline** deletes the drafts.`,
      ].join('\n'),
      dedupeKey: `board-approval:${buildId}`,
      contextJson: JSON.stringify({ kind: 'board-agents-approval', buildId, boardId: build.boardId, agentIds: ok.map((d) => d.id) }),
    });
    messageId = msg?.id;
  } catch { /* the board page still offers the approval */ }
  builds.update(buildId, {
    phase: 'done', drafts, approval: 'pending', ...(messageId ? { approvalMessageId: messageId } : {}),
    detail: `${ok.length} new agent${ok.length === 1 ? ' is' : 's are'} waiting for your approval.`,
  });
}

async function draftOne(ctx: Ctx, m: { purpose: string; suggestedName?: string }, args: { request: string; name: string }): Promise<BoardBuild['drafts'][number]> {
  const focus = `This agent will be a tile on the board "${args.name}", built for the request: "${args.request}". It must have a Pulse tile (signal, or an A2UI view) that shows its result, and it must run with no input or with defaults.`;
  let sessionId: string | null = null;
  try { sessionId = await startDraftOneSession({ ctx, purpose: m.purpose, ...(m.suggestedName ? { suggestedName: m.suggestedName } : {}), focus }); } catch (err) {
    return { purpose: m.purpose, ok: false, error: (err as Error).message };
  }
  if (!sessionId) return { purpose: m.purpose, ok: false, error: 'the agent drafter is missing' };
  const started = Date.now();
  for (;;) {
    const session = getSession(sessionId);
    if (!session) return { purpose: m.purpose, ok: false, error: 'the draft was lost' };
    await advanceSession(ctx, session);
    if (session.phase === 'failed' || session.phase === 'nothing_to_build') return { purpose: m.purpose, ok: false, error: session.error ?? session.phaseMessage };
    if (session.phase === 'done') {
      const ref = session.plan?.newAgents?.[0];
      if (!ref) return { purpose: m.purpose, ok: false, error: 'the drafter returned no agent' };
      try {
        const parsed = parseAgent(autoFixYaml(ref.yaml));
        if (ctx.agentStore.getAgent(parsed.id)) return { purpose: m.purpose, ok: false, error: `an agent "${parsed.id}" already exists` };
        ctx.agentStore.createAgent({ ...parsed, source: 'local', status: 'draft' }, 'dashboard', `Drafted for the board "${args.name}" (needs approval)`);
        const hasTile = Boolean(withTileSignal(ctx.agentStore.getAgent(parsed.id))?.signal);
        return { purpose: m.purpose, ok: true, id: parsed.id, name: parsed.name, hasTile };
      } catch (err) {
        return { purpose: m.purpose, ok: false, error: `the draft didn't load: ${(err as Error).message}` };
      }
    }
    if (Date.now() - started > DRAFT_TIMEOUT_MS) return { purpose: m.purpose, ok: false, error: 'drafting took too long' };
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * The one approval. Approve: drafts become active, join the board in a "New
 * agents" section and run once. Decline: drafts are deleted. Either way the
 * inbox item is resolved. Idempotent: only a pending approval acts.
 */
export function decideBoardDrafts(ctx: Ctx, buildId: string, decision: 'approve' | 'decline'): { ok: boolean; message: string; boardId?: string } {
  const builds = buildsOf(ctx);
  const build = builds.get(buildId);
  if (!build) return { ok: false, message: 'That board build no longer exists.' };
  if (build.approval !== 'pending') return { ok: false, message: `Already ${build.approval ?? 'decided'}.`, boardId: build.boardId };
  const ids = build.drafts.filter((d) => d.ok && d.id).map((d) => d.id!)
    .filter((id) => ctx.agentStore.getAgent(id)?.status === 'draft');
  let message: string;
  if (decision === 'decline') {
    for (const id of ids) { try { ctx.agentStore.deleteAgent(id); } catch { /* already gone */ } }
    builds.update(buildId, { approval: 'declined', detail: 'The drafted agents were declined and deleted.' });
    message = `Declined: deleted ${ids.length} draft agent${ids.length === 1 ? '' : 's'}.`;
  } else {
    for (const id of ids) ctx.agentStore.updateAgentMeta(id, { status: 'active' });
    const withTiles = ids.filter((id) => Boolean(withTileSignal(ctx.agentStore.getAgent(id))?.signal));
    if (withTiles.length) {
      const boards = new BoardsStore(ctx.runStore.databaseHandle());
      const current = boards.loadDocOrDerive(build.boardId);
      if (current) {
        try {
          const sec = applyBoardOps(current.doc, [{ op: 'insert', parent: 'root', node: { type: 'section', title: 'New agents' } }]);
          const grid = sec.doc.components.find((c) => c.id === sec.created[0])!.child as string;
          const out = applyBoardOps(sec.doc, withTiles.map((agentId) => ({ op: 'insert' as const, parent: grid, node: { type: 'tile' as const, agentId } })));
          boards.saveDoc({ id: build.boardId, name: current.name, packId: current.packId, doc: out.doc, expectedVersion: current.version });
          const dash = ctx.dashboardsStore?.getDashboard(build.boardId);
          if (dash) ctx.dashboardsStore!.upsertDashboard({ id: dash.id, packId: dash.packId, name: dash.name, layout: { sections: sectionsFromBoardDoc(out.doc) } });
        } catch { /* agents are active anyway; they can be added with Arrange */ }
      }
    }
    for (const id of ids) {
      const agent = ctx.agentStore.getAgent(id);
      if (agent && !needsInput(agent)) void executeAgentWithRetry(agent, { triggeredBy: 'dashboard' }, runDeps(ctx)).catch(() => { /* shows as a failed run */ });
    }
    builds.update(buildId, { approval: 'approved', placed: [...build.placed, ...withTiles], detail: `Added ${withTiles.length} new agent${withTiles.length === 1 ? '' : 's'} to the board.` });
    message = `Approved: ${ids.length} agent${ids.length === 1 ? '' : 's'} now active${withTiles.length ? `, ${withTiles.length} added to the board and running` : ''}.`;
  }
  if (build.approvalMessageId && ctx.inboxStore) {
    try {
      ctx.inboxStore.addResponse(build.approvalMessageId, 'system', message);
      ctx.inboxStore.updateStatus(build.approvalMessageId, 'resolved');
    } catch { /* the board page shows the outcome */ }
  }
  return { ok: true, message, boardId: build.boardId };
}
