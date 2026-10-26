/**
 * Running a notebook's steps (docs/notebooks.md § Steps). The notebook works
 * on one step at a time: its agent runs with that step's job in its inputs,
 * what it found is filed, and the step's goal is checked (stepProgress, no
 * model). Short of the goal, it runs again with what's still missing, up to
 * MAX_TRIES times, and stops early when a run gets it no closer. Then it
 * pauses: a met step waits for Continue, and a stuck one says what's missing
 * and offers Move on (keep what it found) and Try again; Move on first when
 * its agent got no further. sua says so in the notebook's conversation, with the
 * button as a card. The agent is never edited for a step.
 */
import { stepWhy, perItemWhy, type StepTry } from './notebook-step-why.js';
import { randomUUID } from 'node:crypto';
import { NotebookStore, sourceJobs, stepProgress, type Agent, type InboxActionMeta, type Notebook, type NotebookStep, type NotebookStepProgress } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { writeBriefing } from './notebook-write.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { publishInboxChanged, publishInboxEvent } from '../routes/inbox-shared.js';
import { keep, passNote, perItemInputs, pipelineInputs, readItemAnswer } from './notebook-pipeline.js';
import { notebookThread } from './notebook-chat.js';
import { reconcileStepCards } from './notebook-step-queue.js';
import { learnAbout } from './notebook-profile.js';
import { decideNotebookPage, pageIsItsOwn } from './notebook-page.js';
import { NOTEBOOK_CHECKER_ID, NOTEBOOK_FIND_ONE_ID, NOTEBOOK_FINDER_ID, NOTEBOOK_RESEARCHER_ID, NOTEBOOK_WRITER_ID, stepAgentHelpers, suaStepAgent, suaStepAgentName } from './notebook-step-agents.js';

export { NOTEBOOK_CHECKER_ID, NOTEBOOK_FIND_ONE_ID, NOTEBOOK_FINDER_ID, suaStepAgent, suaStepAgentName };

type Ctx = ReturnType<typeof getContext>;

/** Runs per press, toward one step's goal. */
export const MAX_TRIES = 3;
/** The checker's inputs, for a test's stand-in. */
const CHECKER_INPUTS = { NOTEBOOK: {}, CHECKS: {}, OPTIONS: {} } as unknown as Agent['inputs'];
/** The finder's inputs, for a test's stand-in. */
const FINDER_INPUTS = { NOTEBOOK: {}, OPTIONS: {}, FIELDS: {} } as unknown as Agent['inputs'];


/** The route-handled action behind a step's Continue / Try again card. */
export const NOTEBOOK_STEP_ACTION = 'notebook-step';

/** The step being worked on: the first that isn't done. */
export function currentStep(nb: Pick<Notebook, 'steps'>): NotebookStep | undefined {
  return nb.steps?.find((s) => s.status !== 'done');
}

/** Whether the notebook still has steps to do (else Run runs its pipeline, as before). */
export function hasOpenSteps(nb: Pick<Notebook, 'steps'>): boolean {
  return !!currentStep(nb);
}

/** A step you do yourself (no agent): narrowing the list, or deciding. */
export function isYourStep(step: Pick<NotebookStep, 'kind'>): boolean {
  return step.kind === 'decide' || step.kind === 'narrow';
}

/** The header button a step of yours is done with. */
export function yourStepButton(step: Pick<NotebookStep, 'kind'>): string {
  return step.kind === 'narrow' ? 'Narrow' : 'Decide';
}

/** "This step is yours: …", for a step of yours. */
function yoursReason(step: Pick<NotebookStep, 'kind'>): string {
  return step.kind === 'narrow' ? 'This step is yours: keep the ones that stay in the running with Narrow.' : 'This step is yours: pick the final set with Decide.';
}

/** "8 of 10 found" — a step's progress in a few words. */
export function progressWords(step: Pick<NotebookStep, 'kind'> & { shape?: NotebookStep['shape'] }, p: Pick<NotebookStepProgress, 'have' | 'want'>): string {
  if (step.kind === 'write' && step.shape === 'answer') return p.have ? 'answer written' : 'no answer yet';
  if (step.kind === 'find') return p.have > p.want ? `${String(p.have)} found, goal ${String(p.want)}` : `${String(p.have)} of ${String(p.want)} found`;
  const unit = step.kind === 'profile' ? 'facts learned' : step.kind === 'write' ? 'points written' : step.kind === 'source' ? 'facts sourced' : step.kind === 'check' ? 'checked' : step.kind === 'narrow' ? 'kept' : 'chosen';
  return `${String(p.have)} of ${String(p.want)} ${unit}`;
}

const stores = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());

/**
 * When steps are set up, the work already in the notebook counts: steps whose
 * goal is met are marked done, in order, up to the first that isn't (a find
 * step on a notebook that already has its companies, say). That's where Next
 * step starts. A decide step is never done for you; a running step is left
 * alone. Returns what was marked done and, when any was, what sua says about it.
 */
