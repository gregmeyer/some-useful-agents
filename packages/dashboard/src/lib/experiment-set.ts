/**
 * Which set an experiment should hold fixed (ADR-0078). Choosing it was the
 * hard step: a list of notebooks says nothing about which one suits the
 * question. This ranks them from what each holds and says why, in counted
 * terms, with no model:
 *
 * - **How well it fits**: words it shares with the question, how many
 *   options it has, and how well their facts are filled in.
 * - **An answer key**: the options you picked in it (or sua's picks, when
 *   you haven't decided), which a result can be scored against.
 * - **A golden set**: for a long list, a smaller one that still covers it:
 *   the picks, a spread of the rest across the notebook's own order, and a
 *   couple you ruled out (a good result should keep those low).
 *
 * Everything here is a suggestion shown before anything is copied; the
 * person can untick any item.
 */
import { notebookViewData, rankOptions, rankBy, type Notebook, type NotebookEntry, type NotebookViewOption } from '@some-useful-agents/core';

/** A set this size or smaller is used whole. */
export const GOLDEN_WHOLE = 12;
/** A trimmed set has about this many items. */
export const GOLDEN_SIZE = 10;
const GOLDEN_PICKS = 5;
const GOLDEN_RULED_OUT = 2;

const STOP = new Set('a an and are as at be but by can do does for from has have how i if in into is it its more most much my of on or our so than that the their them these they this those to very was we what when where which who why will with would you your does did than change changes changed test prove whether way'.split(' '));
/** The words of a sentence that say what it is about. */
export function topicWords(text: string): string[] {
  return [...new Set(text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ies)$/, 'y').replace(/s$/, '')))];
}

/** Why one item is in a golden set. */
export type GoldenWhy = 'pick' | 'spread' | 'ruled-out' | 'all';
export interface GoldenItem {
  /** The notebook entry it is. */
  id: string;
  name: string;
  why: GoldenWhy;
  /** In the set as proposed (the rest are listed, unticked). */
  inSet: boolean;
  /** For one that was ruled out: why. */
  reason?: string;
}

/** A notebook's answer key: the options a good result should put near the top. */
export interface AnswerKey { ids: string[]; names: string[]; by: 'you' | 'sua' }

export interface GoldenSet {
  items: GoldenItem[];
  /** How many are in the set as proposed, of how many it could hold. */
  size: number;
  of: number;
  /** It is a trimmed set (the notebook has more than is used whole). */
  trimmed: boolean;
  key?: AnswerKey;
  /** Ruled-out options in the set as proposed: a result should keep these low. */
  low: string[];
  /** What the spread runs across ("salary"), when the notebook ranks by something. */
  across?: string;
}

const pickedBy = (options: readonly NotebookViewOption[]): AnswerKey | undefined => {
  const yours = options.filter((o) => o.chosen && !o.ruledOut);
  const suas = yours.length ? [] : options.filter((o) => o.suggested && !o.ruledOut);
  const from = yours.length ? yours : suas;
  if (!from.length) return undefined;
  const top = from.slice(0, GOLDEN_PICKS);
  return { ids: top.map((o) => o.id), names: top.map((o) => o.name), by: yours.length ? 'you' : 'sua' };
};

/**
 * The set to propose from a notebook: all of it when it is short; else its
 * picks, a spread of the rest across the notebook's own order (so the best,
 * the middle and the worst are all there), and a couple that were ruled out
 * with a reason. Every option is listed; `inSet` says which are proposed.
 * Pure.
 */
export function goldenSet(nb: Notebook, entries: readonly NotebookEntry[]): GoldenSet {
  const all = notebookViewData(nb, entries).notebook.options;
  const ranked = rankOptions(nb, all);
  const key = pickedBy(ranked);
  const keyIds = new Set(key?.ids ?? []);
  // Ruled out for a reason, and not merely gone: the newest first.
  const out = all.filter((o) => o.ruledOut && !o.ruledOut.gone && o.ruledOut.reason).sort((a, b) => (b.ruledOut!.at > a.ruledOut!.at ? 1 : -1));
  const low = out.slice(0, GOLDEN_RULED_OUT);
  const trimmed = ranked.length > GOLDEN_WHOLE;
  const inSet = new Set<string>();
  if (!trimmed) for (const o of ranked) inSet.add(o.id);
  else {
    for (const id of keyIds) inSet.add(id);
    const rest = ranked.filter((o) => !keyIds.has(o.id));
    const want = Math.max(2, GOLDEN_SIZE - keyIds.size - low.length);
    // Evenly through the notebook's order, ends included.
    for (let i = 0; i < Math.min(want, rest.length); i++) inSet.add(rest[Math.round(i * (rest.length - 1) / Math.max(1, Math.min(want, rest.length) - 1))].id);
  }
  for (const o of low) inSet.add(o.id);
  const r = rankBy(nb);
  const items: GoldenItem[] = [
    ...ranked.map((o): GoldenItem => ({ id: o.id, name: o.name, why: keyIds.has(o.id) ? 'pick' : trimmed ? 'spread' : 'all', inSet: inSet.has(o.id) })),
    ...out.map((o): GoldenItem => ({ id: o.id, name: o.name, why: 'ruled-out', inSet: inSet.has(o.id), reason: o.ruledOut!.reason })),
  ];
  return {
    items, size: items.filter((i) => i.inSet).length, of: items.length, trimmed,
    ...(key ? { key } : {}),
    low: low.map((o) => o.id),
    ...(r.field && trimmed ? { across: r.field.label.toLowerCase() } : {}),
  };
}

