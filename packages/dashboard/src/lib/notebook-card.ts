/**
 * One notebook as a card: its cover picture and a line of what it holds.
 * Used by the Notebooks list and by a notebook's conversation thread.
 */
import { notebookViewData, notebookPhotoPath, NotebookStore, type Notebook, type InboxMessage } from '@some-useful-agents/core';
import { formatFieldValue, type NotebookCard } from '../views/notebooks.js';

export function notebookCard(s: NotebookStore, nb: Notebook): NotebookCard {
  const entries = s.entries(nb.id, 1000);
  const v = notebookViewData(nb, entries).notebook;
  const priceF = nb.fields.find((f) => f.role === 'price');
  const better = priceF?.better ?? 'lower';
  const active = v.options.filter((o) => !o.ruledOut);
  const priced = active.filter((o) => o.price !== undefined).sort((a, b) => (better === 'lower' ? a.price! - b.price! : b.price! - a.price!));
  const furthest = [...v.funnel].reverse().find((f) => f.here > 0)?.stage;
  const cover = s.coverPhoto(nb.id);
  return {
    nb,
    entries: entries.length,
    options: v.options.length,
    active: active.length,
    ...(priced[0] && priceF ? { best: formatFieldValue(priceF, priced[0].fields[priceF.key] ?? priced[0].price!), bestName: priced[0].name } : {}),
    ...(nb.criteria.length ? { done: `${String(nb.criteria.filter((c) => c.met).length)} of ${String(nb.criteria.length)} done` } : {}),
    ...(furthest && furthest !== nb.stages[0] ? { furthest } : {}),
    ...(cover ? { cover: notebookPhotoPath(nb.id, cover.entryId), coverKind: cover.kind } : {}),
  };
}

/**
 * The notebook a conversation is about: the page it was started on, or the
 * notebook whose conversation it is. Undefined for any other thread.
 */
export function notebookCardForThread(s: NotebookStore, message: InboxMessage): NotebookCard | undefined {
  let id: string | undefined;
  try {
    const page = (JSON.parse(message.contextJson ?? '{}') as { page?: { kind?: string; id?: string } }).page;
    if (page?.kind === 'notebook' && page.id) id = page.id;
  } catch { /* not JSON: look it up below */ }
  const nb = (id ? s.get(id) : undefined) ?? s.list().find((n) => n.conversationId === message.id);
  return nb ? notebookCard(s, nb) : undefined;
}

/** A notebook on Home's shelf: its card, its criteria as dots, and whether sua is waiting on you. */
export interface ShelfCard extends NotebookCard { criteria: boolean[]; waiting: boolean }

/**
 * Home's notebooks shelf: the active notebooks, most recently changed first
 * (at most `limit`), and how many there are in all.
 */
export function homeShelf(s: NotebookStore, isWaiting: (threadId: string) => boolean, limit = 4): { cards: ShelfCard[]; total: number } {
  const active = s.list({ status: 'active' }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    total: active.length,
    cards: active.slice(0, limit).map((nb) => ({
      ...notebookCard(s, nb),
      criteria: nb.criteria.map((c) => c.met),
      waiting: nb.conversationId ? isWaiting(nb.conversationId) : false,
    })),
  };
}
