/**
 * One queue for a notebook's steps (ADR-0055). The notebook's header buttons
 * (Next step, Move on, Search again) and its conversation's step cards are two
 * ways to answer the same request: the thread's live `notebook-step` card. A
 * header press acts through that card, so the conversation says what happened;
 * a card that no longer matches the notebook (the step moved on, started, or
 * was replaced) is retired with why; and a paused step always has its card.
 */
import { createHash } from 'node:crypto';
import { NotebookStore, stepProgress, type InboxActionMeta, type InboxResponse, type Notebook, type NotebookStep } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { parseActionMeta, publishInboxChanged, publishInboxEvent } from '../routes/inbox-shared.js';
import { addStepCard, currentStep, isYourStep, NOTEBOOK_STEP_ACTION, stepCards } from './notebook-steps.js';

type Ctx = ReturnType<typeof getContext>;

/** What a step card asks for: run the step (Start, Continue, Try again), move on from it, or search again. */
export type StepOp = 'start' | 'move' | 'again';

export function stepOp(meta: Pick<InboxActionMeta, 'inputs'>): StepOp {
  return meta.inputs.AGAIN === '1' ? 'again' : meta.inputs.MOVE === '1' ? 'move' : 'start';
}

/** Cards asking the same thing share a key; only the newest stays. */
function cardKey(meta: Pick<InboxActionMeta, 'inputs'>): string {
  return `${stepOp(meta)}|${meta.inputs.STEP ?? ''}|${meta.inputs.WAS ?? ''}`;
}

const stores = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());

const isRunning = (ctx: Ctx, notebookId: string) => !!ctx.notebookPipelines?.has(notebookId);

/**
 * Whether a step card would do what it says, on the notebook as it is now:
 * nothing is running, and the step it names is still the current one, in the
 * state it was in when the card was made.
 */
export function stepCardLive(nb: Notebook, meta: Pick<InboxActionMeta, 'inputs'>, running: boolean): boolean {
  if (running || nb.status !== 'active') return false;
  const op = stepOp(meta);
  const { STEP, WAS } = meta.inputs;
  if (op === 'again') return !!(STEP ? nb.steps?.find((s) => s.id === STEP) : nb.steps?.find((s) => s.kind === 'find'));
  const cur = currentStep(nb);
  if (!cur || (STEP && STEP !== cur.id) || (WAS && WAS !== cur.status)) return false;
  if (op === 'move') return !isYourStep(cur);
  if (cur.status === 'met') {
    const after = (nb.steps ?? []).slice((nb.steps ?? []).indexOf(cur) + 1).find((s) => s.status !== 'done');
    return !!after && !isYourStep(after);
  }
  return !isYourStep(cur);
}

/** The notebook's step cards still waiting on you, oldest first. */
function proposedStepCards(ctx: Ctx, threadId: string, notebookId: string): Array<{ r: InboxResponse; meta: InboxActionMeta }> {
  const out: Array<{ r: InboxResponse; meta: InboxActionMeta }> = [];
  for (const r of ctx.inboxStore?.listResponses(threadId) ?? []) {
    const meta = parseActionMeta(r);
    if (meta?.status === 'proposed' && meta.agentId === NOTEBOOK_STEP_ACTION && meta.inputs.NOTEBOOK === notebookId) out.push({ r, meta });
  }
  return out;
}

/** Take a card back, saying why (it's no longer what the notebook needs). */
function retire(ctx: Ctx, threadId: string, r: InboxResponse, meta: InboxActionMeta, why: string): void {
  const skipped: InboxActionMeta = { ...meta, status: 'skipped', skippedBy: 'notebook', skipReason: why, endedAt: Date.now() };
  if (ctx.inboxStore!.transitionActionStatus(r.id, 'proposed', JSON.stringify(skipped))) {
    publishInboxEvent(ctx, threadId, 'action:status', { responseId: r.id, status: 'skipped', agentId: meta.agentId, endedAt: skipped.endedAt });
  }
}

/**
 * Bring the conversation's step cards in line with the notebook: retire each
 * that no longer applies (or that a newer one asks again), and when a step is
 * paused with none left, put its card back, unless the same card already
 * failed or you skipped it (so it doesn't come back each time you look).
 * Returns the live cards, newest first.
 */
