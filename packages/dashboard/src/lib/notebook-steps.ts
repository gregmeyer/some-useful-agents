/**
 * Running a notebook's steps (docs/notebooks.md § Steps). The notebook works
 * on one step at a time: its agent runs with that step's job in its inputs,
 * what it found is filed, and the step's goal is checked (stepProgress, no
 * model). Short of the goal, it runs again with what's still missing, up to
 * MAX_TRIES times, and stops early when a run gets it no closer. Then it
 * pauses: a met step waits for Continue, and a stuck one says what's missing
 * and offers Try again. sua says so in the notebook's conversation, with the
 * button as a card. The agent is never edited for a step.
 */
import { randomUUID } from 'node:crypto';
import { NotebookStore, stepProgress, type Agent, type InboxActionMeta, type Notebook, type NotebookStep, type NotebookStepProgress } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { publishInboxEvent } from '../routes/inbox-shared.js';
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
  const unit = step.kind === 'source' ? 'sourced' : step.kind === 'check' ? 'checked' : 'chosen';
  return `${String(p.have)} of ${String(p.want)} ${unit}`;
}

const stores = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());

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
async function runAgent(ctx: Ctx, agentId: string, inputs: (agent: Pick<Agent, 'inputs'>) => Record<string, string>): Promise<{ id: string; status: string; result?: string; error?: string }> {
  if (agentId === NOTEBOOK_CHECKER_ID && ctx.notebookCheckerRun) {
    const result = await ctx.notebookCheckerRun(inputs({ inputs: CHECKER_INPUTS }));
    return { id: randomUUID(), status: result ? 'completed' : 'failed', ...(result ? { result } : { error: 'no answer' }) };
  }
  const agent = ctx.agentStore.getAgent(agentId)!;
  const run = await runDispatchedAgentToTerminal(ctx, agent, inputs(agent));
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
  for (let i = 0; i < MAX_TRIES; i++) {
    tries++;
    const passId = store.startPass(nb.id, 'pipeline');
    const entries = store.entries(nb.id, 1000);
    const run = await runAgent(ctx, agentId, (a) => pipelineInputs(a, nb, entries, { step, want: before.want, have: before.have, missing: before.missing }));
    store.addRunToPass(passId, run.id);
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
  }
  return finish(ctx, store, notebookId, { ...step, tries }, before, notes);
}

/** Mark the step met or stuck, note the run, and say so in the conversation with the next button. */
function finish(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep, p: NotebookStepProgress, notes: readonly string[]): void {
  const words = progressWords(step, p);
  const nb = store.updateStep(notebookId, step.id, { status: p.met ? 'met' : 'stuck', note: words, tries: step.tries });
  store.noteRun(notebookId, `${step.title}: ${words}${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
  postStepCard(ctx, nb, step.id, p);
}

/**
 * sua's message about a step that paused, with its card: Continue to the
 * next step (or Decide, when that's next), or Try again with what's missing.
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
  const missing = p.missing.slice(0, 6).map((m) => `- ${m}`).join('\n');
  const body = p.met
    ? `Step ${String(i + 1)} of ${String(steps.length)} is done: **${step.title}** (${words}).${next ? ` Next is **${next.title}**${next.agentId ? `, with ${next.agentId}` : ''}.` : ' That was the last step.'}`
    : `**${step.title}** stopped short after ${String(step.tries)} ${step.tries === 1 ? 'try' : 'tries'} (${words}). Still needed:\n${missing}${p.missing.length > 6 ? `\n- and ${String(p.missing.length - 6)} more` : ''}\n\nI can try again, or you can change the step or its agent; tell me what to do differently.`;
  const msg = inbox.addResponse(threadId, 'triage', body);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
  // No card after the last step, or before a decide step (that's the Decide button).
  if (p.met && (!next || next.kind === 'decide')) return msg.id;
  const action: InboxActionMeta = {
    kind: 'action', status: 'proposed', agentId: NOTEBOOK_STEP_ACTION, effect: 'write',
    inputs: { NOTEBOOK: nb.id, STEP: step.id, WAS: p.met ? 'met' : 'stuck' },
    rationale: p.met ? `Start step ${String(i + 2)}: ${next!.title}.` : `Run ${step.title} again with what's still missing.`,
    ctaLabel: p.met ? 'Continue' : 'Try again',
  };
  const card = inbox.addResponse(threadId, 'action', action.rationale!, JSON.stringify(action));
  publishInboxEvent(ctx, threadId, 'action:created', { responseId: card.id, agentId: action.agentId, rationale: action.rationale, inputs: action.inputs, createdAt: card.createdAt });
  return card.id;
}
