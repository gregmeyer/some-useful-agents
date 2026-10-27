/**
 * A notebook's widgets: its layout (core notebook-layout.ts, rows of blocks)
 * as an A2UI view bound to the notebook's data (`/notebook/...`, the same
 * shape for every notebook), so the same components draw a car search, a job
 * hunt or a shopping list, and can be rearranged or placed on a board. The
 * default, the shortlist, follows the "notebook as a story" design (canvas
 * artboard 23):
 *
 *   Where it stands + stats (2/3)  | Done when (ring + steps, 1/3)
 *   Where they sit (map, 2/3)      | How far they got (funnel, 1/3)
 *   Shortlist (cards / table)
 *   Before you decide (1/3)        | How we got here (timeline, 2/3)
 *   Where sua looked (coverage)    | Limits (disagreements flagged)
 */
import { rankBy, rankOptions, isRange,
  notebookViewData, notebookLayoutOf, resolveNotebookLayout, splitNotebookHeader, resolvePointer, type NotebookLayout, type NotebookLayoutFlag, type NotebookLayoutValueKey, cleanData, fieldNumber, validateViewComponents, viewToMessages,
  type Notebook, type NotebookEntry, type NotebookField, type NotebookViewHistory, type NotebookViewData,
  type NotebookRange, type NotebookSearchSource, type NotebookViewOption, type ViewComponent,
  notebookChanges, type NotebookChange, type NotebookChangeKind, type NotebookFieldValue,
} from '@some-useful-agents/core';
import { formatFieldValue } from './field-format.js';

/** What the widgets read from the store beyond the view data: the searches. */
export interface NotebookWidgetHistory extends NotebookViewHistory {
  /** When the search before `before` ran (for what changed since). */
  searchBefore?(notebookId: string, before: string): string | undefined;
  searches?(notebookId: string, limit?: number): Array<{ agentId: string; runId?: string; at: string; found: number; sources: NotebookSearchSource[] }>;
  /** Recent runs of an agent (to show the ones that failed, which leave nothing in the notebook). */
  recentRuns?(agentId: string): Array<{ id: string; status: string; startedAt: string; error?: string }>;
  /** Who it's about that has a picture kept (a person's photo, a company's logo). */
  aboutPhotos?(notebookId: string): Set<string>;
  /** That picture, with the page it's on and why it's taken to be them. */
  aboutPhoto?(notebookId: string, who: 'person' | 'company'): { page?: string; why?: string } | undefined;
  /** The notebook's passes (its pipeline, steps and conversation runs), to tell its own failed runs from others. */
  passes?(notebookId: string, limit?: number): Array<{ runIds: string[] }>;
  /** The notebooks an agent works for (a failed run of an agent only this notebook uses is this notebook's). */
  notebooksFedBy?(agentId: string): string[];
}

/** Words a limit uses for a field's unit ("mi" → "miles"). */
const UNIT_WORDS: Record<string, string[]> = {
  mi: ['mi', 'mile', 'miles', 'mileage'],
  km: ['km', 'kilometers', 'kilometres'],
  'sq ft': ['sq ft', 'sqft', 'square feet'],
  min: ['min', 'mins', 'minute', 'minutes', 'commute'],
};

type Dim = 'price' | 'measure';

/** Each limit that names a range for the price or the main measure, in order. */
function limitRanges(nb: Pick<Notebook, 'params' | 'fields'>): Array<{ param: string; dim: Dim; range: NotebookRange }> {
  const range = (text: string): NotebookRange | undefined => {
    const v = cleanData({ r: text }, [{ key: 'r', label: 'r', type: 'number', range: true }]).r;
    return v && typeof v === 'object' && v.max > v.min ? v : undefined;
  };
  const measure = nb.fields.find((f) => f.role === 'measure');
  const words = measure?.unit ? (UNIT_WORDS[measure.unit.toLowerCase()] ?? [measure.unit.toLowerCase()]) : [];
  const out: Array<{ param: string; dim: Dim; range: NotebookRange }> = [];
  for (const p of nb.params) {
    const lower = p.toLowerCase();
    const r = range(p);
    if (!r) continue;
    // A year range ("2005-2013 model years") is neither.
    if (r.min >= 1900 && r.max <= 2100 && /year/.test(lower)) continue;
    const measureWords = words.some((w) => lower.includes(w));
    const priceWords = /\$|budget|price|salary|pay|rent/.test(lower);
    // A bare range with no unit ("3000-8000") is about the price.
    const bare = !measureWords && !/[a-z]{3,}/.test(lower.replace(/\d+\s*k\b/g, ''));
    if (priceWords || bare) out.push({ param: p, dim: 'price', range: r });
    else if (measureWords) out.push({ param: p, dim: 'measure', range: r });
  }
  return out;
}

/**
 * The ranges a notebook's limits set for its price and main measure, read from
 * their text: "$3k-$6k budget" → price 3000–6000, "130k-190k miles" → measure.
 * The latest limit that names a range wins.
 */
export function limitBands(nb: Pick<Notebook, 'params' | 'fields'>): { price?: NotebookRange; measure?: NotebookRange } {
  const out: { price?: NotebookRange; measure?: NotebookRange } = {};
  for (const l of limitRanges(nb)) out[l.dim] = l.range;
  return out;
}

/** The limits as chips; ranges for the same thing that disagree are flagged. */
export function limitChips(nb: Pick<Notebook, 'params' | 'fields'>): { chips: Array<{ text: string; tone?: 'warn'; title?: string }>; disagree: number } {
  const ranges = limitRanges(nb);
  const same = (a: NotebookRange, b: NotebookRange) => a.min === b.min && a.max === b.max;
  const conflicting = new Map<string, string>();
  for (const dim of ['price', 'measure'] as const) {
    const rs = ranges.filter((r) => r.dim === dim);
    for (const r of rs) {
      const other = rs.find((o) => o !== r && !same(o.range, r.range));
      if (other) conflicting.set(r.param, other.param);
    }
  }
  const pairs = new Set([...conflicting.entries()].map(([a, b]) => [a, b].sort().join('|')));
  return {
    chips: nb.params.map((p) => (conflicting.has(p)
      ? { text: `${p} ⚠`, tone: 'warn' as const, title: `Disagrees with "${conflicting.get(p)}". The latest one is used; tell sua which is right.` }
      : { text: p })),
    disagree: pairs.size,
  };
}

