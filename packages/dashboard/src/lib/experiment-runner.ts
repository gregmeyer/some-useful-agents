/**
 * Running an experiment's pass (ADR-0078): each cell runs the whole agent
 * once under its version, and keeps the items that run's output lists. Two
 * cells run at a time; progress is kept cell by cell in the store, so Stop,
 * Resume and a restart all leave the pass where it was.
 *
 * A cell's run is an unsaved copy of the agent under an experiment's id
 * (core agentForCondition), so the agent's own history, spend, memory and
 * state never see it. It is otherwise the agent as it is: it searches,
 * reads and uses its tools. When a version names a provider the run may
 * use no other; a run that still used another is invalid, not counted. A
 * run whose output has no list sua can read is invalid too.
 */
import { randomUUID } from 'node:crypto';
import {
  ExperimentStore, NotebookStore, SYSTEM_AGENT_IDS, agentForCondition, cleanJudgement, conditionLevels, conditionSettings, executeAgentDag, experimentAgentId, experimentAgentOf, experimentConditions,
  extractPriorAgentInputs, extractTaggedJson, passProgress, readOutput,
  type Agent, type Experiment, type ExperimentCell, type ExperimentPass, type OutputItem,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const EXPERIMENT_JUDGE_ID = 'experiment-judge';
/** Cells run at once. */
const POOL = 2;
/** A cell's run is given up on after this long (it is the whole agent). */
const CELL_TIMEOUT_MS = 15 * 60 * 1000;
const JUDGE_TIMEOUT_MS = 4 * 60 * 1000;

/** A pass under way in this process. */
export interface ExperimentPassState { experimentId: string; startedAt: string; stop: boolean; runs: Set<string>; done?: Promise<void> }

const stores = (ctx: Ctx) => ExperimentStore.fromHandle(ctx.runStore.databaseHandle());

/** Tell the notebook that shows an experiment that its results moved on, so an open page redraws. */
function touchNotebook(ctx: Ctx, experimentId: string): void {
  try {
    const nbs = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
    const nb = nbs.forExperiment(experimentId);
    if (nb && !nb.archivedAt) nbs.touch(nb.id);
  } catch { /* the page shows it when next opened */ }
}

/** Put the judge in the catalog and keep it current (at startup). */
export function installExperimentJudge(ctx: Ctx): boolean {
  return ensureSystemAgentCurrent(ctx, EXPERIMENT_JUDGE_ID, 'scoring an experiment\'s results against a rubric');
}

/** At boot: cells a restart left running are stopped where they were, to be resumed. Returns how many passes. */
export function reconcileExperimentsOnBoot(ctx: Ctx): number {
  try { return stores(ctx).stopInterrupted().length; } catch { return 0; }
}

/** The pass of this experiment that is running here, if one is. */
export function runningPass(ctx: Ctx, experimentId: string): string | undefined {
  for (const [passId, s] of ctx.experimentPasses ?? []) if (s.experimentId === experimentId) return passId;
  return undefined;
}

/** What one run of this agent has cost lately, on average (its own runs and earlier experiment runs of it). Undefined when none has a recorded cost. */
export function costPerRun(ctx: Ctx, agentId: string): number | undefined {
  try {
    const rows = [agentId, experimentAgentId(agentId)].flatMap((name) => ctx.runStore.queryRuns({ agentName: name, statuses: ['completed'], limit: 20 }).rows);
    const costs = rows.map((r) => (r as { costUsd?: number }).costUsd).filter((c): c is number => typeof c === 'number' && c > 0);
    return costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : undefined;
  } catch {
    return undefined;
  }
}

/** An agent that could be run in an experiment, with how much it has been run. */
export interface TestableAgent {
  id: string; name: string; description?: string; runs: number; current?: number;
  versions: Array<{ v: number; at: string; note?: string }>;
  /** Its inputs, with what its last run was given (the ask starts from these). */
  inputs: Array<{ name: string; description?: string; required?: boolean; last?: string; fallback?: string }>;
  /** Its latest completed run lists items sua can read (so its results can be compared). */
  lists?: number;
  costPerRun?: number;
}

/** The operator's own agents (not sua's, not an experiment's copies), the most run first. */
export function testableAgents(ctx: Ctx): TestableAgent[] {
  const out: TestableAgent[] = [];
  for (const a of ctx.agentStore.listAgents()) {
    if (SYSTEM_AGENT_IDS.has(a.id) || experimentAgentOf(a.id)) continue;
    let runs = 0;
    let lastId: string | undefined;
    try { const q = ctx.runStore.queryRuns({ agentName: a.id, statuses: ['completed'], limit: 1 }); runs = q.total; lastId = q.rows[0]?.id; } catch { runs = 0; }
    let versions: TestableAgent['versions'] = [];
    try { versions = ctx.agentStore.listVersions(a.id).slice(0, 20).map((v) => ({ v: v.version, at: v.createdAt.slice(0, 10), ...(v.commitMessage ? { note: v.commitMessage.slice(0, 60) } : {}) })); } catch { versions = []; }
    let last: Record<string, string> = {};
    try { if (lastId) last = extractPriorAgentInputs(a, lastId, ctx.runStore); } catch { last = {}; }
    const inputs = Object.entries(a.inputs ?? {}).slice(0, 16).map(([name, spec]) => {
      const s = spec as { description?: string; required?: boolean; default?: unknown };
      return { name, ...(s.description ? { description: s.description.slice(0, 160) } : {}), ...(s.required ? { required: true } : {}), ...(last[name] ? { last: last[name].slice(0, 2000) } : {}), ...(s.default !== undefined && s.default !== '' ? { fallback: String(s.default).slice(0, 2000) } : {}) };
    });
    out.push({ id: a.id, name: a.name, ...(a.description ? { description: a.description } : {}), runs, ...(a.version !== undefined ? { current: a.version } : {}), versions, inputs });
  }
  out.sort((x, y) => y.runs - x.runs || x.name.localeCompare(y.name));
  // Whether its results can be read is looked up for the most run only (it reads a run's output).
  for (const a of out.slice(0, 12)) {
    try {
      const row = ctx.runStore.queryRuns({ agentName: a.id, statuses: ['completed'], limit: 1 }).rows[0];
      if (row) a.lists = readRun(ctx, row.id).items.length;
      const cost = costPerRun(ctx, a.id);
      if (cost !== undefined) a.costPerRun = cost;
    } catch { /* unknown */ }
  }
  return out;
}

/** The items a run's output lists: its result, else its steps' outputs, the last first. */
export function readRun(ctx: Ctx, runId: string): { listed: boolean; items: OutputItem[] } {
  const run = ctx.runStore.getRun(runId);
  let out = readOutput(run?.result);
  if (out.listed) return out;
  try { for (const n of [...ctx.runStore.listNodeExecutions(runId)].reverse()) { out = readOutput(n.result ?? undefined); if (out.listed) return out; } } catch { /* its result was all there was */ }
  return { listed: false, items: [] };
}

interface CellRun { text?: string; runId?: string; usedProvider?: string; costUsd?: number; error?: string }

/** One run of an agent for a cell (or the test's stand-in). Never throws. */
async function runAgent(ctx: Ctx, state: ExperimentPassState, agent: Agent, inputs: Record<string, string>, provider: string | undefined, timeoutMs: number, at: { conditionId: string; repeat: number; judge?: string }): Promise<CellRun> {
  try {
    if (at.judge) { if (ctx.experimentJudgeRun) return { text: await ctx.experimentJudgeRun(inputs, { ...at, scorerId: at.judge }) }; }
    else if (ctx.experimentTaskRun) return { text: await ctx.experimentTaskRun(inputs, at) };
    const runId = randomUUID();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    ctx.activeRuns.set(runId, ac);
    state.runs.add(runId);
    try {
      const snap = buildLlmSettingsSnapshot(ctx);
      // No run hooks: a failed run is an unusable cell on the experiment's page, not an inbox item.
      await executeAgentDag(agent, { triggeredBy: 'experiment', runId, signal: ac.signal, inputs, suppressNotify: true }, {
        runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore, integrationsStore: ctx.integrationsStore,
        toolStore: ctx.toolStore, agentStore: ctx.agentStore, allowUntrustedShell: ctx.allowUntrustedShell, dashboardBaseUrl: ctx.dashboardBaseUrl,
        dataRoot: ctx.agentStore.dataRoot,
        // A version that names a provider may use no other: no quiet switch to the next one.
        llmSettings: provider && snap ? { ...snap, providers: [provider] } : snap,
        spawnNode: ctx.workflowSpawnNode,
      });
      const run = ctx.runStore.getRun(runId);
      const nodes = ctx.runStore.listNodeExecutions(runId);
      const used = [...new Set(nodes.map((n) => n.usedLLMProvider).filter((p): p is string => !!p))];
      const cost = (run as { costUsd?: number } | undefined)?.costUsd;
      return {
        runId,
        ...(run?.status === 'completed' ? { text: run.result ?? '' } : { error: run?.error ?? (ac.signal.aborted ? 'It was stopped, or ran out of time.' : 'The run did not complete.') }),
        ...(used.length ? { usedProvider: used.join(', ') } : {}),
        ...(typeof cost === 'number' ? { costUsd: cost } : {}),
      };
    } finally {
      clearTimeout(timer);
      ctx.activeRuns.delete(runId);
      state.runs.delete(runId);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** The inputs a cell's run is given: the ask, with what its version changes laid over; only inputs the agent declares. */
export function cellInputs(agent: Pick<Agent, 'inputs'> | undefined, ask: Record<string, string>, changed: Record<string, string>): Record<string, string> {
  const all = { ...ask, ...changed };
  const declared = agent?.inputs ? new Set(Object.keys(agent.inputs)) : undefined;
  return declared ? Object.fromEntries(Object.entries(all).filter(([k]) => declared.has(k))) : all;
}

async function runCell(ctx: Ctx, store: ExperimentStore, state: ExperimentPassState, e: Experiment, cell: ExperimentCell): Promise<void> {
  const condition = experimentConditions(e.factors).find((x) => x.id === cell.conditionId);
  if (!condition) { store.updateCell(cell.id, { status: 'failed', error: 'Its version is no longer part of the experiment.' }); return; }
  const levels = conditionLevels(e.factors, condition);
  const set = conditionSettings(levels);
  const base = set.version !== undefined ? ctx.agentStore.getAgentAtVersion(e.task.agentId, set.version) : ctx.agentStore.getAgent(e.task.agentId);
  if (!base && !ctx.experimentTaskRun) { store.updateCell(cell.id, { status: 'failed', error: set.version !== undefined ? `${e.task.agentId} has no version ${String(set.version)}.` : `${e.task.agentId} isn't installed.` }); return; }
  const agent = base ? agentForCondition(base, levels) : ({ id: experimentAgentId(e.task.agentId), nodes: [] } as unknown as Agent);
  const inputs = cellInputs(base ?? undefined, e.inputs, set.inputs);
  const last = await runAgent(ctx, state, agent, inputs, set.provider, CELL_TIMEOUT_MS, { conditionId: cell.conditionId, repeat: cell.repeat });
  if (last.runId) store.updateCell(cell.id, { runId: last.runId });
  const common = { ...(base?.version !== undefined ? { agentVersion: base.version } : {}), ...(last.usedProvider ? { usedProvider: last.usedProvider } : {}), ...(set.model ? { usedModel: set.model } : {}), ...(last.costUsd ? { costUsd: last.costUsd } : {}) };
  if (state.stop && last.error) { store.updateCell(cell.id, { ...common, status: 'stopped', error: 'Stopped.' }); return; }
  if (last.error) { store.updateCell(cell.id, { ...common, status: 'failed', error: last.error }); return; }
  // The version named a provider and the run used another: it isn't a run of that version.
  if (set.provider && last.usedProvider && last.usedProvider !== set.provider) { store.updateCell(cell.id, { ...common, status: 'invalid', error: `It ran on ${last.usedProvider}, not ${set.provider}.` }); return; }
  // What it produced, as items: from the run's result, else from its steps' outputs.
  const out = last.runId ? readRun(ctx, last.runId) : readOutput(last.text);
  if (!out.listed) { store.updateCell(cell.id, { ...common, status: 'invalid', error: 'Its output has no list of items sua could read (it looks for JSON with a list of things, or a bulleted list).' }); return; }
  store.updateCell(cell.id, { ...common, status: 'done', items: out.items });
  await judgeCell(ctx, store, state, e, cell, out.items, inputs);
}

/** A judge's answer as a score, or why it can't be used. */
export function parseJudgement(text: string | undefined, itemCount: number): ReturnType<typeof cleanJudgement> {
  let v: unknown;
  try { v = JSON.parse(extractTaggedJson(text ?? '', 'score') ?? 'null'); } catch { return { error: 'Its <score> block is not valid JSON.' }; }
  if (v === null) return { error: 'It has no <score> block.' };
  return cleanJudgement(v, itemCount);
}

/**
 * Each judge reads the result once (and once more, told why, when its
 * answer can't be used). A judge sees the ask as that run was given it and
 * the items it listed, never which version it was. A judge that fails
 * leaves the result standing with no score from it.
 */
async function judgeCell(ctx: Ctx, store: ExperimentStore, state: ExperimentPassState, e: Experiment, cell: ExperimentCell, items: readonly OutputItem[], asked: Record<string, string>): Promise<void> {
  store.clearScores(cell.id);
  for (const s of e.scorers) {
    if (s.kind !== 'judge' || state.stop) continue;
    const installed = ctx.agentStore.getAgent(EXPERIMENT_JUDGE_ID);
    if (!installed && !ctx.experimentJudgeRun) { store.setScore(cell.passId, { cellId: cell.id, scorerId: s.id, error: 'The judge isn\'t installed.' }); continue; }
    const judge = installed ? agentForCondition(installed, [{ id: s.id, name: s.name, ...(s.provider ? { provider: s.provider } : {}), ...(s.model ? { model: s.model } : {}) }]) : ({ id: experimentAgentId(EXPERIMENT_JUDGE_ID), nodes: [] } as unknown as Agent);
    const inputs = (errors: string) => ({
      RUBRIC: s.rubric,
      ASK: Object.entries(asked).map(([k, v]) => `${k}: ${v.length > 1500 ? `${v.slice(0, 1499)}…` : v}`).join('\n'),
      RESULT: JSON.stringify(items.slice(0, 60).map((i, n) => ({ n: n + 1, title: i.title, facts: i.facts, ...(i.link ? { link: i.link } : {}) }))),
      ERRORS: errors ? `Your last answer couldn't be used: ${errors} Answer again, fixing that.` : '',
    });
    let last: CellRun = {};
    let out: ReturnType<typeof parseJudgement> = { error: 'It was not run.' };
    for (let attempt = 0; attempt < 2 && !state.stop; attempt++) {
      last = await runAgent(ctx, state, judge, inputs(attempt && 'error' in out ? out.error : ''), s.provider, JUDGE_TIMEOUT_MS, { conditionId: cell.conditionId, repeat: cell.repeat, judge: s.id });
      if (last.error) { out = { error: last.error }; break; }
      out = parseJudgement(last.text, Math.min(items.length, 60));
      if (!('error' in out)) break;
    }
    store.setScore(cell.passId, { cellId: cell.id, scorerId: s.id, ...(last.runId ? { runId: last.runId } : {}), ...('error' in out ? { error: out.error } : out) });
  }
}

/**
 * Start a pass of an experiment (or go on with one that was stopped), in
 * the background. Refuses when one is already running, or its agent isn't
 * installed.
 */
export function startExperimentPass(ctx: Ctx, experimentId: string, opts: { resume?: string; retry?: boolean } = {}): { started: boolean; pass?: ExperimentPass; reason?: string } {
  const store = stores(ctx);
  const e = store.get(experimentId);
  if (!e) return { started: false, reason: 'No such experiment.' };
  if (e.archivedAt) return { started: false, reason: 'It is archived. Restore it to run it.' };
  if (runningPass(ctx, experimentId)) return { started: false, reason: 'It is already running.' };
  const agent = ctx.agentStore.getAgent(e.task.agentId);
  if (!agent && !ctx.experimentTaskRun) return { started: false, reason: `Its agent, ${e.task.agentId}, isn't installed.` };
  let pass: ExperimentPass | undefined;
  if (opts.resume) {
    pass = store.getPass(opts.resume);
    if (!pass || pass.experimentId !== experimentId) return { started: false, reason: 'No such pass.' };
    if (!store.resumePass(pass.id, { retry: opts.retry })) return { started: false, reason: 'Nothing in it is left to run.' };
    pass = store.getPass(pass.id);
  } else {
    pass = store.startPass(experimentId, agent?.version !== undefined ? { taskVersion: agent.version } : {});
  }
  if (!pass) return { started: false, reason: 'The pass could not be started.' };
  const passId = pass.id;
  const state: ExperimentPassState = { experimentId, startedAt: new Date().toISOString(), stop: false, runs: new Set() };
  ctx.experimentPasses ??= new Map();
  ctx.experimentPasses.set(passId, state);
  touchNotebook(ctx, experimentId);
  const worker = async () => {
    while (!state.stop) {
      const cell = store.claimCell(passId);
      if (!cell) return;
      try { await runCell(ctx, store, state, e, cell); } catch (err) { store.updateCell(cell.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) }); }
      touchNotebook(ctx, experimentId);
    }
  };
  state.done = Promise.all(Array.from({ length: POOL }, worker)).then(() => undefined, () => undefined).finally(() => {
    try {
      const p = passProgress(store.cells(passId));
      store.finishPass(passId, state.stop ? `Stopped: ${String(p.done)} of ${String(p.total)} run.` : `${String(p.done)} of ${String(p.total)} run${p.invalid + p.failed ? `, ${String(p.invalid + p.failed)} couldn't be used` : ''}.`);
    } catch { /* the cells say how it went */ }
    ctx.experimentPasses?.delete(passId);
    touchNotebook(ctx, experimentId);
  });
  return { started: true, pass };
}

/** Stop the pass an experiment is running: nothing more starts, and the runs under way are ended. */
export function stopExperimentPass(ctx: Ctx, experimentId: string): boolean {
  const passId = runningPass(ctx, experimentId);
  const state = passId ? ctx.experimentPasses?.get(passId) : undefined;
  if (!passId || !state) return false;
  state.stop = true;
  stores(ctx).stopPass(passId);
  for (const runId of state.runs) ctx.activeRuns.get(runId)?.abort();
  return true;
}