export function confirmDoneSteps(ctx: Ctx, notebookId: string): { done: NotebookStep[]; words?: string } {
  const store = stores(ctx);
  let nb = store.get(notebookId);
  if (!nb?.steps?.length) return { done: [] };
  const entries = store.entries(nb.id, 1000);
  const done: Array<{ step: NotebookStep; words: string }> = [];
  let next: { step: NotebookStep; words?: string } | undefined;
  for (const step of nb.steps) {
    if (step.status === 'done') continue;
    if (step.status === 'running') break;
    if (isYourStep(step)) { next = { step }; break; }
    const p = stepProgress(nb, entries, step);
    const words = progressWords(step, p);
    if (!p.met) {
      nb = store.updateStep(nb.id, step.id, { note: words });
      next = { step, words };
      break;
    }
    nb = store.updateStep(nb.id, step.id, { status: 'done', note: `${words}, already` });
    done.push({ step, words });
  }
  if (!done.length) return { done: [] };
  const n = (s: NotebookStep) => String(nb!.steps!.findIndex((x) => x.id === s.id) + 1);
  const was = done.map((d) => `step ${n(d.step)}, **${d.step.title}** (${d.words})`).join('; ');
  const then = next
    ? isYourStep(next.step)
      ? ` Next is **${next.step.title}**, with ${yourStepButton(next.step)}.`
      : ` Next is step ${n(next.step)}, **${next.step.title}** (${next.words ?? 'not started'}).`
    : ' That was every step.';
  return { done: done.map((d) => d.step), words: `The notebook already has what ${done.length === 1 ? 'this step needs' : 'these steps need'}, so ${done.length === 1 ? 'it’s' : 'they’re'} done: ${was}.${then}` };
}

/**
 * A step's news goes to the notebook's one conversation even when you've
 * dismissed or resolved it (or Today cleared it): put it back where you'll
 * see it, waiting on you, as your own message from the notebook already does.
 * An open thread keeps its status (sua may be mid-turn on it).
 */
function reopenForStepNews(ctx: Ctx, threadId: string): void {
  const cur = ctx.inboxStore?.get(threadId);
  if (!cur || (cur.status !== 'resolved' && cur.status !== 'dismissed')) return;
  ctx.inboxStore!.updateStatus(threadId, 'awaiting_user');
  publishInboxChanged(ctx, threadId, 'awaiting_user');
}

/** confirmDoneSteps, said in the notebook's conversation when any step was already done. */
export function confirmDoneStepsAndSay(ctx: Ctx, notebookId: string): { done: NotebookStep[]; words?: string } {
  const out = confirmDoneSteps(ctx, notebookId);
  const nb = out.words ? stores(ctx).get(notebookId) : undefined;
  const threadId = nb && ctx.inboxStore ? notebookThread(ctx, nb) : undefined;
  if (threadId && out.words) {
    const msg = ctx.inboxStore!.addResponse(threadId, 'triage', out.words);
    publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
    reopenForStepNews(ctx, threadId);
  }
  // New steps: cards for the old ones go, and the current one gets its card.
  reconcileStepCards(ctx, notebookId);
  return out;
}

/**
 * Work on the notebook's current step. A step whose goal is met is marked
 * done first and the next one starts (that's Continue); `stepId`, when given,
 * must still be the one it would act on, so a stale card does nothing.
 * Runs in the background; returns at once.
 */
export function startNotebookStep(ctx: Ctx, notebookId: string, opts: { stepId?: string; expect?: NotebookStep['status'] } = {}): { started: boolean; reason?: string; step?: NotebookStep; note?: string } {
  const store = stores(ctx);
  let nb = store.get(notebookId);
  if (!nb) return { started: false, reason: 'No such notebook.' };
  if (nb.status !== 'active') return { started: false, reason: 'Reopen the notebook to work on its steps.' };
  ctx.notebookPipelines ??= new Map();
  if (ctx.notebookPipelines.has(notebookId)) return { started: false, reason: 'It’s already running.' };
  let step = currentStep(nb);
  if (!step) return { started: false, reason: 'All its steps are done.' };
  if ((opts.stepId && opts.stepId !== step.id) || (opts.expect && opts.expect !== step.status)) return { started: false, reason: 'It has already moved on from that step.' };
  // Continue: the met step is done and the next one starts. A next step that
  // can't start (no checks, an agent that can't do it) leaves the met one as
  // it is, so nothing moves on without saying why; one that's yours, or none
  // left, is where it ends.
  const met = step.status === 'met' ? step : undefined;
  if (met) {
    const after = (nb.steps ?? []).slice((nb.steps ?? []).indexOf(met) + 1).find((s) => s.status !== 'done');
    if (!after || isYourStep(after)) {
      nb = store.updateStep(nb.id, met.id, { status: 'done' });
      return after ? { started: false, reason: yoursReason(after), step: after } : { started: false, reason: 'All its steps are done.' };
    }
    step = after;
  }
  if (isYourStep(step)) return { started: false, reason: yoursReason(step), step };
  if (step.kind === 'check' && nb.checks.length === 0) return { started: false, reason: 'The notebook has no checks yet. Add them under Edit, or tell sua what to check.', step };
  const resolved = stepAgent(ctx, step, nb.id);
  if (!resolved.agentId) return { started: false, reason: resolved.reason, step };
  if (met) nb = store.updateStep(nb.id, met.id, { status: 'done' });
  // Its agent came off (sua's does it): the step as it is now.
  if (resolved.note) { nb = store.get(nb.id)!; step = nb.steps?.find((x) => x.id === step!.id) ?? step; }
  const agentId = resolved.agentId;
  const index = (nb.steps ?? []).findIndex((s) => s.id === step.id);
  ctx.notebookPipelines.set(notebookId, { agentId, step: index + 1, of: nb.steps!.length, startedAt: Date.now() });
  store.updateStep(nb.id, step.id, { status: 'running' });
  const s = step;
  void runStep(ctx, store, nb.id, s, agentId).catch((err: unknown) => {
    try { store.updateStep(notebookId, s.id, { status: 'stuck', note: err instanceof Error ? err.message.slice(0, 160) : 'It failed.' }); } catch { /* the notebook is gone */ }
  }).finally(() => {
    ctx.notebookPipelines?.delete(notebookId);
    // It paused: its card is the one waiting (an earlier round's that asks the same goes).
    reconcileStepCards(ctx, notebookId);
  });
  return { started: true, step, ...(resolved.note ? { note: resolved.note } : {}) };
}