const money = (f: NotebookField | undefined, n: number | undefined) => (n === undefined ? '' : f?.type === 'money' ? `$${Math.round(n).toLocaleString('en-US')}` : n.toLocaleString('en-US'));

/** "fit 86", "$4,023": an option's ranking value, as the notebook says it. */
function rankText(rank: ReturnType<typeof rankBy>, o: NotebookViewOption | undefined): string {
  if (!o) return '';
  const v = rank.by === 'score' ? o.score : o.price;
  if (v === undefined) return '';
  if (rank.by === 'score') return `${(rank.field?.label ?? 'fit').toLowerCase()} ${v.toLocaleString('en-US')}`;
  // A range (a salary) reads as its range, not its midpoint.
  const raw = rank.field ? o.fields[rank.field.key] : undefined;
  return isRange(raw) ? `${money(rank.field, raw.min)}–${money(rank.field, raw.max)}` : money(rank.field, v);
}

const fmtAge = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return m < 60 ? `${String(m)}m ago` : m < 48 * 60 ? `${String(Math.round(m / 60))}h ago` : `${String(Math.round(m / 1440))}d ago`;
};

export interface NotebookWidgetData extends NotebookViewData {
  notebook: Omit<NotebookViewData['notebook'], 'options'> & {
    /**
     * Each option with its own page's address (`page`), for the chart and the
     * shortlist to link, and `facets`: the short label of each long fact it has
     * (lib/notebook-facets.ts), for the shortlist's filter chips.
     */
    options: Array<NotebookViewOption & { page: string; facets?: Record<string, string> }>;
    bands: { price?: NotebookRange; measure?: NotebookRange };
    summary: string;
    next: string;
    statItems: Array<{ label: string; value: string; tone?: string; sub?: string }>;
    steps: Array<{ text: string; met: boolean; note?: string }>;
    limitChips: Array<{ text: string; tone?: string; title?: string }>;
    limitsNote: string;
    coverage: { sources: NotebookSearchSource[]; when: string };
    checklist: Array<{ id: string; title: string; items: Array<{ text: string; done: boolean }> }>;
    timeline: Array<{ at: string; title: string; body?: string; kind?: string; who?: string; tag?: string; link?: string; linkText?: string; faded?: boolean; empty?: boolean }>;
    shortlistNote: string;
    /** What each option says (its `quote` field), chosen first, grouped by its short label (QuoteList). */
    quotes: Array<{ title: string; quote: string; href: string; source?: string; at?: string; ask?: string; group?: string; chosen?: boolean }>;
    /** The talking points sua wrote (a write step), each with why and what they said it rests on; else the chosen options (else the first 5) with their questions (Agenda). */
    talkingPoints: Array<{ text: string; note?: string; refs: Array<{ label: string; href: string }> }>;
    /** Questions to ask: the ones sua wrote, else the other options' (their `ask` field) (Agenda questions). */
    questions: Array<{ text: string; label?: string; href?: string }>;
    /** What to watch for in the meeting, from what sua wrote (Agenda watch). */
    watch: string[];
    /** Where to edit the talking points sua wrote (none before there are any) (Agenda editHref). */
    talkingPointsEdit?: string;
    /** The answer a write step wrote, as a Callout; before then, where it stands (the Answer page). */
    answer: { question: string; label: string; text: string; next?: string; nextLabel: string };
    /** The findings the answer rests on, each linked to its sources (Agenda points). */
    findings: Array<{ text: string; refs: Array<{ label: string; href: string }> }>;
    /** What the answer leaves open (Agenda questions). */
    openQuestions: Array<{ text: string }>;
    /** The plan a write step wrote, as a Callout; before then, where it stands (the Plan page). */
    planIntro: { label: string; text: string; next?: string };
    /** The plan by day or slot, each item linked to the options it uses (Itinerary days). */
    planDays: Array<{ when: string; items: Array<{ text: string; note?: string; refs: Array<{ label: string; href: string }> }> }>;
    /** To book or do first, and what's still open (Itinerary before / open). */
    planBefore: Array<{ text: string }>;
    planOpen: Array<{ text: string }>;
    /** What changed since the search before the latest, as a Callout (the Watch page). */
    changesIntro: { label: string; text: string; next?: string };
    /** Those changes, newest kinds first (Changes items). */
    changes: Array<{ kind: NotebookChangeKind; title: string; detail?: string; href: string; tone?: 'ok' | 'warn' }>;
    /** Who it's about (a profile step learned it), for ProfileCard: the person and their company. */
    person?: NotebookProfileView;
    company?: NotebookProfileView;
    /** What was learned about them, each with its source, for FactSheet. */
    facts: Array<{ label: string; value: string; url?: string; group: string }>;
    /** What was looked for about them and not found. */
    notFound: string[];
    /** The first thing they said (the top quote), for a cover's pull quote. */
    leadQuote?: string;
    /** The quotes after that one (so a page with the pull quote doesn't repeat it). */
    otherQuotes: NotebookWidgetData['notebook']['quotes'];
    /** What was learned about the person, and about their company, apart (FactSheet beside each). */
    personFacts: NotebookWidgetData['notebook']['facts'];
    companyFacts: NotebookWidgetData['notebook']['facts'];
    /** Kept for older layouts and boards. */
    stats: { active: string; best: string; bestLabel: string; furthest: string; ruledOut: string };
  };
}

