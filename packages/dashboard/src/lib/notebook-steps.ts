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
import { randomUUID } from 'node:crypto';
import { NotebookStore, sourceJobs, stepProgress, type Agent, type InboxActionMeta, type Notebook, type NotebookStep, type NotebookStepProgress } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { publishInboxChanged, publishInboxEvent } from '../routes/inbox-shared.js';
import { keep, passNote, perItemInputs, pipelineInputs, readItemAnswer } from './notebook-pipeline.js';
import { notebookThread } from './notebook-chat.js';
import { NOTEBOOK_CHECKER_ID, NOTEBOOK_FIND_ONE_ID, NOTEBOOK_FINDER_ID, suaStepAgent, suaStepAgentName } from './notebook-step-agents.js';

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
export function progressWords(step: Pick<NotebookStep, 'kind'>, p: Pick<NotebookStepProgress, 'have' | 'want'>): string {
  if (step.kind === 'find') return p.have > p.want ? `${String(p.have)} found, goal ${String(p.want)}` : `${String(p.have)} of ${String(p.want)} found`;
  const unit = step.kind === 'source' ? 'facts sourced' : step.kind === 'check' ? 'checked' : step.kind === 'narrow' ? 'kept' : 'chosen';
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
  return out;
}

/**
 * Work on the notebook's current step. A step whose goal is met is marked
 * done first and the next one starts (that's Continue); `stepId`, when given,
 * must still be the one it would act on, so a stale card does nothing.
 * Runs in the background; returns at once.
 */
export function startNotebookStep(ctx: Ctx, notebookId: string, opts: { stepId?: string; expect?: NotebookStep['status'] } = {}): { started: boolean; reason?: string; step?: NotebookStep } {
  const store = stores(ctx);
  let nb = store.get(notebookId);
  if (!nb) return { started: false, reason: 'No such notebook.' };
  if (nb.status !== 'active') return { started: false, reason: 'Reopen the notebook to work on its steps.' };
  ctx.notebookPipelines ??= new Map();
  if (ctx.notebookPipelines.has(notebookId)) return { started: false, reason: 'It’s already running.' };
  let step = currentStep(nb);
  if (!step) return { started: false, reason: 'All its steps are done.' };
  if ((opts.stepId && opts.stepId !== step.id) || (opts.expect && opts.expect !== step.status)) return { started: false, reason: 'It has already moved on from that step.' };
  // Continue: the met step is done; the next one starts.
  if (step.status === 'met') {
    nb = store.updateStep(nb.id, step.id, { status: 'done' });
    step = currentStep(nb);
    if (!step) return { started: false, reason: 'All its steps are done.' };
  }
  if (isYourStep(step)) return { started: false, reason: yoursReason(step), step };
  if (step.kind === 'check' && nb.checks.length === 0) return { started: false, reason: 'The notebook has no checks yet. Add them under Edit, or tell sua what to check.', step };
  const resolved = stepAgent(ctx, step);
  if (!resolved.agentId) return { started: false, reason: resolved.reason, step };
  const agentId = resolved.agentId;
  const index = (nb.steps ?? []).findIndex((s) => s.id === step.id);
  ctx.notebookPipelines.set(notebookId, { agentId, step: index + 1, of: nb.steps!.length, startedAt: Date.now() });
  store.updateStep(nb.id, step.id, { status: 'running' });
  const s = step;
  void runStep(ctx, store, nb.id, s, agentId).catch((err: unknown) => {
    try { store.updateStep(notebookId, s.id, { status: 'stuck', note: err instanceof Error ? err.message.slice(0, 160) : 'It failed.' }); } catch { /* the notebook is gone */ }
  }).finally(() => ctx.notebookPipelines?.delete(notebookId));
  return { started: true, step };
}

/**
 * The agent a step runs: its own, or for a check or find step without one,
 * sua's (the checker, the finder; installed or updated now). A reason when
 * there's none it can run.
 */