export function reconcileStepCards(ctx: Ctx, notebookId: string): Array<{ r: InboxResponse; meta: InboxActionMeta }> {
  const nb = stores(ctx).get(notebookId);
  const threadId = nb?.conversationId;
  if (!nb || !threadId || !ctx.inboxStore?.get(threadId)) return [];
  const running = isRunning(ctx, notebookId);
  const live: Array<{ r: InboxResponse; meta: InboxActionMeta }> = [];
  const seen = new Set<string>();
  for (const c of proposedStepCards(ctx, threadId, notebookId).reverse()) {
    const key = cardKey(c.meta);
    if (!stepCardLive(nb, c.meta, running)) {
      retire(ctx, threadId, c.r, c.meta, running ? 'The notebook is already working on it.' : nb.status !== 'active' ? 'The notebook is closed.' : 'The notebook has moved on from this.');
    } else if (seen.has(key)) {
      retire(ctx, threadId, c.r, c.meta, 'A newer card asks the same.');
    } else {
      seen.add(key);
      live.push(c);
    }
  }
  if (running || nb.status !== 'active' || live.some((c) => stepOp(c.meta) !== 'again')) return live;
  const step = currentStep(nb);
  if (!step) return live;
  const p = step.status === 'met' ? { have: 0, want: 0, met: true } : stepProgress(nb, stores(ctx).entries(nb.id, 1000), step);
  const want = stepCards(nb, step.id, { ...p, met: step.status === 'met' });
  if (!want.length) return live;
  // Being acted on now, refused, or skipped by you: the header says why; no new card each time the page loads.
  // (One that ran to the end doesn't count: the step came back to the same place, so it's asked again.)
  const asked = new Set((ctx.inboxStore.listResponses(threadId)).map((r) => parseActionMeta(r))
    .filter((m): m is InboxActionMeta => !!m && m.agentId === NOTEBOOK_STEP_ACTION && m.inputs.NOTEBOOK === nb.id
      && (m.status === 'running' || m.status === 'failed' || (m.status === 'skipped' && m.skippedBy !== 'notebook')))
    .map(cardKey));
  if (want.some((a) => asked.has(cardKey(a)))) return live;
  for (const a of want) {
    const id = addStepCard(ctx, threadId, a);
    live.push({ r: ctx.inboxStore.getResponse(id)!, meta: a });
  }
  awaitYou(ctx, threadId);
  return live;
}

/** A closed thread with a new step card for you is back waiting on you (an open one keeps its status: sua may be mid-turn). */
function awaitYou(ctx: Ctx, threadId: string): void {
  const cur = ctx.inboxStore?.get(threadId);
  if (!cur || (cur.status !== 'resolved' && cur.status !== 'dismissed')) return;
  ctx.inboxStore!.updateStatus(threadId, 'awaiting_user');
  publishInboxChanged(ctx, threadId, 'awaiting_user');
}

/** The card the notebook is waiting on you for, if any (its first button). */
export function waitingStepCard(ctx: Ctx, notebookId: string): InboxActionMeta | undefined {
  const nb = stores(ctx).get(notebookId);
  if (!nb?.conversationId || !ctx.inboxStore?.get(nb.conversationId)) return undefined;
  const running = isRunning(ctx, notebookId);
  const live = proposedStepCards(ctx, nb.conversationId, notebookId).filter((c) => stepCardLive(nb, c.meta, running) && stepOp(c.meta) !== 'again');
  return live[0]?.meta;
}

/**
 * Pin a step card sua proposed to the step as it is now (its STEP and WAS),
 * so it can't later act on a different one. Refused while a step runs, when
 * there's nothing it could do, or when that card is already waiting.
 */
export function pinStepAction(ctx: Ctx, action: InboxActionMeta): { action?: InboxActionMeta; reason?: string } {
  const nb = stores(ctx).get(action.inputs.NOTEBOOK ?? '');
  if (!nb) return { reason: 'no such notebook' };
  if (isRunning(ctx, nb.id)) return { reason: 'a step is already running; say so instead of proposing another' };
  const op = stepOp(action);
  if (op === 'again') return { action };
  const cur = currentStep(nb);
  if (!cur) return { reason: 'every step is done' };
  if (action.inputs.STEP && action.inputs.STEP !== cur.id) return { reason: `only the current step (${cur.id}) can be run or moved on from` };
  const pinned: InboxActionMeta = { ...action, inputs: { ...action.inputs, STEP: cur.id, WAS: cur.status } };
  if (!stepCardLive(nb, pinned, false)) return { reason: isYourStep(cur) ? 'the current step is the operator’s (Narrow or Decide)' : 'that step can’t be run from here' };
  const key = cardKey(pinned);
  if (nb.conversationId && proposedStepCards(ctx, nb.conversationId, nb.id).some((c) => cardKey(c.meta) === key)) return { reason: 'that step card is already waiting on the operator' };
  return { action: pinned };
}

/**
 * A header button, through the conversation: claims the card waiting for this
 * (or puts one in, already claimed), runs it as approving it would, and says
 * how it went there. Returns what to flash on the page.
 */