/** Where an option's own page is. */
export function notebookOptionPath(notebookId: string, entryId: string): string {
  return `/notebooks/${encodeURIComponent(notebookId)}/entries/${encodeURIComponent(entryId)}`;
}

/** A fact's value as facets are keyed: its text, spaces collapsed. */
export const facetValueKey = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * An option's short labels for the notebook's long facts (undefined when
 * none). A value not labelled yet reads '' (no chip) rather than its sentence.
 */
export function optionFacets(nb: Pick<Notebook, 'facets'>, o: Pick<NotebookViewOption, 'fields'>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, f] of Object.entries(nb.facets ?? {})) {
    const value = facetValueKey(o.fields[key]);
    if (value && Object.keys(f.labels).length) out[key] = f.labels[value] ?? '';
  }
  return Object.keys(out).length ? out : undefined;
}

/** The checks for options: the notebook's own, else "Still listed" plus the unmet done-whens. */
export function checksFor(nb: Pick<Notebook, 'checks' | 'criteria'>): string[] {
  if (nb.checks.length) return nb.checks;
  return ['Still listed', ...nb.criteria.filter((c) => !c.met && !/decid/i.test(c.text)).map((c) => c.text.charAt(0).toUpperCase() + c.text.slice(1))].slice(0, 5);
}

