/**
 * Running an experiment's pass (ADR-0078): each cell runs the task agent
 * once under its condition and keeps the ranking that run returned. Two
 * cells run at a time; progress is kept cell by cell in the store, so Stop,
 * Resume and a restart all leave the pass where it was.
 *
 * A cell's run is an unsaved copy of the agent under an experiment's id
 * (core agentForCondition), with no state folder, memory or notifications:
 * the agent's own history, spend and state never see it. When a condition
 * names a provider the run may use no other; a run that still used another
 * is invalid, not counted.
 */
import { randomUUID } from 'node:crypto';
import {
  ExperimentStore, agentForCondition, cleanRanking, conditionLevels, conditionSettings, executeAgentDag, experimentAgentId, experimentConditions,
  extractTaggedJson, formatFieldValue, notebookViewData, passProgress, rankOptions, NotebookStore,
  type Agent, type Experiment, type ExperimentCase, type ExperimentCell, type ExperimentItem, type ExperimentPass, type Notebook,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const EXPERIMENT_RANKER_ID = 'experiment-ranker';
/** Cells run at once. */
const POOL = 2;
/** A cell's run is given up on after this long. */
const CELL_TIMEOUT_MS = 5 * 60 * 1000;

/** A pass under way in this process. */
export interface ExperimentPassState { experimentId: string; startedAt: string; stop: boolean; runs: Set<string>; done?: Promise<void> }

const stores = (ctx: Ctx) => ExperimentStore.fromHandle(ctx.runStore.databaseHandle());

/** Put the default ranking agent in the catalog and keep it current (at startup). */
export function installExperimentRanker(ctx: Ctx): boolean {
  return ensureSystemAgentCurrent(ctx, EXPERIMENT_RANKER_ID, 'ranking a fixed list in an experiment');
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

/**
 * A notebook's options as a case to freeze: the ones still in the running,
 * each with its facts as the page shows them, in name order. Not in the
 * notebook's own ranking: the order items are shown in would lean every run
 * toward it. Pure.
 */
export function caseFromNotebook(nb: Notebook, entries: Parameters<typeof notebookViewData>[1]): { name: string; items: Array<Omit<ExperimentItem, 'id'> & { id?: string }> } {
  const options = rankOptions(nb, notebookViewData(nb, entries).notebook.options);
  const items = [...options].sort((a, b) => a.name.localeCompare(b.name)).map((o) => {
    const facts: Record<string, string> = {};
    for (const f of nb.fields) {
      if (f.role === 'link' || f.type === 'url') continue;
      const v = o.fields[f.key];
      if (v === undefined || v === null || v === '') continue;
      try { facts[f.label] = formatFieldValue(f, v); } catch { /* a fact that can't be shown is left out */ }
    }
    // The short name (it carries the company when several share a title) makes an id a reader can tell apart.
    return { id: o.name, title: o.title, facts };
  });
  return { name: nb.title, items };
}

/** Freeze a notebook's options as an experiment's case, or say why it can't be. */
export function freezeNotebook(ctx: Ctx, notebookId: string): { cases: unknown[]; from: { notebookId: string; title: string } } | { error: string } {
  const nbs = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = nbs.get(notebookId);
  if (!nb) return { error: 'No such notebook.' };
  const c = caseFromNotebook(nb, nbs.entries(nb.id, 1000));
  if (c.items.length < 2) return { error: `${nb.title} has ${String(c.items.length)} ${c.items.length === 1 ? 'option' : 'options'} in the running; an experiment needs at least two to rank.` };
  return { cases: [c], from: { notebookId: nb.id, title: nb.title } };
}

/** Lines of pasted text as a case: one item a line, "Title | Fact: value | Fact: value". */
export function caseFromPaste(text: string): { name: string; items: Array<{ title: string; facts: Record<string, string> }> } {
  const items = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [title, ...rest] = l.split('|').map((p) => p.trim());
    const facts: Record<string, string> = {};
    for (const p of rest) { const m = /^([^:]{1,60}):\s*(.+)$/.exec(p); if (m) facts[m[1].trim()] = m[2].trim(); else if (p) facts[`Note ${String(Object.keys(facts).length + 1)}`] = p; }
    return { title, facts };
  }).filter((i) => i.title);
  return { name: 'Pasted set', items };
}

