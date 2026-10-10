/**
 * A fix sua proposes from a notebook's conversation must not change an agent
 * other things depend on. When the agent is shared (a bundled example, or
 * another notebook searches with it), the fix is applied as a copy for this
 * notebook: the copy gets the new definition, this notebook's searches switch
 * to it, and the original stays as it was. (On 2026-10-09 a "fix" made in the
 * comp-set notebook turned the general starter-research into a firmographics
 * pipeline, which the cabinet notebook also searched with.) A fix asked for
 * from the agent's own page or thread still edits it in place.
 */
import { NotebookStore, type InboxActionMeta } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { notebookForThread } from './notebook-chat.js';

type Ctx = ReturnType<typeof getContext>;

const MAX_ID = 60;

/** The copy's id: the agent's, then the notebook's, made unique among installed agents. */
export function forkId(agentId: string, notebookId: string, taken: (id: string) => boolean): string {
  const base = `${agentId}-${notebookId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').slice(0, MAX_ID).replace(/-+$/, '');
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, MAX_ID - String(n).length - 1)}-${String(n)}`;
    if (!taken(id)) return id;
  }
}

/**
 * Whether a fix to `agentId`, proposed in this conversation, should be a copy
 * for the conversation's notebook, and the copy's id and name. Undefined: the
 * conversation isn't a notebook's, the agent doesn't exist yet (an install),
 * or nothing else depends on it (an agent only this notebook uses is fixed in
 * place, including a copy made earlier).
 */
export function forkForNotebook(ctx: Ctx, messageId: string, agentId: string): InboxActionMeta['fork'] {
  const message = ctx.inboxStore?.get(messageId);
  if (!message) return undefined;
  const nb = notebookForThread(ctx, messageId, message.contextJson ?? undefined);
  const target = ctx.agentStore.getAgent(agentId);
  if (!nb || !target) return undefined;
  const others = NotebookStore.fromHandle(ctx.runStore.databaseHandle()).list({ archived: 'include' })
    .filter((n) => n.id !== nb.id && n.pipeline.includes(agentId));
  const example = target.source === 'examples';
  if (!example && others.length === 0) return undefined;
  const why = [
    example ? 'it’s one of sua’s example agents' : '',
    others.length ? `${others.length === 1 ? 'another notebook searches' : `${String(others.length)} other notebooks search`} with it (${others.slice(0, 3).map((n) => n.title).join('; ')})` : '',
  ].filter(Boolean).join(', and ');
  // An earlier copy for this notebook is updated rather than copied again.
  const earlier = forkId(agentId, nb.id, () => false);
  const id = ctx.agentStore.getAgent(earlier) ? earlier : forkId(agentId, nb.id, (x) => !!ctx.agentStore.getAgent(x));
  return { id, name: `${target.name} (${nb.title})`.slice(0, 80), notebookId: nb.id, notebookTitle: nb.title, why };
}