/** The notebook's data plus what the default widgets show. */
export function notebookWidgetData(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory, now = Date.now()): NotebookWidgetData {
  const { notebook: v } = notebookViewData(nb, entries, history);
  const priceF = nb.fields.find((f) => f.role === 'price');
  // Best first by the notebook's score field (how well it fits) when it has one, else by price.
  const rank = rankBy(nb);
  const better = rank.better;
  const active = rankOptions(nb, v.options);
  const best = active.find((o) => (rank.by === 'score' ? o.score : o.price) !== undefined);
  const furthest = [...v.funnel].reverse().find((s) => s.here > 0)?.stage ?? '';
  const nextCriterion = v.criteria.find((c) => !c.met)?.text;
  const searches = history?.searches?.(nb.id, 20) ?? [];
  const checks = checksFor(nb);
  const top = active.slice(0, 2);
  const checkedTop = top.reduce((n, o) => n + (o.checked.length >= checks.length && checks.length ? 1 : 0), 0);

  const second = active.filter((o) => (rank.by === 'score' ? o.score : o.price) !== undefined)[1];
  // What's left: options whose checks aren't all ticked, ones without their own page, and the steps to go.
  const own = nb.checks.length ? nb.checks : [];
  const toCheck = own.length ? active.filter((o) => own.some((c) => !o.checked.some((d) => d.toLowerCase() === c.toLowerCase()))).length : 0;
  const linkF = nb.fields.find((f) => f.role === 'link');
  const noOwnLink = linkF ? active.filter((o) => !o.link || o.linkIsList).length : 0;
  const stepWord = (k: string) => (k === 'narrow' ? 'Narrow' : k === 'decide' ? 'Decide' : k === 'check' ? 'check' : k === 'source' ? 'source' : 'find');
  const stepsLeft = (nb.steps ?? []).filter((x) => x.status !== 'done').map((x) => `${x.title} (${stepWord(x.kind)})`);
  const leftLine = [
    toCheck ? `**${String(toCheck)} of ${String(active.length)} still to check**` : own.length && active.length ? 'every one checked' : '',
    noOwnLink ? `**${String(noOwnLink)} without their own ${(linkF?.label ?? 'listing').replace(/\s*(url|link)$/i, '').toLowerCase() || 'page'}**` : '',
  ].filter(Boolean).join(', ');
  const stepsLine = stepsLeft.length ? `**Steps left:** ${stepsLeft.length === 1 ? stepsLeft[0] : `${stepsLeft.slice(0, -1).join(', ')}, then ${stepsLeft[stepsLeft.length - 1]}`}.` : '';
  // Decided with picks: where it stands is the final set.
  const chosen = active.filter((o) => o.chosen);
  const bestChosen = chosen.find((o) => (rank.by === 'score' ? o.score : o.price) !== undefined);
  const decided = nb.status === 'decided' && chosen.length > 0;
  const summary = decided
    ? [
      `**Decided: ${String(chosen.length)} chosen**, of ${String(active.length)} in the running.`,
      chosen.length <= 3 ? `${chosen.map((o) => o.name).join(', ')}.` : '',
      bestChosen && chosen.length > 1 ? `The ${rank.by === 'score' ? 'best fit' : 'best lead'} among them is the **${bestChosen.name}**: ${rankText(rank, bestChosen)}.` : '',
    ].filter(Boolean).join(' ')
    : active.length === 0
    ? (v.options.length ? `All ${String(v.options.length)} options are ruled out.` : 'No options yet. Ask sua to search, or tell it about one you saw.')
    : [
      `**${String(active.length)} in the running**${searches.length ? ` after ${String(searches.length)} search${searches.length === 1 ? '' : 'es'}` : ''}${v.ruledOutCount ? `, ${String(v.ruledOutCount)} ruled out` : ''}.`,
      leftLine ? `${leftLine.charAt(0).toUpperCase()}${leftLine.slice(1)}.` : '',
      best ? `The ${rank.by === 'score' ? 'best fit' : 'best lead'} is the **${best.name}**: ${rankText(rank, best)}${rank.by === 'score' && best.price !== undefined ? `, ${money(priceF, best.price)}` : ''}${best.measure !== undefined ? `, ${best.measure.toLocaleString('en-US')} ${(() => { const mf = nb.fields.find((f) => f.role === 'measure'); return mf?.unit ?? (mf?.label ?? '').toLowerCase(); })()}`.trimEnd() : ''}${best.place ? `, in ${best.place}` : ''}.` : '',
      second && best && rankText(rank, second)
        ? (rank.by === 'score' ? `Next best: ${second.name} (${rankText(rank, second)}).` : `Next best: ${second.name} at ${rankText(rank, second)}.`)
        : '',
      furthest && furthest !== v.stages[0] ? `Furthest along: ${furthest}.` : '',
      stepsLine,
    ].filter(Boolean).join(' ');
  const listLinks = active.filter((o) => o.linkIsList).length;
  const next = decided
    ? 'reopen it if something changes; anything sua learns is still kept here.'
    : active.length === 0
    ? 'ask sua to search again, or bring one back.'
    // Most only link to a search page: their own pages come first (a source step on the link finds them).
    : listLinks * 2 >= active.length && listLinks > 1
      ? `find each one's own ${(nb.fields.find((f) => f.role === 'link')?.label ?? 'listing').toLowerCase()}: ${String(listLinks)} of ${String(active.length)} link to a search page. Ask sua for a step that finds them.`
    : top.length && checks.length && checkedTop < top.length
      ? `check ${checks.slice(0, 2).map((c) => c.toLowerCase()).join(' and ')} on the top ${top.length === 1 ? 'one' : 'two'} before you contact anyone.`
      : nextCriterion ? `${nextCriterion}.` : 'decide.';

  const { chips, disagree } = limitChips(nb);
  const latestWithSources = searches.find((s) => s.sources.length);
  const outOptions = v.options.filter((o) => o.ruledOut);

  const timeline: NotebookWidgetData['notebook']['timeline'] = [];
  for (const s of searches) {
    timeline.push({
      at: s.at, kind: 'search', who: s.agentId,
      title: s.found ? `Search returned ${String(s.found)} option${s.found === 1 ? '' : 's'}` : 'Search returned no options',
      ...(s.found ? {} : { empty: true }),
      ...(s.sources.length ? { body: s.sources.map((x) => `${x.name} ${x.status === 'found' ? String(x.found) : x.status}`).join(' · ') } : {}),
      ...(s.runId ? { link: `/runs/${encodeURIComponent(s.runId)}`, linkText: `run ${s.runId.slice(0, 8)}` } : {}),
    });
  }
  // Runs from before searches were recorded: rebuilt from the options each run added.
  const recorded = new Set(searches.map((s) => s.runId).filter(Boolean));
  const byRun = new Map<string, { at: string; agent: string; options: number }>();
  for (const e of entries) {
    if (!e.runId || recorded.has(e.runId) || !e.by.startsWith('agent:')) continue;
    const g = byRun.get(e.runId) ?? { at: e.createdAt, agent: e.by.slice('agent:'.length), options: 0 };
    if (e.createdAt < g.at) g.at = e.createdAt;
    if (e.kind === 'option') g.options++;
    byRun.set(e.runId, g);
  }
  for (const [runId, g] of byRun) {
    timeline.push({
      at: g.at, kind: 'search', who: g.agent,
      title: g.options ? `Search returned ${String(g.options)} option${g.options === 1 ? '' : 's'}` : 'Search added notes, no options',
      link: `/runs/${encodeURIComponent(runId)}`, linkText: `run ${runId.slice(0, 8)}`,
    });
  }
  // Runs of the agents that feed it that failed (they leave nothing in the
  // notebook): ones run for this notebook, and any of an agent only this
  // notebook uses. A shared agent's failures for another notebook aren't this one's.
  if (history?.recentRuns && history.passes) {
    const ours = new Set(history.passes(nb.id, 200).flatMap((p) => p.runIds));
    const onlyOurs = (agentId: string) => !!history.notebooksFedBy && history.notebooksFedBy(agentId).every((id) => id === nb.id);
    const feeders = new Set([...nb.pipeline, ...searches.map((s) => s.agentId), ...[...byRun.values()].map((g) => g.agent)]);
    for (const agentId of feeders) {
      for (const r of history.recentRuns(agentId)) {
        if (r.status !== 'failed' || r.startedAt < nb.createdAt || !(ours.has(r.id) || onlyOurs(agentId))) continue;
        timeline.push({
          at: r.startedAt, kind: 'search', who: agentId, faded: true,
          title: 'Search failed', ...(r.error ? { body: clip(r.error, 140) } : {}),
          link: `/runs/${encodeURIComponent(r.id)}`, linkText: `run ${r.id.slice(0, 8)}`,
        });
      }
    }
  }
  for (const o of outOptions) {
    timeline.push(o.ruledOut!.gone
      ? { at: o.ruledOut!.at, kind: 'out', title: `No longer available: ${o.name}`, faded: true }
      : { at: o.ruledOut!.at, kind: 'out', title: `Ruled out: ${o.name}`, body: o.ruledOut!.reason });
  }
  for (const e of entries) {
    if (e.kind === 'option') {
      if (e.stage && e.stageAt && e.stage !== nb.stages[0] && !e.ruledOut) timeline.push({ at: e.stageAt, kind: 'move', title: `${shortOf(e.title)} → ${e.stage}` });
      continue;
    }
    if (/^Met: /.test(e.title)) continue;
    timeline.push({ at: e.createdAt, kind: e.kind, title: e.title, ...(e.body ? { body: clip(e.body, 150) } : {}), ...(e.runId ? { link: `/runs/${encodeURIComponent(e.runId)}`, linkText: `run ${e.runId.slice(0, 8)}` } : {}) });
  }
  timeline.push({ at: nb.createdAt, kind: 'decision', title: 'Notebook started', ...(nb.statement ? { body: nb.statement } : {}) });
  timeline.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const { quotes, talkingPoints, questions, watch } = whatTheySaid(nb, active);
  const about = aboutViews(nb, history?.aboutPhotos?.(nb.id) ?? new Set(), history?.aboutPhoto ? (who) => history.aboutPhoto!(nb.id, who) : undefined);

  return {
    notebook: {
      ...v,
      quotes,
      talkingPoints,
      questions,
      watch,
      ...(nb.briefing?.points.length ? { talkingPointsEdit: `/notebooks/${encodeURIComponent(nb.id)}/talking-points` } : {}),
      ...about,
      ...(quotes[0]?.quote ? { leadQuote: quotes[0].quote } : {}),
      otherQuotes: quotes.slice(1),
      personFacts: about.facts.filter((f) => f.group === nb.about?.person?.name),
      companyFacts: about.facts.filter((f) => f.group === nb.about?.company?.name && f.group !== nb.about?.person?.name),
      options: v.options.map((o) => {
        const facets = optionFacets(nb, o);
        return { ...o, page: notebookOptionPath(nb.id, o.id), ...(facets ? { facets } : {}) };
      }),
      bands: limitBands(nb),
      summary,
      next,
      ...answerViews(nb, active, summary, next),
      ...planViews(nb, active, summary, next),
      ...changesViews(nb, v.options, history, summary, next),
      statItems: [
        { label: 'in the running', value: String(active.length), tone: 'ok' },
        rank.by === 'score'
          ? { label: `best ${(rank.field?.label ?? 'fit').toLowerCase()}`, value: best?.score !== undefined ? best.score.toLocaleString('en-US') : '—', ...(best ? { sub: best.name.split(' ').slice(0, 3).join(' ') } : {}) }
          : { label: `best ${better === 'higher' ? (priceF?.label ?? 'pay').toLowerCase() : (priceF?.label ?? 'price').toLowerCase()}`, value: best ? money(priceF, best.price) : '—', ...(best ? { sub: best.name.split(' ').slice(0, 3).join(' ') } : {}) },
        { label: 'furthest along', value: furthest || '—' },
        { label: 'ruled out', value: String(v.ruledOutCount), ...(v.ruledOutCount ? { tone: 'warn' } : {}) },
      ],
      steps: v.criteria.map((c, i) => ({
        text: c.text.charAt(0).toUpperCase() + c.text.slice(1), met: c.met,
        ...(c.met ? {} : i === v.criteria.findIndex((x) => !x.met) && top.length ? { note: `start with the top ${top.length === 1 ? 'one' : 'two'}` } : {}),
      })),
      limitChips: chips,
      limitsNote: disagree ? `${String(disagree)} disagree` : '',
      coverage: { sources: latestWithSources?.sources ?? [], when: latestWithSources ? `last search · ${fmtAge(latestWithSources.at, now)}` : '' },
      checklist: top.map((o, i) => ({ id: o.id, title: `#${String(i + 1)} · ${o.name}`, items: checks.map((c) => ({ text: c, done: o.checked.includes(c) })) })),
      timeline: timeline.slice(0, 80),
      shortlistNote: `ranked by ${(rank.field?.label ?? 'price').toLowerCase()}${better === 'higher' ? ', highest first' : ''}`,
      stats: {
        active: String(active.length),
        best: best ? rankText(rank, best) || '—' : '—',
        bestLabel: `Best ${better === 'higher' ? (priceF?.label ?? 'pay').toLowerCase() : (priceF?.label ?? 'price').toLowerCase()}`,
        furthest: furthest || '—',
        ruledOut: String(v.ruledOutCount),
      },
    },
  };
}