/**
 * What one run of this experiment's task has cost lately, on average (its
 * own runs and earlier experiment runs of it). Undefined when none has a
 * recorded cost.
 */
export function costPerRun(ctx: Ctx, agentId: string): number | undefined {
  try {
    const rows = [agentId, experimentAgentId(agentId)].flatMap((name) => ctx.runStore.queryRuns({ agentName: name, statuses: ['completed'], limit: 20 }).rows);
    const costs = rows.map((r) => (r as { costUsd?: number }).costUsd).filter((c): c is number => typeof c === 'number' && c > 0);
    return costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : undefined;
  } catch {
    return undefined;
  }
}

/** The task's inputs for a cell: the case's items, what the condition sets, and only what the agent declares. */
export function cellInputs(agent: Pick<Agent, 'inputs'>, c: ExperimentCase, set: Record<string, string>, errors = ''): Record<string, string> {
  const all: Record<string, string> = {
    ITEMS: JSON.stringify(c.items.map((i) => ({ id: i.id, title: i.title, facts: i.facts }))),
    ...set,
    ERRORS: errors ? `Your last answer couldn't be used: ${errors} Answer again, fixing that.` : '',
  };
  const declared = agent.inputs ? new Set(Object.keys(agent.inputs)) : undefined;
  return declared ? Object.fromEntries(Object.entries(all).filter(([k]) => declared.has(k))) : all;
}

interface CellRun { text?: string; runId?: string; usedProvider?: string; usedModel?: string; costUsd?: number; error?: string }