/**
 * The agent a step runs: its own, or for a check or find step without one,
 * sua's (the checker, the finder; installed or updated now). A reason when
 * there's none it can run.
 */
function stepAgent(ctx: Ctx, step: NotebookStep, notebookId?: string): { agentId?: string; reason?: string; note?: string } {
  // Its own agent reads one item's page a run, which can't find or check:
  // sua's finder or checker does it instead, and the step says so from now on.
  const misfit = misfitStepAgent(ctx, step);
  if (misfit) {
    const sua = stepAgent(ctx, { ...step, agentId: undefined });
    if (!sua.agentId) return sua;
    if (notebookId) stores(ctx).updateStep(notebookId, step.id, { agentId: undefined });
    return { ...sua, note: misfitWords(step, misfit) };
  }
  const agentId = step.agentId ?? suaStepAgent(step.kind);
  const sua = agentId === NOTEBOOK_CHECKER_ID || agentId === NOTEBOOK_FINDER_ID || agentId === NOTEBOOK_RESEARCHER_ID || agentId === NOTEBOOK_WRITER_ID;
  const fake = agentId === NOTEBOOK_CHECKER_ID ? ctx.notebookCheckerRun : agentId === NOTEBOOK_FINDER_ID ? ctx.notebookFinderRun : agentId === NOTEBOOK_RESEARCHER_ID ? ctx.notebookResearchRun : agentId === NOTEBOOK_WRITER_ID ? ctx.notebookWriterRun : undefined;
  if (sua && !fake && !(ensureSystemAgentCurrent(ctx, agentId, `a notebook ${step.kind} step`)
    && stepAgentHelpers(agentId).every((id) => ensureSystemAgentCurrent(ctx, id, `a notebook ${step.kind} step`)))) {
    return { reason: `${suaStepAgentName(step.kind) ?? 'sua’s agent'} isn’t available.` };
  }
  const agent = agentId ? ctx.agentStore.getAgent(agentId) : undefined;
  if (!agentId || ((!agent || agent.status === 'archived') && !(sua && fake))) {
    return { reason: agentId ? `Its agent, ${agentId}, isn't installed.` : 'This step needs an agent. Ask sua to pick or build one.' };
  }
  // An agent that reads one item's page a run can only source facts: as a
  // find or check step it would run with no page and say nothing.
  if (agent && step.kind !== 'source' && perItemInputs(agent)) {
    return { reason: `${agentId} reads one item's own page at a time, so it can't do a ${step.kind} step. ${step.kind === 'check' ? 'Pick sua’s checker for it under Edit' : step.kind === 'find' ? 'Pick sua’s finder for it under Edit' : 'Pick another agent under Edit'}, or use ${agentId} in a source step.` };
  }
  return { agentId };
}

/**
 * A step's own agent that can't do it: one that reads one item's own page a
 * run (listing-page-facts) given a find or check step, which have no page to
 * read. sua's finder or checker does those. Undefined when it fits.
 */
function misfitStepAgent(ctx: Ctx, step: Pick<NotebookStep, 'kind' | 'agentId'>): string | undefined {
  if (!step.agentId || !suaStepAgent(step.kind)) return undefined;
  const agent = ctx.agentStore.getAgent(step.agentId);
  return agent && perItemInputs(agent) ? step.agentId : undefined;
}

function misfitWords(step: Pick<NotebookStep, 'kind' | 'title'>, agentId: string): string {
  return `${suaStepAgentName(step.kind)!.replace(/^s/, 'S')} does “${step.title}”: ${agentId} reads one item's own page at a time, so it can only do a source step.`;
}

/**
 * Steps about to be saved (from Edit, the steps card, a draft or the
 * drafter), with any agent that can't do its step taken off it, so sua's
 * finder or checker does it; and what was changed, in words.
 */
export function fitStepAgents<T>(ctx: Ctx, steps: readonly T[]): { steps: T[]; notes: string[] } {
  const notes: string[] = [];
  const out = steps.map((x) => {
    if (!x || typeof x !== 'object') return x;
    const o = x as unknown as { kind?: NotebookStep['kind']; title?: string; agentId?: string; agent?: string };
    const agentId = o.agentId ?? o.agent;
    const misfit = o.kind ? misfitStepAgent(ctx, { kind: o.kind, agentId }) : undefined;
    if (!misfit) return x;
    notes.push(misfitWords({ kind: o.kind!, title: o.title ?? 'that step' }, misfit));
    const { agentId: _a, agent: _b, ...rest } = o;
    return rest as unknown as T;
  });
  return { steps: out, notes };
}

/**
 * Search again: a find step that's already met or done runs its agent once
 * more for new options ("re-run the search", "any new ones?"), as many again
 * as its goal. What it finds is filed like any run; the steps stay where
 * they are (a later step isn't undone), and sua says in the conversation
 * how many are new. A find step that isn't met yet just runs (Try again).
 * `stepId` is the step's id or title; without it, the first find step.
 */