/** A person or company as ProfileCard shows it. */
export interface NotebookProfileView { name: string; role?: string; org?: string; about?: string; image?: string; imageFrom?: string; imageWhy?: string; rejectHref?: string; links: Array<{ label: string; url: string }>; asOf: string }

/** Where a kept picture of who a notebook is about is served. */
export function notebookAboutPhotoPath(notebookId: string, who: string): string {
  return `/notebooks/${encodeURIComponent(notebookId)}/about/${encodeURIComponent(who)}/photo`;
}

/** Who the notebook is about, for ProfileCard and FactSheet. Pure but for the pictures it's told about. */
function aboutViews(nb: Notebook, photos: ReadonlySet<string>, photoFrom?: (who: 'person' | 'company') => { page?: string; why?: string } | undefined): Pick<NotebookWidgetData['notebook'], 'person' | 'company' | 'facts' | 'notFound'> {
  const fact = (who: 'person' | 'company', key: string) => nb.about?.[who]?.facts.find((f) => f.key === key)?.value;
  const asOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const link = (label: string, url: string | undefined) => (url && /^https?:\/\//i.test(url) ? [{ label, url }] : []);
  const siteName = (u: string | undefined) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };
  const p = nb.about?.person;
  const c = nb.about?.company;
  const person: NotebookProfileView | undefined = p ? {
    name: p.name,
    ...(fact('person', 'role') ? { role: fact('person', 'role') } : {}),
    ...(c?.name || fact('person', 'organization') ? { org: c?.name || fact('person', 'organization') } : {}),
    ...(p.summary || fact('person', 'known_for') ? { about: p.summary || fact('person', 'known_for') } : {}),
    ...(photos.has('person') ? ((): Partial<NotebookProfileView> => {
      // Where their photo came from, and Not them, so you can check it's them.
      const from = photoFrom?.('person');
      return { image: notebookAboutPhotoPath(nb.id, 'person'), rejectHref: `${notebookAboutPhotoPath(nb.id, 'person')}/reject`, ...(from?.page ? { imageFrom: from.page } : {}), ...(from?.why ? { imageWhy: from.why } : {}) };
    })() : {}),
    links: [...link('LinkedIn', fact('person', 'linkedin')), ...link(siteName(fact('person', 'website')) || 'Their site', fact('person', 'website'))],
    asOf: asOf(p.updatedAt),
  } : undefined;
  const company: NotebookProfileView | undefined = c ? {
    name: c.name,
    ...(fact('company', 'what_they_do') ? { role: fact('company', 'what_they_do') } : {}),
    ...(fact('company', 'headquarters') ? { org: fact('company', 'headquarters') } : {}),
    ...(c.summary ? { about: c.summary } : {}),
    ...(photos.has('company') ? { image: notebookAboutPhotoPath(nb.id, 'company') } : {}),
    links: link(siteName(fact('company', 'website')) || 'Website', fact('company', 'website')),
    asOf: asOf(c.updatedAt),
  } : undefined;
  // Links show on the card, so the sheet leaves them out.
  const linkKeys = new Set(['linkedin', 'website', 'company_website']);
  const rows = (one: typeof p) => (one ? one.facts.filter((f) => !linkKeys.has(f.key)).map((f) => ({ label: f.label, value: f.value, ...(f.source ? { url: f.source } : {}), group: one.name })) : []);
  return {
    ...(person ? { person } : {}),
    ...(company ? { company } : {}),
    facts: [...rows(p), ...rows(c)],
    notFound: [...new Set([...(p?.notFound ?? []), ...(c?.notFound ?? [])])],
  };
}

