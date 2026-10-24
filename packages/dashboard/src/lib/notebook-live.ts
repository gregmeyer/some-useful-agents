/**
 * What a notebook page shows as live: its conversation waiting on you or
 * being answered, and its own work (a step or pass running, photos, filter
 * labels). The header bar, the Talk card and the page's toast all read it.
 */
import { threadAsk, type Notebook } from '@some-useful-agents/core';
import { conversationWorking } from './conversation-working.js';
import { currentStep, isYourStep } from './notebook-steps.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export type NotebookTalkLive =
  | { state: 'waiting'; kind: 'approve' | 'answer' | 'fail'; text: string; threadId: string }
  /** The notebook's next step is yours (Decide or Narrow): its header control opens it. */
  | { state: 'waiting'; kind: 'step'; text: string; act: 'decide' | 'narrow'; threadId?: string }
  | { state: 'working'; text: string; threadId: string };

export interface NotebookLive {
  /** The notebook's conversation: waiting on you, or sua replying. */
  talk?: NotebookTalkLive;
  /** The notebook's own work right now ("Working on step 2: Check options"). */
  work: string[];
}

/**
 * The notebook's conversation now: waiting on you (the same rule as Home and
 * the pill), or being answered. With nothing asked there, a next step that's
 * yours (Decide, Narrow) is what waits on you: the conversation is reopened
 * for it, and the pill counts it.
 */
export function notebookTalkLive(ctx: Ctx, nb: Pick<Notebook, 'conversationId' | 'steps' | 'status'>, running = false): NotebookTalkLive | undefined {
  const id = nb.conversationId;
  const msg = id && ctx.inboxStore ? ctx.inboxStore.get(id) : null;
  if (id && msg && msg.status === 'awaiting_user') {
    const ask = threadAsk(msg, ctx.inboxStore!.listResponses(id));
    if (ask) {
      const kind = ask.kind === 'approve' || ask.kind === 'fail' ? ask.kind : 'answer';
      return { state: 'waiting', kind, text: ask.text, threadId: id };
    }
  }
  const working = id && msg ? conversationWorking(ctx, msg) : undefined;
  if (working) return { state: 'working', text: working, threadId: id! };
  const step = nb.status === 'active' && !running ? currentStep(nb) : undefined;
  if (step && isYourStep(step) && step.status !== 'done') {
    return { state: 'waiting', kind: 'step', text: step.title, act: step.kind === 'narrow' ? 'narrow' : 'decide', ...(id ? { threadId: id } : {}) };
  }
  return undefined;
}

/** Everything live on the page. `running` is the pass or step running now; `busy`, sua's background work. */
export function notebookLive(ctx: Ctx, nb: Notebook, running: { step: number; of: number } | undefined, busy: readonly string[]): NotebookLive {
  const work: string[] = [];
  if (running) {
    const step = nb.steps?.find((s) => s.status === 'running');
    const n = step ? nb.steps!.indexOf(step) + 1 : 0;
    work.push(step ? `Working on step ${String(n)}: ${step.title}` : `Running step ${String(running.step)} of ${String(running.of)}`);
  }
  work.push(...busy);
  const talk = notebookTalkLive(ctx, nb, !!running);
  return { ...(talk ? { talk } : {}), work };
}

/**
 * A short key for the page's poll: changes when the conversation starts or
 * stops waiting or replying. (Its own work already reloads the page while it runs.)
 */
export function notebookLiveKey(live: NotebookLive): string {
  return live.talk ? `${live.talk.state}:${live.talk.text}` : '';
}