/** A notebook as a set an experiment could hold fixed, with why it would or wouldn't suit. */
export interface SetCandidate {
  id: string;
  title: string;
  /** Options still in the running. */
  options: number;
  /** The first few, by name. */
  sample: string[];
  /** Words it shares with the question. */
  matched: string[];
  /** What speaks for it, as short phrases. */
  why: string[];
  /** What speaks against it. */
  but: string[];
  score: number;
  /** The one to lead with. */
  suggested?: boolean;
  key?: AnswerKey;
}

/**
 * One notebook as a candidate. Facts count as filled when most options
 * state them; the fit score is left out (it isn't a fact about the option).
 * Pure.
 */
export function setCandidate(nb: Notebook, entries: readonly NotebookEntry[], question: string): SetCandidate {
  const all = notebookViewData(nb, entries).notebook.options;
  const running = all.filter((o) => !o.ruledOut);
  const names = running.map((o) => o.name).sort((a, b) => a.localeCompare(b));
  const words = topicWords(question);
  const about = new Set(topicWords(`${nb.title} ${nb.statement} ${(nb.tags?.auto ?? []).join(' ')} ${(nb.tags?.added ?? []).join(' ')}`));
  const matched = words.filter((w) => about.has(w));
  const facts = nb.fields.filter((f) => f.role !== 'link' && f.role !== 'score' && f.type !== 'url');
  const has = (f: (typeof facts)[number], o: NotebookViewOption) => { const v = o.fields[f.key]; return v !== undefined && v !== null && v !== ''; };
  const filled = facts.map((f) => ({ label: f.label, share: running.length ? running.filter((o) => has(f, o)).length / running.length : 0, missing: running.filter((o) => !has(f, o)).length }));
  const full = filled.filter((f) => f.share >= 0.9);
  const thin = filled.filter((f) => f.share < 0.6 && f.share > 0).sort((a, b) => a.share - b.share);
  const key = pickedBy(rankOptions(nb, all));
  const ruledOut = all.filter((o) => o.ruledOut && !o.ruledOut.gone && o.ruledOut.reason).length;
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

  const why: string[] = [];
  const but: string[] = [];
  if (matched.length) why.push(`about ${list(matched.slice(0, 3))}, as your question is`);
  if (full.length) why.push(`${list(full.slice(0, 4).map((f) => f.label.toLowerCase()))} noted for ${full.slice(0, 4).every((f) => f.share === 1) ? 'every option' : 'nearly every option'}`);
  if (key) why.push(key.by === 'you' ? `you picked ${String(key.ids.length)} of them, so results can be scored against your picks` : `sua picked ${String(key.ids.length)} of them (you haven't decided), which can stand in as an answer key`);
  if (ruledOut) why.push(`${String(ruledOut)} ruled out with a reason, which a good result should keep low`);
  if (running.length < 5) but.push(`only ${String(running.length)} options, so results will be coarse`);
  if (!facts.length || !full.length) but.push('few facts noted, so there is little for the agent to rank by');
  if (thin.length) but.push(`${thin[0].label.toLowerCase()} is missing for ${String(thin[0].missing)} of ${String(running.length)}`);
  if (words.length && !matched.length) but.push('not about what your question asks');

  const fill = filled.length ? filled.reduce((s, f) => s + f.share, 0) / filled.length : 0;
  const score = matched.length * 3 + Math.min(running.length, 20) / 20 + fill + (key ? 1 : 0) + (running.length < 5 ? -4 : 0);
  return { id: nb.id, title: nb.title, options: running.length, sample: names.slice(0, 3), matched, why, but, score, ...(key ? { key } : {}) };
}

/**
 * The notebooks an experiment could hold fixed, the best fit first. One is
 * marked suggested only when something speaks for it beyond size (it is
 * about the question, or it has an answer key) and it has five or more
 * options; a list shorter than that is ranked well below the rest.
 */
export function rankSetCandidates(candidates: readonly SetCandidate[]): SetCandidate[] {
  const out = candidates.filter((c) => c.options >= 2).sort((a, b) => b.score - a.score || b.options - a.options);
  const top = out[0];
  // Never one too small to tell anything from, however well it matches the question's words.
  if (top && top.options >= 5 && (top.matched.length || top.key) && (!out[1] || top.score > out[1].score)) out[0] = { ...top, suggested: true };
  return out;
}