/** One run of the task for a cell (or the test's stand-in). Never throws. */
async function runTask(ctx: Ctx, state: ExperimentPassState, agent: Agent, inputs: Record<string, string>, provider: string | undefined, at: { conditionId: string; caseId: string; repeat: number }): Promise<CellRun> {
  try {
    if (ctx.experimentTaskRun) return { text: await ctx.experimentTaskRun(inputs, at) };
    const runId = randomUUID();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CELL_TIMEOUT_MS);
    ctx.activeRuns.set(runId, ac);
    state.runs.add(runId);
    try {
      const snap = buildLlmSettingsSnapshot(ctx);
      // No dataRoot, memory or run hooks: an experiment's run leaves nothing in the agent's own state and raises nothing in the inbox.
      await executeAgentDag(agent, { triggeredBy: 'experiment', runId, signal: ac.signal, inputs, suppressNotify: true }, {
        runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore, integrationsStore: ctx.integrationsStore,
        toolStore: ctx.toolStore, agentStore: ctx.agentStore, allowUntrustedShell: ctx.allowUntrustedShell,
        // A condition that names a provider may use no other: no quiet switch to the next one.
        llmSettings: provider && snap ? { ...snap, providers: [provider] } : snap,
        spawnNode: ctx.workflowSpawnNode,
      });
      const run = ctx.runStore.getRun(runId);
      const nodes = ctx.runStore.listNodeExecutions(runId);
      const used = [...new Set(nodes.map((n) => n.usedLLMProvider).filter((p): p is string => !!p))];
      const cost = (run as { costUsd?: number } | undefined)?.costUsd;
      return {
        runId,
        ...(run?.status === 'completed' && run.result ? { text: run.result } : { error: run?.error ?? (ac.signal.aborted ? 'It was stopped.' : 'The run did not complete.') }),
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

/** A run's answer as a ranking of the case, or why it can't be used. */
export function parseRanking(text: string | undefined, c: ExperimentCase): { ranking: string[] } | { error: string } {
  let v: unknown;
  try { v = JSON.parse(extractTaggedJson(text ?? '', 'ranking') ?? 'null'); } catch { return { error: 'Its <ranking> block is not valid JSON.' }; }
  if (v === null) return { error: 'It has no <ranking> block.' };
  return cleanRanking(v, c.items);
}

async function runCell(ctx: Ctx, store: ExperimentStore, state: ExperimentPassState, e: Experiment, cases: ExperimentCase[], cell: ExperimentCell): Promise<void> {
  const c = cases.find((x) => x.id === cell.caseId);
  const condition = experimentConditions(e.factors).find((x) => x.id === cell.conditionId);
  if (!c || !condition) { store.updateCell(cell.id, { status: 'failed', error: 'Its case or condition is no longer part of the experiment.' }); return; }
  const set = conditionSettings(conditionLevels(e.factors, condition));
  const base = set.version !== undefined ? ctx.agentStore.getAgentAtVersion(e.task.agentId, set.version) : ctx.agentStore.getAgent(e.task.agentId);
  if (!base && !ctx.experimentTaskRun) { store.updateCell(cell.id, { status: 'failed', error: set.version !== undefined ? `${e.task.agentId} has no version ${String(set.version)}.` : `${e.task.agentId} isn't installed.` }); return; }
  const agent = base ? agentForCondition(base, conditionLevels(e.factors, condition)) : ({ id: experimentAgentId(e.task.agentId), nodes: [] } as unknown as Agent);
  const at = { conditionId: cell.conditionId, caseId: cell.caseId, repeat: cell.repeat };
  let cost = 0;
  let last: CellRun = {};
  let out: ReturnType<typeof parseRanking> = { error: 'It was not run.' };
  // One more try when the answer can't be used, told why.
  for (let attempt = 0; attempt < 2 && !state.stop; attempt++) {
    last = await runTask(ctx, state, agent, cellInputs(agent, c, set.inputs, attempt && 'error' in out ? out.error : ''), set.provider, at);
    cost += last.costUsd ?? 0;
    if (last.runId) store.updateCell(cell.id, { runId: last.runId });
    if (last.error) { out = { error: last.error }; break; }
    out = parseRanking(last.text, c);
    if (!('error' in out)) break;
  }
  const common = { ...(base?.version !== undefined ? { agentVersion: base.version } : {}), ...(last.usedProvider ? { usedProvider: last.usedProvider } : {}), ...(set.model ? { usedModel: set.model } : {}), ...(cost ? { costUsd: cost } : {}) };
  if (state.stop && 'error' in out) { store.updateCell(cell.id, { ...common, status: 'stopped', error: 'Stopped.' }); return; }
  if (last.error) { store.updateCell(cell.id, { ...common, status: 'failed', error: last.error }); return; }
  if ('error' in out) { store.updateCell(cell.id, { ...common, status: 'invalid', error: out.error }); return; }
  // The condition named a provider and the run used another: it isn't a run of that condition.
  if (set.provider && last.usedProvider && last.usedProvider !== set.provider) { store.updateCell(cell.id, { ...common, status: 'invalid', error: `It ran on ${last.usedProvider}, not ${set.provider}.` }); return; }
  store.updateCell(cell.id, { ...common, status: 'done', ranking: out.ranking });
}

/**
 * Start a pass of an experiment (or go on with one that was stopped), in
 * the background. Refuses when one is already running, or its task agent
 * isn't installed.
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
  const cases = store.cases(experimentId);
  const state: ExperimentPassState = { experimentId, startedAt: new Date().toISOString(), stop: false, runs: new Set() };
  ctx.experimentPasses ??= new Map();
  ctx.experimentPasses.set(passId, state);
  const worker = async () => {
    while (!state.stop) {
      const cell = store.claimCell(passId);
      if (!cell) return;
      try { await runCell(ctx, store, state, e, cases, cell); } catch (err) { store.updateCell(cell.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) }); }
    }
  };
  state.done = Promise.all(Array.from({ length: POOL }, worker)).then(() => undefined, () => undefined).finally(() => {
    try {
      const p = passProgress(store.cells(passId));
      store.finishPass(passId, state.stop ? `Stopped: ${String(p.done)} of ${String(p.total)} run.` : `${String(p.done)} of ${String(p.total)} run${p.invalid + p.failed ? `, ${String(p.invalid + p.failed)} couldn't be used` : ''}.`);
    } catch { /* the cells say how it went */ }
    ctx.experimentPasses?.delete(passId);
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