function stepAgent(ctx: Ctx, step: NotebookStep): { agentId?: string; reason?: string } {
  const agentId = step.agentId ?? suaStepAgent(step.kind);
  const sua = agentId === NOTEBOOK_CHECKER_ID || agentId === NOTEBOOK_FINDER_ID;
  const fake = agentId === NOTEBOOK_CHECKER_ID ? ctx.notebookCheckerRun : agentId === NOTEBOOK_FINDER_ID ? ctx.notebookFinderRun : undefined;
  if (sua && !fake && !(ensureSystemAgentCurrent(ctx, agentId, `a notebook ${step.kind} step`)
    && (agentId !== NOTEBOOK_FINDER_ID || ensureSystemAgentCurrent(ctx, NOTEBOOK_FIND_ONE_ID, 'a notebook find step')))) {
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
  if (step.kind !== 'find') return { started: false, reason: `${step.title} isn't a find step, so there's nothing to search again.`, step };
  // Not there yet: that's the step's own run.
  if (step === currentStep(nb) && step.status !== 'met') return startNotebookStep(ctx, nb.id, { stepId: step.id });
  const resolved = stepAgent(ctx, step);
  if (!resolved.agentId) return { started: false, reason: resolved.reason, step };
  const index = (nb.steps ?? []).findIndex((s) => s.id === step.id);
  ctx.notebookPipelines ??= new Map();
  ctx.notebookPipelines.set(notebookId, { agentId: resolved.agentId, step: index + 1, of: nb.steps!.length, startedAt: Date.now(), again: true });
  const agentId = resolved.agentId;
  void runAgain(ctx, store, nb.id, step, agentId).catch((err: unknown) => {
    try { store.noteRun(notebookId, `${step.title}, again: ${err instanceof Error ? err.message.slice(0, 160) : 'it failed'}`); } catch { /* the notebook is gone */ }
  }).finally(() => ctx.notebookPipelines?.delete(notebookId));
  return { started: true, step };
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
  // Already there (a search earlier found enough): no run needed.
  if (before.met) return finish(ctx, store, notebookId, step, before, ['its goal was already met']);
  // A source step whose agent reads one item's page a run: once per option.
  const installed = ctx.agentStore.getAgent(agentId);
  const perItem = step.kind === 'source' && installed ? perItemInputs(installed) : undefined;
  if (perItem) return runPerItem(ctx, store, notebookId, step, agentId, perItem, before);
  let tries = step.tries;
  // Whether any run this press got it closer: none did (they found nothing
  // new, failed, or you stopped one) means its agent may not be able to.
  let gained = false;
  let stopped = false;
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
      break;
    }
    if (run.status !== 'completed') {
      const why = `${agent.id}: ${run.status}${run.error ? ` (${run.error.slice(0, 80)})` : ''}`;
      store.finishPass(passId, why);
      notes.push(why);
      store.updateStep(nb.id, step.id, { tries });
      continue;
    }
    const out = await keep(ctx, store, nb, agent.id, run.id, run.result ?? '');
    // A run can complete with some of its own steps unfinished (optional ones) or cut short: say so.
    const short = shortSteps(ctx.runStore.listNodeExecutions(run.id));
    const note = `${passNote(agent.id, out)}${short ? ` (${short})` : ''}`;
    store.finishPass(passId, note);
    notes.push(note);
    nb = store.get(notebookId)!;
    const now = stepProgress(nb, store.entries(nb.id, 1000), step);
    store.updateStep(nb.id, step.id, { tries, note: progressWords(step, now) });
    if (now.met) return finish(ctx, store, notebookId, { ...step, tries }, now, notes);
    // A run that got it no closer: another try with the same job won't either.
    // Closer: more done, or anything still needed changed (a fact found, a check ticked, an option ruled out).
    const closer = now.have > before.have || now.missing.join('\n') !== before.missing.join('\n');
    before = now;
    if (!closer) break;
    gained = true;
  }
  // You stopped it, or no run got it closer: Move on comes first.
  return finish(ctx, store, notebookId, { ...step, tries }, before, notes, stopped || !gained);
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
    return finish(ctx, store, notebookId, { ...step, tries }, before, [`${agentId} reads an option's own page, and none of the options missing facts has one`], true);
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
  return finish(ctx, store, notebookId, { ...step, tries }, now, [words], stopped || !closer);
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
function finish(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep, p: NotebookStepProgress, notes: readonly string[], stalled = false): void {
  const words = progressWords(step, p);
  const nb = store.updateStep(notebookId, step.id, { status: p.met ? 'met' : 'stuck', note: words, tries: step.tries, ...(!p.met && stalled ? { stalled: true } : {}) });
  store.noteRun(notebookId, `${step.title}: ${words}${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
  postStepCard(ctx, nb, step.id, p);
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
  const next = steps[i + 1];
  const words = progressWords(step, p);
  const missing = `${p.missing.slice(0, 6).map((m) => `- ${m}`).join('\n')}${p.missing.length > 6 ? `\n- and ${String(p.missing.length - 6)} more` : ''}`;
  const stalled = !p.met && !!step.stalled;
  const onward = next ? `goes on to **${next.title}**` : 'finishes';
  const body = p.met
    ? `Step ${String(i + 1)} of ${String(steps.length)} is done: **${step.title}** (${words}).${next ? ` Next is **${next.title}**${next.agentId ? `, with ${next.agentId}` : ''}.` : ' That was the last step.'}`
    : stalled
      ? `**${step.title}** couldn't get any further (${words}): its last run found nothing new, so its agent may not be able to find the rest. Still needed:\n${missing}\n\n**Move on** keeps what it found and ${onward}. **Try again** runs it once more. Or tell me what to do differently, for example a different agent for this step.`
      : `**${step.title}** stopped short after ${String(step.tries)} ${step.tries === 1 ? 'try' : 'tries'} (${words}), still getting closer. Still needed:\n${missing}\n\n**Try again** keeps going. **Move on** keeps what it found and ${onward}.`;
  const msg = inbox.addResponse(threadId, 'triage', body);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
  reopenForStepNews(ctx, threadId);
  // No card after the last step, or before a step of yours (that's its Narrow or Decide button).
  if (p.met && (!next || isYourStep(next))) return msg.id;
  const card = (action: InboxActionMeta): string => {
    const c = inbox.addResponse(threadId, 'action', action.rationale!, JSON.stringify(action));
    publishInboxEvent(ctx, threadId, 'action:created', { responseId: c.id, agentId: action.agentId, rationale: action.rationale, inputs: action.inputs, createdAt: c.createdAt });
    return c.id;
  };
  const base = { kind: 'action' as const, status: 'proposed' as const, agentId: NOTEBOOK_STEP_ACTION, effect: 'write' as const };
  if (p.met) return card({ ...base, inputs: { NOTEBOOK: nb.id, STEP: step.id, WAS: 'met' }, rationale: `Start step ${String(i + 2)}: ${next!.title}.`, ctaLabel: 'Continue' });
  const moveOn: InboxActionMeta = { ...base, inputs: { NOTEBOOK: nb.id, STEP: step.id, WAS: 'stuck', MOVE: '1' }, rationale: `Keep what ${step.title} found (${words}) and ${next ? `go on to ${next.title}` : 'finish'}.`, ctaLabel: 'Move on' };
  const again: InboxActionMeta = { ...base, inputs: { NOTEBOOK: nb.id, STEP: step.id, WAS: 'stuck' }, rationale: `Run ${step.title} again with what's still missing.`, ctaLabel: 'Try again' };
  const [first, second] = stalled ? [moveOn, again] : [again, moveOn];
  const id = card(first);
  card(second);
  return id;
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