export function searchAgain(ctx: Ctx, notebookId: string, opts: { stepId?: string } = {}): { started: boolean; reason?: string; step?: NotebookStep } {
  const store = stores(ctx);
  const nb = store.get(notebookId);
  if (!nb) return { started: false, reason: 'No such notebook.' };
  if (nb.status !== 'active') return { started: false, reason: 'Reopen the notebook to search again.' };
  if (ctx.notebookPipelines?.has(notebookId)) return { started: false, reason: 'It’s already running.' };
  const want = opts.stepId?.trim().toLowerCase();
  const step = want
    ? nb.steps?.find((s) => s.id === opts.stepId || s.title.toLowerCase() === want)
    : nb.steps?.find((s) => s.kind === 'find');
  if (!step) return { started: false, reason: want ? 'The notebook has no such step.' : 'The notebook has no find step to run again.' };
  if (step.kind !== 'find' && step.kind !== 'profile' && step.kind !== 'write') return { started: false, reason: `${step.title} isn't a find step, so there's nothing to search again.`, step };
  // Not there yet: that's the step's own run.
  if (step === currentStep(nb) && step.status !== 'met') return startNotebookStep(ctx, nb.id, { stepId: step.id });
  // Write again: the talking points once more, from what the notebook has now, leaving the steps where they are.
  if (step.kind === 'write') {
    const writer = stepAgent(ctx, step, nb.id);
    if (!writer.agentId) return { started: false, reason: writer.reason, step };
    const index = (nb.steps ?? []).findIndex((s) => s.id === step.id);
    ctx.notebookPipelines ??= new Map();
    ctx.notebookPipelines.set(notebookId, { agentId: NOTEBOOK_WRITER_ID, step: index + 1, of: nb.steps!.length, startedAt: Date.now(), again: true });
    void writeBriefing(ctx, store, nb.id, step).then((said) => { store.noteRun(notebookId, `${step.title}, again: ${said.join('; ')}`); }).catch(() => undefined).finally(() => {
      ctx.notebookPipelines?.delete(notebookId);
      reconcileStepCards(ctx, notebookId);
    });
    return { started: true, step };
  }
  // Look again: learn about them once more (new facts, a photo that's clearly them), leaving the steps where they are.
  if (step.kind === 'profile') {
    const index = (nb.steps ?? []).findIndex((s) => s.id === step.id);
    ctx.notebookPipelines ??= new Map();
    ctx.notebookPipelines.set(notebookId, { agentId: NOTEBOOK_RESEARCHER_ID, step: index + 1, of: nb.steps!.length, startedAt: Date.now(), again: true });
    void lookAgain(ctx, store, nb.id, step).catch((err: unknown) => {
      try { store.noteRun(notebookId, `${step.title}, again: ${err instanceof Error ? err.message.slice(0, 160) : 'it failed'}`); } catch { /* the notebook is gone */ }
    }).finally(() => {
      ctx.notebookPipelines?.delete(notebookId);
      reconcileStepCards(ctx, notebookId);
    });
    return { started: true, step };
  }
  const resolved = stepAgent(ctx, step, nb.id);
  if (!resolved.agentId) return { started: false, reason: resolved.reason, step };
  const index = (nb.steps ?? []).findIndex((s) => s.id === step.id);
  ctx.notebookPipelines ??= new Map();
  ctx.notebookPipelines.set(notebookId, { agentId: resolved.agentId, step: index + 1, of: nb.steps!.length, startedAt: Date.now(), again: true });
  const agentId = resolved.agentId;
  void runAgain(ctx, store, nb.id, step, agentId).catch((err: unknown) => {
    try { store.noteRun(notebookId, `${step.title}, again: ${err instanceof Error ? err.message.slice(0, 160) : 'it failed'}`); } catch { /* the notebook is gone */ }
  }).finally(() => {
    ctx.notebookPipelines?.delete(notebookId);
    // It paused: its card is the one waiting (an earlier round's that asks the same goes).
    reconcileStepCards(ctx, notebookId);
  });
  return { started: true, step };
}

/** A done profile step, once more: what it learned this time, said in the conversation. */
async function lookAgain(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep): Promise<void> {
  const notes = await learnAbout(ctx, store, notebookId, step);
  const words = notes.length ? `Looked again (**${step.title}**): ${notes.join('; ')}.` : `Looked again (**${step.title}**): sua's researcher didn't answer. Nothing changed.`;
  store.noteRun(notebookId, `${step.title}, again: ${words.replace(/\*\*/g, '')}`);
  const nb = store.get(notebookId);
  const threadId = nb && ctx.inboxStore ? notebookThread(ctx, nb) : undefined;
  if (threadId) {
    const msg = ctx.inboxStore!.addResponse(threadId, 'triage', words);
    publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
    reopenForStepNews(ctx, threadId);
  }
}

/** One more run of a met or done find step's agent, for as many new ones as its goal; then say what's new. */
async function runAgain(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep, agentId: string): Promise<void> {
  let nb = store.get(notebookId)!;
  const had = new Set(store.entries(nb.id, 1000).filter((e) => e.kind === 'option').map((e) => e.id));
  const p = stepProgress(nb, store.entries(nb.id, 1000), step);
  const passId = store.startPass(nb.id, 'pipeline');
  const running = ctx.notebookPipelines?.get(notebookId);
  const entries = store.entries(nb.id, 1000);
  const run = await runAgent(ctx, agentId, (a) => pipelineInputs(a, nb, entries, { step, want: p.have + p.want, have: p.have, missing: [] }), (runId) => { if (running) running.runId = runId; });
  store.addRunToPass(passId, run.id);
  let words: string;
  if (run.status === 'cancelled' || running?.stopped) {
    store.finishPass(passId, `${agentId}: stopped`);
    words = `You stopped the new search for **${step.title}**.`;
  } else if (run.status !== 'completed') {
    const why = `${agentId}: ${run.status}${run.error ? ` (${run.error.slice(0, 80)})` : ''}`;
    store.finishPass(passId, why);
    words = `The new search for **${step.title}** didn't finish (${why}). Nothing in the notebook changed.`;
  } else {
    const out = await keep(ctx, store, nb, agentId, run.id, run.result ?? '');
    const short = shortSteps(ctx.runStore.listNodeExecutions(run.id));
    store.finishPass(passId, `${passNote(agentId, out)}${short ? ` (${short})` : ''}`);
    nb = store.get(notebookId)!;
    const fresh = store.entries(nb.id, 1000).filter((e) => e.kind === 'option' && !had.has(e.id));
    const names = fresh.slice(0, 6).map((e) => `- ${e.title}`).join('\n');
    words = fresh.length
      ? `Searched again (**${step.title}**, with ${agentId}): ${String(fresh.length)} new ${fresh.length === 1 ? 'option' : 'options'} in the notebook:\n${names}${fresh.length > 6 ? `\n- and ${String(fresh.length - 6)} more` : ''}`
      : `Searched again (**${step.title}**, with ${agentId}): nothing new${out.refreshed ? `; ${String(out.refreshed)} it already has turned up again` : ''}.`;
    if (short) words += ` Part of the search didn't finish: ${short}.`;
  }
  store.noteRun(notebookId, `${step.title}, again: ${words.split('\n')[0].replace(/\*\*/g, '')}`);
  const threadId = ctx.inboxStore ? notebookThread(ctx, nb) : undefined;
  if (threadId) {
    const msg = ctx.inboxStore!.addResponse(threadId, 'triage', words);
    publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
    reopenForStepNews(ctx, threadId);
  }
}

