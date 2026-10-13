/**
 * Is a conversation being answered right now? The list rows and the thread
 * show it (a pulsing "… is replying") so a conversation you open mid-reply
 * doesn't look finished. An agent's conversation: its last turn is yours and
 * that turn's run hasn't ended. Anything else: sua's triage is pending.
 */
import type { InboxMessage, InboxResponse } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { isTriagePending } from '../routes/inbox-engine.js';

type Ctx = ReturnType<typeof getContext>;

/** The run of an agent conversation's turn that's still going, if any. */
export function agentTurnInProgress(ctx: Ctx, message: InboxMessage, responses?: readonly InboxResponse[]): { runId: string } | undefined {
  if (message.source !== 'conversation' || !message.agentId) return undefined;
  const list = responses ?? ctx.inboxStore?.listResponses(message.id) ?? [];
  const last = [...list].reverse().find((r) => r.role === 'user' || r.role === 'agent');
  if (!last || last.role !== 'user' || !last.metaJson) return undefined;
  let runId: unknown;
  try { runId = (JSON.parse(last.metaJson) as { runId?: unknown }).runId; } catch { return undefined; }
  if (typeof runId !== 'string') return undefined;
  const run = ctx.runStore.getRun(runId);
  return run && (run.status === 'running' || run.status === 'pending') ? { runId } : undefined;
}

/** "chat-helper is replying…", "sua is working…", or undefined when nothing is. */
export function conversationWorking(ctx: Ctx, message: InboxMessage): string | undefined {
  if (message.source === 'conversation' && message.agentId) {
    return agentTurnInProgress(ctx, message) ? `${message.agentId} is replying…` : undefined;
  }
  try {
    return isTriagePending(ctx, message, ctx.inboxStore?.listResponses(message.id) ?? []) ? 'sua is working…' : undefined;
  } catch {
    return undefined;
  }
}
