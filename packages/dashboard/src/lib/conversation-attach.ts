/**
 * A file attached to a message in a conversation with sua. The page reads
 * the file's text (as it does for a notebook's paste box), keeps it with
 * POST /notebooks/attach, and puts a marker for it in the message
 * ("[file: Dana Reyes Profile · 3f9a1c22b0]"). When the message is sent:
 *
 * - in a notebook's conversation, the text is filed on that notebook as
 *   something you gave it, and read, before sua's turn. Code does this, so
 *   it never depends on sua choosing to;
 * - anywhere else, it stays on the conversation, and is filed on the
 *   notebook when one is started from it.
 *
 * The marker becomes a plain line in the message ("Attached: …"), and sua's
 * turn gets what was attached in CONTEXT_JSON (`attached`). The file itself
 * is never kept.
 */
import { NotebookStore, type Notebook, type NotebookAttachment } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { notebookForThread } from './notebook-chat.js';
import { startGivenRead } from './notebook-given-read.js';

type Ctx = ReturnType<typeof getContext>;

/** The marker a page puts in a message for an attached file: its name and the id it was kept under. */
export const ATTACH_MARKER = /\[file: ([^\]\n]{1,120}) · ([a-f0-9]{10})\]/g;

/** A message without its markers (for a title made from it). Pure. */
export function withoutAttachMarkers(text: string): string {
  return text.replace(ATTACH_MARKER, ' ').replace(/[ \t]+/g, ' ').trim();
}

const stores = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());
const takes = (nb: Notebook | undefined): nb is Notebook => !!nb && !nb.archivedAt && !nb.experimentRun;

/** File one on a notebook as something you gave it, and start reading it. Returns why not, when it can't. */
function fileOn(ctx: Ctx, nb: Notebook, a: NotebookAttachment): string | undefined {
  const store = stores(ctx);
  try {
    const after = store.addGiven(nb.id, { label: a.label, text: a.text });
    const g = [...(after.given ?? [])].filter((x) => x.state === 'given').sort((x, y) => y.at.localeCompare(x.at))[0];
    if (g) startGivenRead(ctx, nb.id, g.key);
    store.placeAttachment(a.id, { notebookId: nb.id });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * A message as it is sent in a conversation: each marker's file is kept on
 * the conversation (and filed on its notebook, when it has one), and the
 * marker becomes a line that says so. A message with no markers comes back
 * as it was. Never throws.
 */
export function takeAttachments(ctx: Ctx, threadId: string, text: string): string {
  if (!text.includes('[file: ')) return text;
  try {
    const store = stores(ctx);
    const nb = notebookForThread(ctx, threadId, ctx.inboxStore?.get(threadId)?.contextJson ?? undefined);
    return text.replace(ATTACH_MARKER, (_m, name: string, id: string) => {
      const a = store.attachment(id);
      if (!a) return `Attached: ${name} (it wasn't kept; attach it again)`;
      store.placeAttachment(id, { threadId });
      if (!takes(nb)) return `Attached: ${a.label}`;
      const why = fileOn(ctx, nb, a);
      return why ? `Attached: ${a.label} (not added to the notebook: ${why})` : `Attached: ${a.label} (added to this notebook under What you gave it)`;
    });
  } catch {
    return text;
  }
}

/**
 * A notebook was started from a conversation: what was attached there and
 * not yet filed anywhere goes on it. Returns the labels filed.
 */
export function fileThreadAttachments(ctx: Ctx, threadId: string, notebookId: string): string[] {
  try {
    const store = stores(ctx);
    const nb = store.get(notebookId);
    if (!takes(nb)) return [];
    return store.threadAttachments(threadId).filter((a) => !a.notebookId).filter((a) => !fileOn(ctx, nb, a)).map((a) => a.label);
  } catch {
    return [];
  }
}

/** How much of an attached file's text sua's turn is shown. */
export const ATTACH_EXCERPT = 2000;

/**
 * A conversation's CONTEXT_JSON with what was attached in it: each file's
 * name, the start of its text, how long it is, and the notebook it was
 * filed on. Unchanged when nothing was attached. Never throws.
 */
export function contextWithAttachments(ctx: Ctx, threadId: string, contextJson: string | null | undefined): string {
  const was = contextJson ?? '';
  try {
    const store = stores(ctx);
    const list = store.threadAttachments(threadId);
    if (!list.length) return was;
    let base: Record<string, unknown> = {};
    try { const v = was ? JSON.parse(was) as unknown : {}; if (v && typeof v === 'object' && !Array.isArray(v)) base = v as Record<string, unknown>; } catch { base = { was }; }
    const attached = list.map((a) => ({
      name: a.label, characters: a.text.length,
      startsWith: a.text.slice(0, ATTACH_EXCERPT),
      ...(a.text.length > ATTACH_EXCERPT ? { cut: true } : {}),
      ...(a.notebookId ? { filedOnNotebook: store.get(a.notebookId)?.title ?? a.notebookId } : {}),
    }));
    return JSON.stringify({ ...base, attached });
  } catch {
    return was;
  }
}