/** Run a step's agent to the end (a test's stand-in for the checker answers at once). */
async function runAgent(ctx: Ctx, agentId: string, inputs: (agent: Pick<Agent, 'inputs'>) => Record<string, string>, onRunId?: (runId: string) => void): Promise<{ id: string; status: string; result?: string; error?: string }> {
  const fake = agentId === NOTEBOOK_CHECKER_ID ? ctx.notebookCheckerRun : agentId === NOTEBOOK_FINDER_ID ? ctx.notebookFinderRun : undefined;
  if (fake) {
    const result = await fake(inputs({ inputs: agentId === NOTEBOOK_CHECKER_ID ? CHECKER_INPUTS : FINDER_INPUTS }));
    return { id: randomUUID(), status: result ? 'completed' : 'failed', ...(result ? { result } : { error: 'no answer' }) };
  }
  const agent = ctx.agentStore.getAgent(agentId)!;
  const run = await runDispatchedAgentToTerminal(ctx, agent, inputs(agent), onRunId);
  return { id: run.id, status: run.status, ...(run.result ? { result: run.result } : {}), ...(run.error ? { error: run.error } : {}) };
}

async function runStep(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep, agentId: string): Promise<void> {
  const agent = { id: agentId };
  const notes: string[] = [];
  let nb = store.get(notebookId)!;
  let before = stepProgress(nb, store.entries(nb.id, 1000), step);
  // Already there (a search earlier found enough): no run needed. A profile step runs whenever it's started (to learn more, or find their photo).
  if (before.met && step.kind !== 'profile' && step.kind !== 'write') return finish(ctx, store, notebookId, step, before, ['its goal was already met']);
  // A write step: sua's writer writes the talking points from what the notebook has (lib/notebook-write.ts); like a profile step, it runs whenever it's started (to write them again).
  if (step.kind === 'write') {
    const tries = step.tries + 1;
    const wrote = await writeBriefing(ctx, store, notebookId, step);
    nb = store.get(notebookId)!;
    const now = stepProgress(nb, store.entries(nb.id, 1000), step);
    store.updateStep(nb.id, step.id, { tries, note: progressWords(step, now) });
    return finish(ctx, store, notebookId, { ...step, tries }, now, wrote, !now.met, sentenceOf(wrote));
  }
  // A profile step: sua's researcher learns about who the notebook is about (lib/notebook-profile.ts).
  if (step.kind === 'profile') {
    const tries = step.tries + 1;
    const learned = await learnAbout(ctx, store, notebookId, step);
    nb = store.get(notebookId)!;
    const now = stepProgress(nb, store.entries(nb.id, 1000), step);
    store.updateStep(nb.id, step.id, { tries, note: progressWords(step, now) });
    return finish(ctx, store, notebookId, { ...step, tries }, now, learned, now.have <= before.have, sentenceOf(learned));
  }
  // A source step whose agent reads one item's page a run: once per option.
  const installed = ctx.agentStore.getAgent(agentId);
  const perItem = step.kind === 'source' && installed ? perItemInputs(installed) : undefined;
  if (perItem) return runPerItem(ctx, store, notebookId, step, agentId, perItem, before);
  let tries = step.tries;
  // Whether any run this press got it closer: none did (they found nothing
  // new, failed, or you stopped one) means its agent may not be able to.
  let gained = false;
  let stopped = false;
  let last: StepTry | undefined;
  // Its last try got it no closer (else it ran out of tries this press while still getting closer).
  let noCloser = false;
  for (let i = 0; i < MAX_TRIES; i++) {
    tries++;
    const passId = store.startPass(nb.id, 'pipeline');
    const entries = store.entries(nb.id, 1000);
    // Stop (the header's, while it runs) reaches this run through its id.
    const running = ctx.notebookPipelines?.get(notebookId);
    const run = await runAgent(ctx, agentId, (a) => pipelineInputs(a, nb, entries, { step, want: before.want, have: before.have, missing: before.missing }), (runId) => { if (running) running.runId = runId; });
    store.addRunToPass(passId, run.id);
    // You stopped it: the step stops too, rather than starting another try.
    if (run.status === 'cancelled' || running?.stopped) {
      store.finishPass(passId, `${agent.id}: stopped`);
      notes.push('you stopped it');
      store.updateStep(nb.id, step.id, { tries });
      stopped = true;
      last = { status: 'stopped' };
      break;
    }
    if (run.status !== 'completed') {
      const why = `${agent.id}: ${run.status}${run.error ? ` (${run.error.slice(0, 80)})` : ''}`;
      store.finishPass(passId, why);
      notes.push(why);
      store.updateStep(nb.id, step.id, { tries });
      last = { status: 'failed', error: run.error ?? run.status };
      continue;
    }
    const out = await keep(ctx, store, nb, agent.id, run.id, run.result ?? '');
    // A run can complete with some of its own steps unfinished (optional ones) or cut short: say so.
    const short = shortSteps(ctx.runStore.listNodeExecutions(run.id));
    const note = `${passNote(agent.id, out)}${short ? ` (${short})` : ''}`;
    store.finishPass(passId, note);
    notes.push(note);
    last = { status: 'completed', out, ...(short ? { short } : {}) };
    nb = store.get(notebookId)!;
    const now = stepProgress(nb, store.entries(nb.id, 1000), step);
    store.updateStep(nb.id, step.id, { tries, note: progressWords(step, now) });
    if (now.met) return finish(ctx, store, notebookId, { ...step, tries }, now, notes);
    // A run that got it no closer: another try with the same job won't either.
    // Closer: more done, or anything still needed changed (a fact found, a check ticked, an option ruled out).
    const closer = now.have > before.have || now.missing.join('\n') !== before.missing.join('\n');
    before = now;
    if (!closer) { noCloser = true; break; }
    gained = true;
  }
  // You stopped it, or no run got it closer: Move on comes first.
  const stalled = stopped || !gained;
  return finish(ctx, store, notebookId, { ...step, tries }, before, notes, stalled, stepWhy(step, last, { stalled: noCloser || last?.status !== 'completed', tries }));
}