export async function actOnStep(ctx: Ctx, notebookId: string, op: StepOp, opts: { stepId?: string } = {}): Promise<{ ok: boolean; message: string; step?: NotebookStep }> {
  const { executeNotebookStep, runProposedAction } = await import('../routes/inbox-engine.js');
  const store = stores(ctx);
  const nb = store.get(notebookId);
  if (!nb) return { ok: false, message: 'No such notebook.' };
  const live = reconcileStepCards(ctx, notebookId);
  const cur = currentStep(nb);
  const wanted = (m: InboxActionMeta) => stepOp(m) === op && (!opts.stepId || m.inputs.STEP === opts.stepId);
  let card = live.find((c) => wanted(c.meta));
  let meta: InboxActionMeta | undefined = card?.meta;
  if (!meta) {
    const inputs: Record<string, string> = op === 'again'
      ? { NOTEBOOK: nb.id, AGAIN: '1', ...(opts.stepId ? { STEP: opts.stepId } : {}) }
      : { NOTEBOOK: nb.id, ...(cur ? { STEP: cur.id, WAS: cur.status } : {}), ...(op === 'move' ? { MOVE: '1' } : {}) };
    const target = op === 'again' ? nb.steps?.find((s) => s.id === opts.stepId) : cur;
    const i = target ? (nb.steps ?? []).indexOf(target) : -1;
    const next = i >= 0 ? nb.steps![i + 1] : undefined;
    const rationale = op === 'again' ? `Search again: ${target?.title ?? 'the find step'}.`
      : op === 'move' ? `Keep what ${cur?.title ?? 'the step'} found and ${next ? `go on to ${next.title}` : 'finish'}.`
      : cur?.status === 'met' && next ? `Start step ${String(i + 2)}: ${next.title}.`
      : `${cur?.status === 'stuck' ? 'Run' : 'Start'} step ${String(i + 1)}: ${cur?.title ?? ''}${cur?.status === 'stuck' ? ' again' : ''}.`;
    meta = { kind: 'action', status: 'proposed', agentId: NOTEBOOK_STEP_ACTION, effect: 'write', inputs, rationale, ctaLabel: op === 'again' ? 'Search again' : op === 'move' ? 'Move on' : cur?.status === 'met' ? 'Continue' : cur?.status === 'stuck' ? 'Try again' : 'Start' };
  }
  const threadId = nb.conversationId && ctx.inboxStore?.get(nb.conversationId) ? nb.conversationId : undefined;
  // No conversation yet: act directly, as before.
  if (!threadId) {
    const out = await executeNotebookStep(ctx, meta);
    return { ok: out.status === 'completed', message: (out.status === 'completed' ? out.summary : out.refusalReason) ?? 'It could not start.' };
  }
  if (!card) {
    const id = addStepCard(ctx, threadId, meta);
    card = { r: ctx.inboxStore!.getResponse(id)!, meta };
  }
  const running: InboxActionMeta = { ...meta, status: 'running', startedAt: Date.now(), approvedBy: 'operator', from: 'notebook' };
  if (!ctx.inboxStore!.transitionActionStatus(card.r.id, 'proposed', JSON.stringify(running))) return { ok: false, message: 'It’s already started.' };
  publishInboxEvent(ctx, threadId, 'action:status', { responseId: card.r.id, status: 'running', agentId: NOTEBOOK_STEP_ACTION, startedAt: running.startedAt });
  await runProposedAction(ctx, threadId, card.r, running);
  const done = parseActionMeta(ctx.inboxStore!.getResponse(card.r.id)!);
  const ok = done?.status === 'completed';
  return { ok, message: (ok ? done?.resultSummary : done?.refusalReason) ?? (ok ? 'Started.' : 'It could not start.') };
}

/**
 * What the notebook's header shows about its steps, as a short key: each
 * step's status, whether one is running, and the card waiting on you. The
 * page's poll reloads when it changes (a step started or paused from the
 * conversation, say), so the header and the conversation never disagree.
 */
export function stepsKey(ctx: Ctx, nb: Notebook): string {
  if (!nb.steps?.length) return '';
  const card = waitingStepCard(ctx, nb.id);
  const parts = [nb.status, isRunning(ctx, nb.id), nb.steps.map((s) => [s.id, s.status, s.tries, s.note ?? '', !!s.stalled]), card ? `${card.ctaLabel ?? ''}|${card.rationale ?? ''}` : ''];
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/**
 * At boot: a step left running by a restart (its run went with the process)
 * stopped short there. It's marked stuck, sua says so in the conversation,
 * and its Try again / Move on cards wait, so Next step doesn't pretend it's
 * still going. Returns how many it found.
 */
export function reconcileStepsOnBoot(ctx: Ctx): number {
  const store = stores(ctx);
  let n = 0;
  for (const nb of store.list({ archived: 'include' })) {
    const step = nb.steps?.find((s) => s.status === 'running');
    if (!step || isRunning(ctx, nb.id)) continue;
    try {
      store.updateStep(nb.id, step.id, { status: 'stuck', note: step.note ? `${step.note} · stopped by a restart` : 'stopped by a restart' });
      store.noteRun(nb.id, `${step.title}: stopped by a restart`);
      const threadId = nb.conversationId && ctx.inboxStore?.get(nb.conversationId) ? nb.conversationId : undefined;
      if (threadId) {
        const msg = ctx.inboxStore!.addResponse(threadId, 'triage', `sua restarted while **${step.title}** was running, so it stopped there, keeping what it had found. **Try again** runs it again; **Move on** keeps what it found and goes on.`);
        publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
      }
      reconcileStepCards(ctx, nb.id);
      n++;
    } catch { /* one notebook can't stop the rest */ }
  }
  return n;
}
