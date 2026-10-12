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
import { NotebookStore, stepProgress, type Agent, type InboxActionMeta, type Notebook, type NotebookStep, type NotebookStepProgress } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { publishInboxChanged, publishInboxEvent } from '../routes/inbox-shared.js';
import { keep, passNote, pipelineInputs } from './notebook-pipeline.js';
import { notebookThread } from './notebook-chat.js';

type Ctx = ReturnType<typeof getContext>;

/** Runs per press, toward one step's goal. */
export const MAX_TRIES = 3;
/** sua's checker: a check step without an agent of its own uses it. */
export const NOTEBOOK_CHECKER_ID = 'notebook-checker';
/** The checker's inputs, for a test's stand-in. */
const CHECKER_INPUTS = { NOTEBOOK: {}, CHECKS: {}, OPTIONS: {} } as unknown as Agent['inputs'];

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

/** "8 of 10 found" — a step's progress in a few words. */
export function progressWords(step: Pick<NotebookStep, 'kind'>, p: Pick<NotebookStepProgress, 'have' | 'want'>): string {
  if (step.kind === 'find') return p.have > p.want ? `${String(p.have)} found, goal ${String(p.want)}` : `${String(p.have)} of ${String(p.want)} found`;
  const unit = step.kind === 'source' ? 'facts sourced' : step.kind === 'check' ? 'checked' : 'chosen';
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
    if (step.kind === 'decide') { next = { step }; break; }
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
    ? next.step.kind === 'decide'
      ? ` Next is **${next.step.title}**, with Decide.`
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
  if (step.kind === 'decide') return { started: false, reason: 'This step is yours: pick the final set with Decide.', step };
  if (step.kind === 'check' && nb.checks.length === 0) return { started: false, reason: 'The notebook has no checks yet. Add them under Edit, or tell sua what to check.', step };
  // A check step without an agent uses sua's checker.
  const agentId = step.agentId ?? (step.kind === 'check' ? NOTEBOOK_CHECKER_ID : undefined);
  const checker = agentId === NOTEBOOK_CHECKER_ID && !step.agentId;
  if (checker && !ctx.notebookCheckerRun && !ensureSystemAgentCurrent(ctx, NOTEBOOK_CHECKER_ID, 'a notebook check step')) {
    return { started: false, reason: 'sua’s checker isn’t available.', step };
  }
  const agent = agentId ? ctx.agentStore.getAgent(agentId) : undefined;
  if (!agentId || ((!agent || agent.status === 'archived') && !(checker && ctx.notebookCheckerRun))) {
    return { started: false, reason: agentId ? `Its agent, ${agentId}, isn't installed.` : 'This step needs an agent. Ask sua to pick or build one.', step };
  }
  const index = (nb.steps ?? []).findIndex((s) => s.id === step.id);
  ctx.notebookPipelines.set(notebookId, { agentId, step: index + 1, of: nb.steps!.length, startedAt: Date.now() });
  store.updateStep(nb.id, step.id, { status: 'running' });
  const s = step;
  void runStep(ctx, store, nb.id, s, agentId).catch((err: unknown) => {
    try { store.updateStep(notebookId, s.id, { status: 'stuck', note: err instanceof Error ? err.message.slice(0, 160) : 'It failed.' }); } catch { /* the notebook is gone */ }
  }).finally(() => ctx.notebookPipelines?.delete(notebookId));
  return { started: true, step };
}

/** Run a step's agent to the end (a test's stand-in for the checker answers at once). */
async function runAgent(ctx: Ctx, agentId: string, inputs: (agent: Pick<Agent, 'inputs'>) => Record<string, string>, onRunId?: (runId: string) => void): Promise<{ id: string; status: string; result?: string; error?: string }> {
  if (agentId === NOTEBOOK_CHECKER_ID && ctx.notebookCheckerRun) {
    const result = await ctx.notebookCheckerRun(inputs({ inputs: CHECKER_INPUTS }));
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
    store.finishPass(passId, passNote(agent.id, out));
    notes.push(passNote(agent.id, out));
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
  // No card after the last step, or before a decide step (that's the Decide button).
  if (p.met && (!next || next.kind === 'decide')) return msg.id;
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
  if (!running || !nb || !nb.steps?.some((s) => s.status === 'running')) return { stopped: false, reason: 'No step is running.' };
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
  if (step.kind === 'decide') return { moved: false, reason: 'This step is yours: pick the final set with Decide.' };
  const p = stepProgress(nb, store.entries(nb.id, 1000), step);
  const words = progressWords(step, p);
  const after = store.updateStep(nb.id, step.id, { status: 'done', movedOn: true, note: `${words}, moved on` });
  store.noteRun(nb.id, `${step.title}: moved on with ${words}`);
  const next = currentStep(after);
  if (!next || next.kind === 'decide') return { moved: true, step };
  return { moved: true, step, next: startNotebookStep(ctx, nb.id) };
}