/** At most this many pages a press: the step can be pressed again for the rest. */
const PER_ITEM_MAX = 8;

/**
 * A source step with an agent that reads one item's own page a run
 * (listing-page-facts): run it once per option still missing facts, with
 * that option's page and the facts it lacks, and file what each page said
 * on that option (sourced to the page). A page that says the item is gone
 * rules the option out; one that blocks the reader is said so. Options
 * without a page of their own are skipped, so the agent never runs on an
 * empty address.
 */
async function runPerItem(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep, agentId: string, io: { page: string; want?: string }, before: NotebookStepProgress): Promise<void> {
  let nb = store.get(notebookId)!;
  const jobs = sourceJobs(nb, store.entries(nb.id, 1000), step);
  const withPage = jobs.filter((j) => j.link).slice(0, PER_ITEM_MAX);
  const noPage = jobs.filter((j) => !j.link).length;
  const tries = step.tries + 1;
  if (!withPage.length) {
    return finish(ctx, store, notebookId, { ...step, tries }, before, [`${agentId} reads an option's own page, and none of the options missing facts has one`], true, "Its agent reads each option's own page, and none of the options still missing facts has one.");
  }
  const passId = store.startPass(nb.id, 'pipeline');
  const running = ctx.notebookPipelines?.get(notebookId);
  let factsSet = 0;
  let read = 0;
  let stopped = false;
  const blocked = new Set<string>();
  const gone: string[] = [];
  const failed: string[] = [];
  for (const job of withPage) {
    if (running?.stopped) { stopped = true; break; }
    const run = await runAgent(ctx, agentId, () => ({ [io.page]: job.link!, ...(io.want ? { [io.want]: job.missing.map((f) => f.label).join(', ') } : {}) }), (runId) => { if (running) running.runId = runId; });
    store.addRunToPass(passId, run.id);
    if (run.status === 'cancelled' || running?.stopped) { stopped = true; break; }
    if (run.status !== 'completed') { failed.push(job.name); continue; }
    nb = store.get(notebookId)!;
    const answer = readItemAnswer(run.result ?? '', nb.fields);
    if (answer.status === 'blocked') { blocked.add(hostOf(job.link!)); continue; }
    read++;
    if (answer.status === 'gone') {
      store.ruleOut(nb.id, job.entryId, 'Its page says it is gone (sold, expired or removed).', `agent:${agentId}`, { gone: true });
      gone.push(job.name);
      continue;
    }
    const facts = Object.fromEntries(Object.entries(answer.facts).map(([k, v]) => [k, { value: v, source: job.link }]));
    if (Object.keys(facts).length) {
      store.setOptionFacts(nb.id, job.entryId, facts);
      factsSet += Object.keys(facts).length;
    }
  }
  const words = [
    `${agentId}: read ${String(read)} of ${String(withPage.length)} page${withPage.length === 1 ? '' : 's'}, ${String(factsSet)} fact${factsSet === 1 ? '' : 's'}`,
    ...(blocked.size ? [`${[...blocked].join(', ')} blocked the reader`] : []),
    ...(gone.length ? [`${String(gone.length)} gone, ruled out`] : []),
    ...(failed.length ? [`${String(failed.length)} run${failed.length === 1 ? '' : 's'} failed`] : []),
    ...(noPage ? [`${String(noPage)} without a page of their own`] : []),
    ...(stopped ? ['you stopped it'] : []),
  ].join('; ');
  store.finishPass(passId, words);
  nb = store.get(notebookId)!;
  const now = stepProgress(nb, store.entries(nb.id, 1000), step);
  store.updateStep(nb.id, step.id, { tries, note: progressWords(step, now) });
  if (now.met) return finish(ctx, store, notebookId, { ...step, tries }, now, [words]);
  // Nothing got closer (every page blocked, or nothing new on them): Move on comes first.
  const closer = now.have > before.have || gone.length > 0;
  return finish(ctx, store, notebookId, { ...step, tries }, now, [words], stopped || !closer, perItemWhy({ read, pages: withPage.length, factsSet, blocked: [...blocked], failed: failed.length, noPage, stopped }));
}