const shortOf = (title: string) => title.split(',')[0].trim();

/**
 * The options as a briefing reads them: what each says (its `quote` field),
 * the points to raise (the chosen ones, else the first 5) with their questions
 * (`ask`), and the rest's questions. Grouped by the short label of the
 * notebook's first labelled fact (a theme). Ruled-out options aren't in it.
 */
function whatTheySaid(nb: Notebook, active: readonly NotebookViewOption[]): Pick<NotebookWidgetData['notebook'], 'quotes' | 'talkingPoints' | 'questions' | 'watch'> {
  const quoteF = nb.fields.find((f) => f.role === 'quote');
  const askF = nb.fields.find((f) => f.role === 'ask');
  const groupKey = nb.fields.find((f) => !f.role && f.type === 'text' && Object.keys(nb.facets?.[f.key]?.labels ?? {}).length)?.key;
  const text = (o: NotebookViewOption, key: string | undefined) => (key && typeof o.fields[key] === 'string' ? (o.fields[key] as string).trim() : '');
  const ordered = [...active.filter((o) => o.chosen), ...active.filter((o) => !o.chosen)];
  const page = (o: NotebookViewOption) => notebookOptionPath(nb.id, o.id);
  const quotes = quoteF ? ordered.filter((o) => text(o, quoteF.key)).map((o) => {
    const group = groupKey ? (nb.facets?.[groupKey]?.labels[facetValueKey(o.fields[groupKey])] || text(o, groupKey)) : '';
    const ask = text(o, askF?.key);
    return {
      title: o.name, quote: text(o, quoteF.key), href: page(o),
      ...(o.link ? { source: o.link } : {}), ...(o.when ? { at: o.when } : {}), ...(ask ? { ask } : {}), ...(group ? { group } : {}), ...(o.chosen ? { chosen: true } : {}),
    };
  }) : [];
  // Written (a write step): its points, each linked to what they said that it rests on (ones since ruled out drop off).
  if (nb.briefing?.points.length) {
    const byId = new Map(active.map((o) => [o.id, o]));
    return {
      quotes,
      talkingPoints: nb.briefing.points.map((p) => {
        const note = [p.why, p.ask ? `Ask: ${p.ask}` : ''].filter(Boolean).join(' ');
        return { text: p.text, ...(note ? { note } : {}), refs: p.from.map((id) => byId.get(id)).filter((o): o is NotebookViewOption => !!o).map((o) => ({ label: o.name, href: page(o) })) };
      }),
      questions: nb.briefing.questions.map((q) => ({ text: q })),
      watch: nb.briefing.watch,
    };
  }
  if (!quoteF && !askF) return { quotes, talkingPoints: [], questions: [], watch: [] };
  const chosen = ordered.filter((o) => o.chosen);
  const points = (chosen.length ? chosen : ordered.slice(0, 5)).slice(0, 8);
  const talkingPoints = points.map((o) => {
    const ask = text(o, askF?.key);
    return { text: o.name, ...(ask ? { note: ask } : {}), refs: [{ label: quoteF ? 'what they said' : 'open', href: page(o) }] };
  });
  const inPoints = new Set(points.map((o) => o.id));
  const questions = askF ? ordered.filter((o) => !inPoints.has(o.id) && text(o, askF.key)).slice(0, 8).map((o) => ({ text: text(o, askF.key), label: o.name, href: page(o) })) : [];
  return { quotes, talkingPoints, questions, watch: [] };
}

/** At most `n` characters, cut at a word, with "…". */
function clip(text: string, n: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n * 0.6)).replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * What the shortlist can be filtered by: new in the last run or not, still listed or not, its stage, and
 * the notebook's text facts (a seller, a body style). The grid shows a filter
 * only when options differ on it, so listing every candidate is safe.
 */
export function defaultFilters(nb: Pick<Notebook, 'fields' | 'stages'> & { steps?: Notebook['steps'] }): string[] {
  const text = nb.fields.filter((f) => f.type === 'text' && f.role !== 'link' && f.role !== 'image').map((f) => f.key);
  return ['added', 'seen', ...(nb.stages.length && !handStagesHidden(nb) ? ['stage'] : []), ...text].slice(0, 9);
}

/** A notebook with steps: they say how far each option got, so stages moved by hand aren't shown. */
export function handStagesHidden(nb: { steps?: Notebook['steps'] }): boolean {
  return (nb.steps?.length ?? 0) > 1;
}

type LayoutNotebook = Pick<Notebook, 'fields' | 'stages' | 'steps'> & { id?: string; status?: Notebook['status']; layout?: NotebookLayout; about?: Notebook['about']; answer?: Notebook['answer']; plan?: Notebook['plan'] };

