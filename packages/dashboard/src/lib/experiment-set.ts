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
import { extractTaggedJson, formatFieldValue, notebookViewData, rankOptions, rankBy, type Notebook, type NotebookEntry, type NotebookViewOption } from '@some-useful-agents/core';

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
  /** It is archived (found by searching; its options can still be copied). */
  archived?: boolean;
  key?: AnswerKey;
  /** What it is for, and the facts its options note (label, and for how many of them), for a reading of the question. */
  about: string;
  facts: Array<{ label: string; noted: number }>;
  /** Two of its options with their facts, as examples. */
  examples: Array<{ title: string; facts: Record<string, string> }>;
  /**
   * After sua read the question: the facts the experiment turns on, and for
   * how many options each is noted here. `as` is this notebook's own name
   * for the fact when it differs ("Remote status" for "Remote"); `noted` is
   * absent when it has no fact of that name at all.
   */
  turnsOn?: Array<{ label: string; noted?: number; as?: string }>;
  /** sua's sentence on why this one suits (only on the one it picked). */
  reading?: string;
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
  const examples = [...running].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 2).map((o) => ({
    title: o.title.slice(0, 120),
    facts: Object.fromEntries(facts.filter((f) => has(f, o)).slice(0, 8).map((f) => { let v = ''; try { v = formatFieldValue(f, o.fields[f.key]); } catch { v = String(o.fields[f.key]); } return [f.label, v.slice(0, 80)]; })),
  }));
  return {
    id: nb.id, title: nb.title, options: running.length, sample: names.slice(0, 3), matched, why, but, score, ...(key ? { key } : {}), ...(nb.archivedAt ? { archived: true } : {}),
    about: nb.statement.slice(0, 200), facts: filled.map((f) => ({ label: f.label, noted: running.length - f.missing })), examples,
  };
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

/** sua's reading of an experiment's question, after it has been checked against the sets. */
export interface SetAdvice {
  /** The facts the rankings will turn on, by a label a notebook notes, each with why. */
  turnsOn: Array<{ fact: string; because?: string }>;
  /** The notebook it picked, when it picked one of those listed. */
  pick?: string;
  why?: string;
  /** What the question needs that no set notes, in sua's words. */
  missing: string[];
}

/** The advisor's inputs: the question, what changes, and the sets as it may read them. Pure. */
export function setAdviceInputs(question: string, changes: string, candidates: readonly SetCandidate[], errors = ''): Record<string, string> {
  return {
    QUESTION: question.slice(0, 1000),
    CHANGES: changes.slice(0, 2000),
    SETS: JSON.stringify(candidates.slice(0, 12).map((c) => ({
      id: c.id, title: c.title, for: c.about, options: c.options,
      facts: c.facts.map((f) => ({ label: f.label, notedFor: `${String(f.noted)} of ${String(c.options)}` })),
      examples: c.examples,
    }))),
    ERRORS: errors ? `Your last answer couldn't be used: ${errors} Answer again, fixing that.` : '',
  };
}

/**
 * The advisor's answer as advice, or why it can't be used. A fact it names
 * stays only when a set notes a fact of that label (so it can be counted);
 * its pick stays only when it is one of the sets. With no fact left and no
 * pick, the answer says nothing and is refused. Pure.
 */
export function parseSetAdvice(raw: string | undefined, candidates: readonly SetCandidate[]): { advice: SetAdvice } | { error: string } {
  let v: Record<string, unknown>;
  try {
    const parsed = JSON.parse(extractTaggedJson(raw ?? '', 'advice') ?? 'null') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'It has no <advice> JSON object.' };
    v = parsed as Record<string, unknown>;
  } catch { return { error: 'Its <advice> block is not valid JSON.' }; }
  const line = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const labels = new Map(candidates.flatMap((c) => c.facts.map((f) => [f.label.toLowerCase(), f.label] as const)));
  const turnsOn: SetAdvice['turnsOn'] = [];
  for (const t of Array.isArray(v.turnsOn) ? v.turnsOn : []) {
    const fact = labels.get(line((t as { fact?: unknown } | null)?.fact, 80).toLowerCase());
    if (!fact || turnsOn.some((x) => x.fact === fact)) continue;
    const because = line((t as { because?: unknown }).because, 120);
    turnsOn.push({ fact, ...(because ? { because } : {}) });
    if (turnsOn.length === 4) break;
  }
  const pick = candidates.find((c) => c.id === line(v.pick, 200))?.id;
  if (!turnsOn.length && !pick) return { error: 'It names no fact that any set notes (copy a label exactly) and picks no listed set.' };
  const why = line(v.why, 240);
  const missing = (Array.isArray(v.missing) ? v.missing : []).map((m) => line(m, 60)).filter(Boolean).slice(0, 3);
  return { advice: { turnsOn, ...(pick ? { pick } : {}), ...(pick && why ? { why } : {}), missing } };
}

/**
 * The candidates with sua's reading laid over the counted ranking: each
 * says for how many of its options the facts the experiment turns on are
 * noted (counted here, not taken from the model); a set that notes them for
 * fewer than half is marked against. The suggestion moves to sua's pick
 * only when that set has five or more options and notes those facts for
 * most; otherwise the counted suggestion stands. Pure.
 */
export function applySetAdvice(candidates: readonly SetCandidate[], advice: SetAdvice): SetCandidate[] {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // A notebook may call the same fact something a little different: "Remote status" for "Remote", "Job title" for "Title".
  const same = (a: string, b: string) => { const x = words(a); const y = words(b); return x.length > 0 && y.length > 0 && (x.every((w) => y.includes(w)) || y.every((w) => x.includes(w))); };
  const out = candidates.map((c): SetCandidate => {
    const turnsOn = advice.turnsOn.map((t) => {
      const f = c.facts.find((x) => x.label === t.fact) ?? c.facts.find((x) => same(x.label, t.fact));
      return { label: t.fact, ...(f ? { noted: f.noted, ...(f.label !== t.fact ? { as: f.label } : {}) } : {}) };
    });
    const thin = turnsOn.filter((t) => t.noted !== undefined && t.noted * 2 < c.options);
    const absent = turnsOn.filter((t) => t.noted === undefined);
    return {
      ...c, turnsOn,
      but: [
        ...c.but.filter((b) => !(thin.length && / is missing for /.test(b))),
        ...(thin.length ? [`${thin.map((t) => t.label.toLowerCase()).join(' and ')}, which your question turns on, ${thin.length === 1 ? 'is' : 'are'} noted for ${thin.map((t) => String(t.noted)).join(' and ')} of ${String(c.options)}`] : []),
        ...(absent.length ? [`it notes nothing called ${absent.map((t) => t.label.toLowerCase()).join(' or ')}, which your question turns on`] : []),
      ],
    };
  });
  const pick = out.find((c) => c.id === advice.pick);
  const covered = (c: SetCandidate) => (c.turnsOn ?? []).every((t) => (t.noted ?? 0) * 2 >= c.options);
  if (pick && pick.options >= 5 && covered(pick)) {
    return [{ ...pick, suggested: true, ...(advice.why ? { reading: advice.why } : {}) }, ...out.filter((c) => c !== pick).map((c) => ({ ...c, suggested: undefined }))].map((c) => { const { suggested, ...rest } = c; return suggested ? c : rest; });
  }
  return out;
}
