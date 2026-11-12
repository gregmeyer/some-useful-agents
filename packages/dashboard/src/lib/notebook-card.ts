/**
 * One notebook as a card: its picture (the lead option's, when it has a real
 * one) and a line of what it holds.
 * Used by the Notebooks list and by a notebook's conversation thread.
 */
import { notebookViewData, notebookPhotoPath, notebookLayoutOf, NotebookStore, rankBy, rankOptions, type Notebook, type NotebookViewOption, type InboxMessage } from '@some-useful-agents/core';
import { formatFieldValue, type NotebookCard } from '../views/notebooks.js';
import { notebookAboutPhotoPath } from './notebook-widgets.js';

/**
 * What a notebook calls what its steps find, by the preset its page uses:
 * options for a shortlist (and a plan or a watch, which pick among them),
 * topics for a meeting briefing, findings for a company briefing or an answer.
 */
export function optionWords(nb: Pick<Notebook, 'layout'>): { one: string; many: string } {
  const preset = notebookLayoutOf(nb).preset;
  const one = preset === 'dossier' ? 'topic' : preset === 'company' || preset === 'answer' ? 'finding' : 'option';
  return { one, many: `${one}s` };
}

/**
 * The count parts on a notebook's cards (Home's shelf, the Notebooks list, its
 * conversation): "12 options" + "8 in the running" for a shortlist; for a
 * briefing or an answer "8 of 12 topics kept", or just "12 topics" while none
 * is ruled out; "3 entries" before anything is found.
 */
export function countParts(c: Pick<NotebookCard, 'nb' | 'options' | 'active' | 'entries'>): string[] {
  if (!c.options) return [`${String(c.entries)} entr${c.entries === 1 ? 'y' : 'ies'}`];
  const w = optionWords(c.nb);
  const n = (k: number) => `${String(k)} ${k === 1 ? w.one : w.many}`;
  if (w.one === 'option') return [n(c.options), `${String(c.active)} in the running`];
  return c.active === c.options ? [n(c.options)] : [`${String(c.active)} of ${String(c.options)} ${w.many} kept`];
}

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

/**
 * The cover to show, as an address: for a notebook about someone, their
 * photo (or their company's logo) once a profile step kept one; else the
 * lead option's picture, else the notebook's cover.
 */
export function notebookCoverSrc(s: NotebookStore, nb: Notebook, lead?: { id: string }): { src: string; kind: string; shape?: string } | undefined {
  if (nb.about) {
    const kept = s.aboutPhotos(nb.id);
    const who = kept.has('person') ? 'person' : kept.has('company') ? 'company' : undefined;
    // A portrait or a company's photo is theirs, not a listing's: the cards put no "listing photo" caption on it.
    if (who) return { src: notebookAboutPhotoPath(nb.id, who), kind: s.aboutPhoto(nb.id, who)?.kind === 'logo' ? 'logo' : who === 'person' ? 'portrait' : 'photo' };
  }
  const cover = notebookCover(s, nb, lead);
  return cover ? { src: notebookPhotoPath(nb.id, cover.entryId), kind: cover.kind, ...(cover.shape ? { shape: cover.shape } : {}) } : undefined;
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
  const cover = notebookCoverSrc(s, nb, priced[0]);
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
    ...(cover ? { cover: cover.src, coverKind: cover.kind, ...(cover.shape ? { coverShape: cover.shape } : {}) } : {}),
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
export interface ShelfCard extends NotebookCard { criteria: boolean[]; waiting: boolean;
  /** Where it stands, when it isn't open: you put it away, or you decided. */
  mark?: 'archived' | 'decided' }

/**
 * Home's notebooks shelf: your notebooks most recently changed first (at
 * most `limit`), and how many there are in all. Ones you decided or put
 * away are here too, marked: this is where you were last, to open and read,
 * not a suggestion to take one up again. sua waiting on you only counts on
 * one that's still open.
 */
export function homeShelf(s: NotebookStore, isWaiting: (threadId: string) => boolean, limit = 4): { cards: ShelfCard[]; total: number } {
  const all = s.list({ archived: 'include' }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    total: all.length,
    cards: all.slice(0, limit).map((nb) => {
      const mark = nb.archivedAt ? 'archived' as const : nb.status === 'decided' ? 'decided' as const : undefined;
      return {
        ...notebookCard(s, nb),
        criteria: nb.criteria.map((c) => c.met),
        waiting: !mark && nb.conversationId ? isWaiting(nb.conversationId) : false,
        ...(mark ? { mark } : {}),
      };
    }),
  };
}