/** The plan for the Plan page: what sua wrote, in its order, grouped by day or slot, each item linked to the options it uses; before then, where it stands. */
function planViews(nb: Notebook, active: readonly NotebookViewOption[], summary: string, next: string | undefined): Pick<NotebookWidgetData['notebook'], 'planIntro' | 'planDays' | 'planBefore' | 'planOpen'> {
  const p = nb.plan;
  if (!p?.items.length) return { planIntro: { label: 'Where it stands', text: summary, ...(next ? { next } : {}) }, planDays: [], planBefore: [], planOpen: [] };
  const byId = new Map(active.map((o) => [o.id, o]));
  const days: NotebookWidgetData['notebook']['planDays'] = [];
  for (const it of p.items) {
    // Items keep the writer's order; one day's run of items is one group.
    const day = days.at(-1)?.when === it.when ? days.at(-1)! : (days.push({ when: it.when, items: [] }), days.at(-1)!);
    day.items.push({ text: it.title, ...(it.detail ? { note: it.detail } : {}), refs: it.from.map((id) => byId.get(id)).filter((o): o is NotebookViewOption => !!o).map((o) => ({ label: o.name, href: notebookOptionPath(nb.id, o.id) })) });
  }
  return { planIntro: { label: 'The plan', text: p.summary || `${String(p.items.length)} things, in order.` }, planDays: days, planBefore: p.before.map((text) => ({ text })), planOpen: p.open.map((text) => ({ text })) };
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const CHANGE_WORDS: Record<NotebookChangeKind, [string, string]> = { new: ['new', 'new'], price: ['price change', 'price changes'], changed: ['change', 'changes'], gone: ['gone', 'gone'], missing: ['not seen lately', 'not seen lately'] };

/**
 * What changed since the search before the latest (core notebookChanges), for
 * the Watch page: a line saying so ("Since Oct 24: 2 new, 1 price change"),
 * and each change with its option's page, a price change as better or worse
 * by the field's direction. Before any search, where it stands.
 */
function changesViews(nb: Notebook, options: readonly NotebookViewOption[], history: NotebookWidgetHistory | undefined, summary: string, next: string | undefined): Pick<NotebookWidgetData['notebook'], 'changesIntro' | 'changes'> {
  const c = notebookChanges(nb, options, history);
  if (!c.at) return { changesIntro: { label: 'Where it stands', text: summary, ...(next ? { next } : {}) }, changes: [] };
  if (c.first) return { changesIntro: { label: `First look · ${shortDay(c.at)}`, text: `The first search found ${String(c.seen)}. Next time, this says what changed since.` }, changes: [] };
  const fmt = (f: NonNullable<NotebookChange['field']>, v: NotebookFieldValue | undefined) => (v === undefined ? '' : formatFieldValue(f as NotebookField, v));
  const priceF = nb.fields.find((f) => f.role === 'price');
  const byId = new Map(options.map((o) => [o.id, o]));
  const changes = c.changes.map((x): NotebookWidgetData['notebook']['changes'][number] => {
    const href = notebookOptionPath(nb.id, x.id);
    if ((x.kind === 'price' || x.kind === 'changed') && x.field) {
      const a = fieldNumber(x.from);
      const b = fieldNumber(x.to);
      const better = x.kind === 'price' && a !== undefined && b !== undefined ? ((b < a) === ((priceF?.better ?? 'lower') === 'lower')) : undefined;
      return { kind: x.kind, title: x.name, detail: `${x.field.label}: ${fmt(x.field, x.from)} → ${fmt(x.field, x.to)}`, href, ...(better !== undefined ? { tone: better ? 'ok' as const : 'warn' as const } : {}) };
    }
    if (x.kind === 'gone') return { kind: x.kind, title: x.name, ...(x.reason ? { detail: x.reason } : {}), href, tone: 'warn' };
    if (x.kind === 'missing') return { kind: x.kind, title: x.name, detail: 'Not in the last 2 searches. It may be sold, filled or taken down.', href };
    // New: what tells it apart (who, where, what it costs).
    const o = byId.get(x.id);
    const what = o ? [o.org, o.place, o.price !== undefined && priceF ? formatFieldValue(priceF, o.price) : undefined].filter((v): v is string => !!v && !x.name.includes(v)).join(' · ') : '';
    return { kind: x.kind, title: x.name, ...(what ? { detail: what } : {}), href, tone: 'ok' };
  });
  const counts = (Object.keys(CHANGE_WORDS) as NotebookChangeKind[]).map((k) => [k, new Set(c.changes.filter((x) => x.kind === k).map((x) => x.id)).size] as const).filter(([, n]) => n > 0);
  const text = counts.length
    ? `${counts.map(([k, n]) => `**${String(n)}** ${CHANGE_WORDS[k][n === 1 ? 0 : 1]}`).join(', ')}.`
    : 'Nothing changed: the same options, at the same prices.';
  return { changesIntro: { label: `Since ${shortDay(c.since!)} · checked ${shortDay(c.at)}`, text }, changes };
}

/** How sure an answer is, in plain words. */
const SURE: Record<NonNullable<Notebook['answer']>['confidence'], string> = { high: 'sure', medium: 'fairly sure', low: 'not sure yet' };

/** The answer for the Answer page: what sua wrote, each finding linked to the options it rests on; before then, where it stands. */
function answerViews(nb: Notebook, active: readonly NotebookViewOption[], summary: string, next: string | undefined): Pick<NotebookWidgetData['notebook'], 'answer' | 'findings' | 'openQuestions'> {
  const a = nb.answer;
  const question = nb.statement || nb.title;
  if (!a?.text) return { answer: { question, label: 'Where it stands', text: summary, ...(next ? { next } : {}), nextLabel: 'Next:' }, findings: [], openQuestions: [] };
  const byId = new Map(active.map((o) => [o.id, o]));
  return {
    answer: { question, label: `Answer · ${SURE[a.confidence]}`, text: a.text, ...(a.basis ? { next: a.basis } : {}), nextLabel: 'How sure:' },
    findings: a.findings.map((f) => ({ text: f.text, refs: f.from.map((id) => byId.get(id)).filter((o): o is NotebookViewOption => !!o).map((o) => ({ label: o.name, href: notebookOptionPath(nb.id, o.id) })) })),
    openQuestions: a.open.map((text) => ({ text })),
  };
}

/** What a layout's `when` tests, for this notebook (core NOTEBOOK_LAYOUT_FLAGS). */
export function notebookLayoutFlags(nb: LayoutNotebook, hasOptions = true): Record<NotebookLayoutFlag, boolean> {
  return {
    map: !!(nb.fields.some((f) => f.role === 'price') && nb.fields.some((f) => f.role === 'measure')),
    // With steps the funnel is the steps (notebookViewData); else the stages.
    funnel: (nb.steps?.length ?? 0) > 1 || nb.stages.length > 1,
    steps: (nb.steps?.length ?? 0) > 0,
    options: hasOptions,
    decided: nb.status === 'decided',
    about: !!(nb.about?.person || nb.about?.company),
    person: !!nb.about?.person,
    company: !!nb.about?.company,
    answered: !!nb.answer?.text,
    planned: !!nb.plan?.items.length,
  };
}

/** The settings a layout reads from `/notebook/layout/<key>`, for this notebook (core NOTEBOOK_LAYOUT_VALUES). */
export function notebookLayoutValues(nb: LayoutNotebook): Partial<Record<NotebookLayoutValueKey, unknown>> {
  const priceF = nb.fields.find((f) => f.role === 'price');
  const measureF = nb.fields.find((f) => f.role === 'measure');
  const scoreF = nb.fields.find((f) => f.role === 'score');
  return {
    ...(priceF && measureF ? { mapNote: `${priceF.label.toLowerCase()} by ${measureF.label.toLowerCase()} · your limits shaded` } : {}),
    ...(measureF ? { xLabel: measureF.label, xFormat: measureF.type === 'money' ? 'money' : 'number', ...(measureF.better ? { xBetter: measureF.better } : {}) } : {}),
    ...(priceF ? { yLabel: priceF.label, yFormat: priceF.type === 'money' ? 'money' : 'number', yBetter: priceF.better ?? 'lower' } : {}),
    sort: scoreF ? `${scoreF.key} ${scoreF.better === 'lower' ? 'asc' : 'desc'}` : 'price',
    filters: defaultFilters(nb),
    ...(handStagesHidden(nb) ? { stageChips: false } : {}),
    ...(nb.id ? { csvHref: `/notebooks/${encodeURIComponent(nb.id)}/shortlist.csv` } : {}),
    ...(nb.status === 'decided' ? { onlyChosen: true } : {}),
  };
}

/**
 * The notebook's page as plain A2UI: its layout (an A2UI document; the
 * shortlist when it has none) with its `when`s and `/notebook/layout/`
 * settings worked out for this notebook (core resolveNotebookLayout).
 */
export function notebookWidgetComponents(nb: LayoutNotebook, layout: NotebookLayout = notebookLayoutOf(nb), data?: NotebookWidgetData): ViewComponent[] {
  return resolveNotebookLayout(layout.components, notebookLayoutFlags(nb), notebookLayoutValues(nb), emptyPartsGo(layout, data));
}

/**
 * A drawn page leaves out parts with nothing in them yet (core
 * resolveNotebookLayout); the shortlist keeps every part, as it always has.
 */
export function emptyPartsGo(layout: NotebookLayout, data: unknown): { data?: unknown } {
  return data !== undefined && layout.preset !== 'shortlist' ? { data } : {};
}

/** The notebook's page as drawn for it now: its layout resolved, with the header (if it has one) taken out. */
function resolvedPage(nb: Notebook, entries: readonly NotebookEntry[], data?: unknown): ReturnType<typeof splitNotebookHeader> {
  const layout = notebookLayoutOf(nb);
  return splitNotebookHeader(resolveNotebookLayout(layout.components, notebookLayoutFlags(nb, entries.some((e) => e.kind === 'option')), notebookLayoutValues(nb), emptyPartsGo(layout, data)));
}

/** The notebook's widgets as A2UI messages, or undefined when it has nothing to show as widgets yet. */
export function notebookWidgetMessages(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory): unknown[] | undefined {
  // The shortlist needs fields and options; a page drawn for this notebook shows what it has.
  if (!nb.layout && (nb.fields.length === 0 || !entries.some((e) => e.kind === 'option'))) return undefined;
  const data = notebookWidgetData(nb, entries, history);
  const v = validateViewComponents(resolvedPage(nb, entries, data).rest);
  if (!v.ok) return undefined;
  return viewToMessages(`notebook-${nb.id}`, v.components, data);
}

/** How a drawn page wants its header (the layout's NotebookHeader), with its side part as A2UI messages. */
export interface NotebookHeaderView {
  cover: 'lead' | 'none';
  subtitle?: string;
  statement: boolean;
  steps: 'show' | 'fold';
  side?: unknown[];
}

/** The layout's say on the header, or undefined (no NotebookHeader: the usual header). */
export function notebookHeaderView(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory): NotebookHeaderView | undefined {
  if (!nb.layout) return undefined;
  if (!splitNotebookHeader(notebookLayoutOf(nb).components).header) return undefined;
  const data = notebookWidgetData(nb, entries, history);
  const { header, side } = resolvedPage(nb, entries, data);
  if (!header) return undefined;
  // A subtitle may be bound to the notebook's data; anything not text reads as none.
  const raw = header.subtitle && typeof header.subtitle === 'object' && typeof (header.subtitle as { path?: unknown }).path === 'string'
    ? resolvePointer(data, (header.subtitle as { path: string }).path)
    : header.subtitle;
  const subtitle = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 140) : undefined;
  const sideView = side ? validateViewComponents(side) : undefined;
  return {
    cover: header.cover === 'none' ? 'none' : 'lead',
    ...(subtitle ? { subtitle } : {}),
    statement: header.statement !== false,
    steps: header.steps === 'fold' ? 'fold' : 'show',
    ...(sideView?.ok ? { side: viewToMessages(`notebook-${nb.id}-header`, sideView.components, data) } : {}),
  };
}

export { fieldNumber };