/** A profile or write step's notes, as the sentence that says why it came out short. */
function sentenceOf(notes: readonly string[]): string | undefined {
  const s = notes.join('; ').replace(/\s+/g, ' ').trim();
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}.` : undefined;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/**
 * What a completed run's own steps didn't do: "gather-main didn't finish (out
 * of turns); gather-counter ran out of turns and answered from part of its
 * research". Undefined when every step ran in full.
 */
export function shortSteps(execs: ReadonlyArray<{ nodeId: string; status: string; error?: string | null }>): string | undefined {
  const why = (error?: string | null) => /max_turns|maximum number of turns/i.test(error ?? '') ? 'out of turns' : /timed? ?out/i.test(error ?? '') ? 'timed out' : 'failed';
  const parts = [
    ...execs.filter((e) => e.status === 'failed').map((e) => `${e.nodeId} didn't finish (${why(e.error)})`),
    ...execs.filter((e) => e.status === 'completed' && /^Ran out of turns/.test(e.error ?? '')).map((e) => `${e.nodeId} ran out of turns and answered from part of its research`),
  ];
  return parts.length ? parts.join('; ') : undefined;
}

/** Mark the step met or stuck, note the run, and say so in the conversation with the next button. */
function finish(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep, p: NotebookStepProgress, notes: readonly string[], stalled = false, why?: string): void {
  const words = progressWords(step, p);
  const nb = store.updateStep(notebookId, step.id, { status: p.met ? 'met' : 'stuck', note: words, tries: step.tries, ...(!p.met && stalled ? { stalled: true } : {}), ...(!p.met && why ? { why } : {}) });
  store.noteRun(notebookId, `${step.title}: ${words}${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
  postStepCard(ctx, nb, step.id, p);
  if (p.met && nb.steps?.[0]?.id === step.id) void pageAfterFirstStep(ctx, store, notebookId);
}

/**
 * Its first step reached its goal: the notebook knows more than when it
 * picked its page (who it's about, its first options), so it decides again,
 * unless you changed the page (ADR-0058). A new page is said in its conversation.
 */
async function pageAfterFirstStep(ctx: Ctx, store: NotebookStore, notebookId: string): Promise<void> {
  const nb = store.get(notebookId);
  if (!nb || !pageIsItsOwn(nb)) return;
  const was = JSON.stringify(nb.layout ?? null);
  const outcome = await decideNotebookPage(ctx, notebookId, { again: true }).catch(() => 'failed' as const);
  const now = store.get(notebookId);
  if (outcome !== 'drawn' || !now?.layout || JSON.stringify(now.layout) === was || !ctx.inboxStore) return;
  const threadId = notebookThread(ctx, now);
  if (!threadId) return;
  const msg = ctx.inboxStore.addResponse(threadId, 'triage', `Now that it knows more, I redrew its page: ${now.layout.about ?? 'one that fits what it found'}. Undo puts the old one back, on **Edit**.`);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
  store.touch(notebookId);
}

/**
 * sua's message about a step that paused, with its cards: Continue to the
 * next step (or Decide, when that's next); or, short of its goal, Move on
 * (keep what it found and go on) and Try again. A step whose agent got no
 * further puts Move on first; one still getting closer, Try again.
 */
export function postStepCard(ctx: Ctx, nb: Notebook, stepId: string, p: NotebookStepProgress): string | undefined {
  const inbox = ctx.inboxStore;
  const steps = nb.steps ?? [];
  const i = steps.findIndex((s) => s.id === stepId);
  const step = steps[i];
  if (!inbox || !step) return undefined;
  const threadId = notebookThread(ctx, nb);
  if (!threadId) return undefined;
  const next = steps.slice(i + 1).find((s) => s.status !== 'done');
  const words = progressWords(step, p);
  const missing = `${p.missing.slice(0, 6).map((m) => `- ${m}`).join('\n')}${p.missing.length > 6 ? `\n- and ${String(p.missing.length - 6)} more` : ''}`;
  const stalled = !p.met && !!step.stalled;
  const onward = next ? `goes on to **${next.title}**` : 'finishes';
  const body = p.met
    ? `Step ${String(i + 1)} of ${String(steps.length)} is done: **${step.title}** (${words}).${next ? ` Next is **${next.title}**${next.agentId ? `, with ${next.agentId}` : ''}.` : ' That was the last step.'}`
    : stalled
      ? `**${step.title}** couldn't get any further (${words}). ${step.why ?? 'Its last run found nothing new.'} Its agent may not be able to do the rest. Still needed:\n${missing}\n\n**Move on** keeps what it found and ${onward}. **Try again** runs it once more. Or tell me what to do differently, for example a different agent for this step.`
      : `**${step.title}** stopped short after ${String(step.tries)} ${step.tries === 1 ? 'try' : 'tries'} (${words})${step.why && !/^It was still getting closer/.test(step.why) ? `. ${step.why}` : ', still getting closer.'} Still needed:\n${missing}\n\n**Try again** keeps going. **Move on** keeps what it found and ${onward}.`;
  const msg = inbox.addResponse(threadId, 'triage', body);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
  reopenForStepNews(ctx, threadId);
  const ids = stepCards(nb, step.id, p).map((action) => addStepCard(ctx, threadId, action));
  return ids[0] ?? msg.id;
}

/** Put one step card in the thread (proposed, waiting on you). */
export function addStepCard(ctx: Ctx, threadId: string, action: InboxActionMeta): string {
  const c = ctx.inboxStore!.addResponse(threadId, 'action', action.rationale!, JSON.stringify(action));
  publishInboxEvent(ctx, threadId, 'action:created', { responseId: c.id, agentId: action.agentId, rationale: action.rationale, inputs: action.inputs, createdAt: c.createdAt });
  return c.id;
}

/**
 * The cards a paused step offers, first button first: Continue for a met step
 * (none after the last step, or before a step of yours: that's its Narrow or
 * Decide button); Try again and Move on for a stuck one (Move on first when
 * its agent got no further); Start for one not started yet.
 */
export function stepCards(nb: Notebook, stepId: string, p: Pick<NotebookStepProgress, 'have' | 'want' | 'met'>): InboxActionMeta[] {
  const steps = nb.steps ?? [];
  const i = steps.findIndex((s) => s.id === stepId);
  const step = steps[i];
  if (!step) return [];
  // The next step still to do (one added in front leaves done ones after it): what Continue starts.
  const next = steps.slice(i + 1).find((s) => s.status !== 'done');
  const nextNo = next ? steps.indexOf(next) + 1 : 0;
  const base = { kind: 'action' as const, status: 'proposed' as const, agentId: NOTEBOOK_STEP_ACTION, effect: 'write' as const };
  if (p.met) {
    if (!next || isYourStep(next)) return [];
    return [{ ...base, inputs: { NOTEBOOK: nb.id, STEP: step.id, WAS: 'met' }, rationale: `Start step ${String(nextNo)}: ${next.title}.`, ctaLabel: 'Continue' }];
  }
  if (isYourStep(step)) return [];
  if (step.status !== 'stuck') {
    return [{ ...base, inputs: { NOTEBOOK: nb.id, STEP: step.id, WAS: step.status }, rationale: `Start step ${String(i + 1)}: ${step.title}.`, ctaLabel: 'Start' }];
  }
  const words = progressWords(step, p);
  const moveOn: InboxActionMeta = { ...base, inputs: { NOTEBOOK: nb.id, STEP: step.id, WAS: 'stuck', MOVE: '1' }, rationale: `Keep what ${step.title} found (${words}) and ${next ? `go on to ${next.title}` : 'finish'}.`, ctaLabel: 'Move on' };
  const again: InboxActionMeta = { ...base, inputs: { NOTEBOOK: nb.id, STEP: step.id, WAS: 'stuck' }, rationale: `Run ${step.title} again with what's still missing.`, ctaLabel: 'Try again' };
  return step.stalled ? [moveOn, again] : [again, moveOn];
}

/**
 * Stop the step that's running: its run is cancelled and the step stops
 * there (stuck, with Move on first), keeping what earlier runs found.
 */
export function stopNotebookStep(ctx: Ctx, notebookId: string): { stopped: boolean; reason?: string } {
  const running = ctx.notebookPipelines?.get(notebookId);
  const nb = stores(ctx).get(notebookId);
  if (!running || !nb || !(running.again || nb.steps?.some((s) => s.status === 'running'))) return { stopped: false, reason: 'No step is running.' };
  running.stopped = true;
  if (running.runId) {
    ctx.activeRuns.get(running.runId)?.abort();
    ctx.activeRuns.delete(running.runId);
    void Promise.resolve(ctx.provider?.cancelRun?.(running.runId)).catch(() => { /* the abort is enough */ });
  }
  return { stopped: true };
}

/**
 * Move on from a step short of its goal: it's done with what it found (noted
 * as moved on), and the next step starts, unless it's yours (Decide). `stepId`
 * must still be the current step, so a stale card does nothing.
 */
export function moveOnFromStep(ctx: Ctx, notebookId: string, opts: { stepId?: string } = {}): { moved: boolean; reason?: string; step?: NotebookStep; next?: ReturnType<typeof startNotebookStep> } {
  const store = stores(ctx);
  const nb = store.get(notebookId);
  if (!nb) return { moved: false, reason: 'No such notebook.' };
  if (ctx.notebookPipelines?.has(notebookId)) return { moved: false, reason: 'It’s still running. Stop its run first.' };
  const step = currentStep(nb);
  if (!step) return { moved: false, reason: 'All its steps are done.' };
  if (opts.stepId && opts.stepId !== step.id) return { moved: false, reason: 'It has already moved on from that step.' };
  if (isYourStep(step)) return { moved: false, reason: yoursReason(step) };
  const p = stepProgress(nb, store.entries(nb.id, 1000), step);
  const words = progressWords(step, p);
  const after = store.updateStep(nb.id, step.id, { status: 'done', movedOn: true, note: `${words}, moved on` });
  store.noteRun(nb.id, `${step.title}: moved on with ${words}`);
  const next = currentStep(after);
  if (!next || isYourStep(next)) return { moved: true, step };
  return { moved: true, step, next: startNotebookStep(ctx, nb.id) };
}

/** How many to focus on: the next pick or keep step's target, else 5 (never more than are in the running). */
export function topFor(nb: Notebook, running: number): number {
  const yours = nb.steps?.find((x) => isYourStep(x) && x.target);
  return Math.max(1, Math.min(running, yours?.target ?? 5));
}

/**
 * Work a source or check step again on just the best `top` options: its
 * goal becomes those, and its agent (or sua's checker) gets only them. For a
 * step you moved on from short, or one that got stuck. Starts it now.
 */
export function focusStepOnTop(ctx: Ctx, notebookId: string, stepId: string, top: number): { started: boolean; reason?: string; step?: NotebookStep } {
  const store = stores(ctx);
  const nb = store.get(notebookId);
  if (!nb) return { started: false, reason: 'No such notebook.' };
  if (ctx.notebookPipelines?.has(notebookId)) return { started: false, reason: 'It’s still running. Stop its run first.' };
  const step = nb.steps?.find((x) => x.id === stepId);
  if (!step || (step.kind !== 'source' && step.kind !== 'check')) return { started: false, reason: 'Only a source or check step can focus on the top options.' };
  if (!Number.isFinite(top) || top < 1) return { started: false, reason: 'How many?' };
  store.updateStep(nb.id, step.id, { top: Math.min(50, Math.round(top)), status: 'todo', tries: 0 });
  return startNotebookStep(ctx, nb.id, { stepId: step.id });
}

