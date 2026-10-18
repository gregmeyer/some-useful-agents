/**
 * One notebook as a card: its picture (the lead option's, when it has a real
 * one) and a line of what it holds.
 * Used by the Notebooks list and by a notebook's conversation thread.
 */
import { notebookViewData, notebookPhotoPath, NotebookStore, rankBy, rankOptions, type Notebook, type NotebookViewOption, type InboxMessage } from '@some-useful-agents/core';
import { formatFieldValue, type NotebookCard } from '../views/notebooks.js';

/** Best first by the score field (how well it fits) when there is one, else by price; only those it can rank. */
function ranked(nb: Notebook, active: NotebookViewOption[]): NotebookViewOption[] {
  const rank = rankBy(nb);
  return rankOptions(nb, active).filter((o) => (rank.by === 'score' ? o.score : o.price) !== undefined);
}

/**
 * The picture that stands for a notebook (its card and its page header): the
 * lead option's own, so it matches the name beside it; when the lead has only
 * a drawing (or none), the notebook's cover.
 */
export function notebookCover(s: NotebookStore, nb: Notebook, lead?: { id: string }): ReturnType<NotebookStore['coverPhoto']> {
  const leadKind = lead ? s.photoKind(lead.id) : undefined;
  if (lead && leadKind && leadKind !== 'illustration') {
    const shape = leadKind === 'logo' ? s.photoShape(lead.id) : undefined;
    return { entryId: lead.id, kind: leadKind, ...(shape ? { shape } : {}) };
  }
  return s.coverPhoto(nb.id);
}

/** The lead option of a notebook's entries, as its card and header rank it. */
export function notebookLead(nb: Notebook, entries: Parameters<typeof notebookViewData>[1]): { id: string } | undefined {
  const active = notebookViewData(nb, entries).notebook.options.filter((o) => !o.ruledOut);
  return ranked(nb, active)[0];
}

export function notebookCard(s: NotebookStore, nb: Notebook): NotebookCard {
  const entries = s.entries(nb.id, 1000);
  const v = notebookViewData(nb, entries).notebook;
  const priceF = nb.fields.find((f) => f.role === 'price');
  const rank = rankBy(nb);
  const active = v.options.filter((o) => !o.ruledOut);
  const priced = ranked(nb, active);
  const furthest = [...v.funnel].reverse().find((f) => f.here > 0)?.stage;
  const cover = notebookCover(s, nb, priced[0]);
  return {
    nb,
    entries: entries.length,
    options: v.options.length,
    active: active.length,
    ...(priced[0] && rank.by === 'score' && rank.field
      ? { best: `${(rank.field.label).toLowerCase()} ${String(priced[0].score)}`, bestName: priced[0].name }
      : priced[0] && priceF ? { best: formatFieldValue(priceF, priced[0].fields[priceF.key] ?? priced[0].price!), bestName: priced[0].name } : {}),
    ...(nb.criteria.length ? { checks: nb.criteria.map((c) => ({ text: c.text, met: c.met })) } : {}),
    ...(nb.criteria.length ? { done: `${String(nb.criteria.filter((c) => c.met).length)} of ${String(nb.criteria.length)} done` } : {}),
    ...(furthest && furthest !== nb.stages[0] ? { furthest } : {}),
    ...(cover ? { cover: notebookPhotoPath(nb.id, cover.entryId), coverKind: cover.kind, ...(cover.shape ? { coverShape: cover.shape } : {}) } : {}),
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
  const nb = (id ? s.get(id) : undefined) ?? s.list({ archived: 'include' }).find((n) => n.conversationId === message.id);
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
