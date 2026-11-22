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
import { answerCover, answerDiagramView, type AnswerDiagramView } from './answer-art.js';
import { readerPage, answerConfidence, findingStatus, type FindingTrace, answerSubjects, evidenceOrigin, sourceSpread, sourceSpreadCaution, SOURCE_KINDS, type SourceKind } from '@some-useful-agents/core';
import { missingExperimentData, rankBy, rankOptions, isRange,
  notebookViewData, notebookLayoutOf, withTldrCardSlot, resolveNotebookLayout, splitNotebookHeader, resolvePointer, type NotebookLayout, type NotebookLayoutFlag, type NotebookLayoutValueKey, cleanData, fieldNumber, validateViewComponents, viewToMessages,
  type Notebook, type NotebookAffiliation, type NotebookEntry, type NotebookField, type NotebookViewHistory, type NotebookViewData,
  type NotebookRange, type NotebookSearchSource, type NotebookViewOption, type ViewComponent,
  notebookChanges, type NotebookChange, type NotebookChangeKind, type NotebookFieldValue,
  answerSectionLines, sectionKey, writesUp, subjectHost, runbookRole, runbookCopyPlaces, runbookTotalTime, runbookNeeds, type NotebookRunbookRole, type NotebookAnswerSection,
} from '@some-useful-agents/core';
import { formatFieldValue } from './field-format.js';
import { whatsNew, whatsNewLines, type WhatsNew } from './notebook-whats-new.js';
import { PULL_QUOTE_KEY, cleanQuote, pullQuoteOf, readableNumbers, roleAtCompany, tidyGiven, trimDangling, uniqueQuotes } from './notebook-clean.js';

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
  passes?(notebookId: string, limit?: number): Array<{ runIds: string[]; startedAt?: string; finishedAt?: string; stepId?: string; note?: string }>;
  /** The notebooks an agent works for (a failed run of an agent only this notebook uses is this notebook's). */
  notebooksFedBy?(agentId: string): string[];
  /** The results of the experiment a notebook shows (ADR-0078), from its latest pass. */
  experiment?(experimentId: string): import('@some-useful-agents/core').ExperimentPageData | undefined;
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

/** A number set large (Lead): its value as text, what it is, and a line on which option it is, linked. */
export interface NotebookLeadStat { value: string; label: string; note?: string; href?: string; tone?: 'ok' | 'neutral' | 'warn' }

/**
 * The notebook's numbers, one set per money or number field, from the options
 * in the running: the best by the field's better way (lower for a price,
 * higher otherwise), the high, the low, and how many have it. A range counts
 * as its midpoint. Pure.
 */
/** The deciding field: the score, else the price, else the first money or number field (what Bars, Compare and the lead number go by). */
export function leadFieldOf(nb: Pick<Notebook, 'fields'>): NotebookField | undefined {
  return rankBy(nb).field ?? nb.fields.find((f) => f.role === 'price') ?? nb.fields.find((f) => f.type === 'money' || f.type === 'number');
}

export function notebookNumbers(nb: Pick<Notebook, 'id' | 'fields'>, active: ReadonlyArray<NotebookViewOption & { page?: string }>): NotebookWidgetData['notebook']['numbers'] {
  const out: NotebookWidgetData['notebook']['numbers'] = {};
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (isRange(v)) return (v.min + v.max) / 2;
    if (typeof v === 'string' && v.trim()) { const n = Number(v.replace(/[$,%\s]/g, '').replace(/[a-zA-Z]+$/, '')); return Number.isFinite(n) ? n : undefined; }
    return undefined;
  };
  for (const f of nb.fields) {
    if (f.type !== 'money' && f.type !== 'number') continue;
    const rows = active.map((o) => ({ o, n: num(o.fields[f.key]), raw: o.fields[f.key] })).filter((r): r is typeof r & { n: number } => r.n !== undefined);
    if (!rows.length) continue;
    const lower = f.better === 'lower' || (!f.better && f.role === 'price');
    const asc = [...rows].sort((a, b) => a.n - b.n);
    const low = asc[0];
    const high = asc[asc.length - 1];
    const best = lower ? low : high;
    const word = f.label.toLowerCase();
    const stat = (r: typeof low, label: string): NotebookLeadStat => ({ value: formatFieldValue(f, r.raw), label, note: r.o.name, ...(r.o.page ? { href: r.o.page } : {}), tone: 'ok' });
    out[f.key] = {
      best: stat(best, `${lower ? 'Lowest' : 'Highest'} ${word}`),
      high: stat(high, `Highest ${word}`),
      low: stat(low, `Lowest ${word}`),
      count: { value: String(rows.length), label: `with ${word}`, note: `of ${String(active.length)} in the running`, tone: 'neutral' },
    };
  }
  // The deciding field's, at a fixed path for pages that can't know its key.
  const lead = leadFieldOf(nb);
  if (lead && out[lead.key]) out.lead = out[lead.key];
  return out;
}

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
    /** Where to strike one and have sua write a new one in its place (an open notebook with a talking-points write step) (Agenda replaceHref). */
    talkingPointsReplace?: string;
    /** The answer a write step wrote, as a Callout; before then, where it stands (the Answer page). */
    answer: { question: string; label: string; text: string; next?: string; nextLabel: string; cover?: string };
    /** The findings the answer rests on, each linked to its sources (Agenda points). */
    /** `trace`: how the sources it cites traced (ADR-0082), once the check step has looked. */
    findings: Array<{ text: string; refs: Array<{ label: string; href: string }>; trace?: FindingTrace | 'interpretation' }>;
    /** What the answer leaves open (Agenda questions). */
    openQuestions: Array<{ text: string }>;
    /** Who publishes the pages it learned from, one point per publisher, linked to its pages (Agenda points; ADR-0081). */
    sources: Array<{ text: string; refs: Array<{ label: string; href: string }> }>;
    /** What to weigh about where its sources come from (Agenda questions). */
    sourceCautions: Array<{ text: string }>;
    /** The parts the answer was asked for (AnswerSections), each step and row with links to what it rests on. */
    answerSections: Array<{ key: string; title: string; kind: 'steps' | 'table' | 'text' | 'diagram' | 'copy'; /** What it is for in a runbook (core runbookRole). */ role?: NotebookRunbookRole; /** A part to copy drawn inside a step of the method: AnswerSections leaves it out on its own. */ inStep?: boolean; label?: string; lang?: string; items?: Array<{ text: string; detail?: string; how?: string; see?: string; ifNot?: string; time?: string; advice?: boolean; /** Its phase ("Prep"): consecutive steps with one are grouped under it. */ phase?: string; /** The part to copy this step uses, drawn inside it. */ copyPart?: { key: string; title: string; kind: 'copy'; body?: string; label?: string; lang?: string }; refs: Array<{ label: string; href: string }> }>; columns?: string[]; rows?: Array<{ cells: string[]; refs: Array<{ label: string; href: string }> }>; note?: string; body?: string; diagram?: AnswerDiagramView; caption?: string; refs?: Array<{ label: string; href: string }> }>;
    /** A plan's parts besides its days (AnswerSections), the same shapes as an answer's. */
    planSections: NotebookWidgetData['notebook']['answerSections'];
    /** Each written part by its key (`/notebook/section/<key>`), an answer's and a plan's, for a page composed around them. */
    section: Record<string, NotebookWidgetData['notebook']['answerSections'][number]>;
    /** A runbook at a glance (KeyValue rows): its time in all, how many steps, for whom, what you end with. */
    /** A runbook's card (At a glance) and its lesson (ADR-0097): what you'll be able to do, what you'll need (from its ready part when it has no lesson), how you know you're done, what to remember, what's next, a self-check. */
    runbook: { glance: Array<{ label: string; value: string }>; lesson: { goals: string[]; needs: string[]; done?: string; keyPoints: string[]; next?: string; selfCheck: Array<{ q: string; a: string }>; written: boolean } };
    /** The notebook's numbers by field key, from the options in the running: the best by the field's better way, the high, the low, the count (Lead stat). Money and number fields only. */
    numbers: Record<string, { best: NotebookLeadStat; high: NotebookLeadStat; low: NotebookLeadStat; count: NotebookLeadStat }>;
    /** The notebook's TL;DR picture (Picture): its image, what it shows, and where it's redrawn. */
    picture: { src: string; alt: string; href: string; caption: string };
    /** A photo of what it's about, kept from one of its sources (Picture): absent when no source has a real photo. */
    photo?: NotebookSubjectPhoto;
    /** The plan a write step wrote, as a Callout; before then, where it stands (the Plan page). */
    planIntro: { label: string; text: string; next?: string; cover?: string };
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
    facts: Array<{ label: string; value: string; url?: string; group: string; mark?: 'new' | 'changed'; was?: string }>;
    /** What was looked for about them and not found. */
    notFound: string[];
    /** The first thing they said (the top quote), for a cover's pull quote. */
    leadQuote?: string;
    /** The page the pull quote was said on, and its name. */
    leadQuoteFrom?: string;
    leadQuoteBy?: string;
    /** The quotes after that one (so a page with the pull quote doesn't repeat it). */
    otherQuotes: NotebookWidgetData['notebook']['quotes'];
    /** What was learned about the person, and about their company, apart (FactSheet beside each). */
    personFacts: NotebookWidgetData['notebook']['facts'];
    companyFacts: NotebookWidgetData['notebook']['facts'];
    /** The company's competitors as table rows (link cells: {label, url}). */
    competitors: Array<{ competitor: { label: string; url?: string }; how: string; source?: { label: string; url: string } }>;
    /** The person's other companies as table rows (link cells), with any a settled conflict set aside. */
    affiliations: Array<{ company: { label: string; url?: string }; role: string; what: string; source?: { label: string; url: string } }>;
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
  const numbers = notebookNumbers(nb, active.map((o) => ({ ...o, page: notebookOptionPath(nb.id, o.id) })));
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
  const written = { ...answerViews(nb, active, summary, next, entries, v.options), ...planViews(nb, active, summary, next, entries) };
  const latestWithSources = searches.find((s) => s.sources.length);
  const outOptions = v.options.filter((o) => o.ruledOut);

  // What the latest run found that the one before didn't (a briefing): its facts get a mark.
  const fresh = history?.passes ? whatsNew(nb, entries, history.passes(nb.id, 60).filter((x): x is typeof x & { startedAt: string } => typeof x.startedAt === 'string')) : undefined;
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
  // A profile or write step run again (Look again, Write again): what it did; the latest with what's new.
  const rerunSteps = new Map((nb.steps ?? []).filter((x) => x.kind === 'profile' || x.kind === 'write').map((x) => [x.id, x]));
  const stepRuns = (history?.passes?.(nb.id, 60) ?? []).filter((x) => x.stepId && rerunSteps.has(x.stepId) && x.finishedAt && x.startedAt)
    .sort((a, b) => a.startedAt!.localeCompare(b.startedAt!));
  const seenStep = new Set<string>();
  for (const x of stepRuns) {
    if (!seenStep.has(x.stepId!)) { seenStep.add(x.stepId!); continue; }
    const step = rerunSteps.get(x.stepId!)!;
    const latest = fresh && x.finishedAt === fresh.at;
    const lines = latest ? whatsNewLines(fresh) : [];
    timeline.push({
      at: x.finishedAt!, kind: 'search', who: step.agentId ?? (step.kind === 'profile' ? 'research-one' : 'notebook-writer'),
      title: `${step.kind === 'profile' ? 'Looked again' : 'Wrote again'}: ${step.title}`,
      ...(latest && fresh.empty ? { body: 'Nothing new since the run before.', empty: true } : lines.length ? { body: lines.join(' · ') } : x.note ? { body: clip(x.note, 150) } : {}),
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

  const { quotes: kept, talkingPoints, questions, watch } = whatTheySaid(nb, active);
  // The pull quote you chose leads; a line you said isn't theirs is out of the page.
  const { lead, from: leadFrom, quotes, others } = pullQuoteOf(nb.about?.person ?? nb.about?.company, kept);
  const about = aboutViews(nb, history?.aboutPhotos?.(nb.id) ?? new Set(), history?.aboutPhoto ? (who) => history.aboutPhoto!(nb.id, who) : undefined, fresh?.marks);

  return {
    notebook: {
      ...v,
      quotes,
      talkingPoints,
      questions,
      watch,
      ...(nb.briefing?.points.length ? { talkingPointsEdit: `/notebooks/${encodeURIComponent(nb.id)}/talking-points` } : {}),
      ...(nb.briefing?.points.length && nb.status === 'active' && nb.steps?.some((s) => s.kind === 'write' && !s.shape) ? { talkingPointsReplace: `/notebooks/${encodeURIComponent(nb.id)}/talking-points/replace` } : {}),
      ...about,
      // The page leads with something they said; a profile's stats kept as a quote don't lead (and stay in the list).
      ...(lead ? { leadQuote: lead } : {}),
      // Where it was said, so the quote can be followed to its source.
      ...(leadFrom?.source && /^https?:\/\//i.test(leadFrom.source) ? { leadQuoteFrom: readerPage(leadFrom.source), leadQuoteBy: leadFrom.title } : {}),
      otherQuotes: others,
      personFacts: about.facts.filter((f) => f.group === nb.about?.person?.name),
      companyFacts: about.facts.filter((f) => f.group === nb.about?.company?.name && f.group !== nb.about?.person?.name),
      affiliations: notebookAffiliations(nb).map((a) => ({
        company: { label: a.name, ...(a.website ? { url: a.website } : {}) },
        role: a.role ?? '',
        what: [a.what, a.industry, a.stage].filter((x): x is string => !!x).map((x) => readableNumbers(trimDangling(x))).filter(Boolean).join(' · '),
        ...(a.source ? { source: { label: ((): string => { try { return new URL(a.source!).hostname.replace(/^www\./, ''); } catch { return a.source!; } })(), url: a.source } } : {}),
      })),
      competitors: (nb.about?.company?.competitors ?? []).map((c) => ({
        competitor: { label: c.name, ...(c.website ? { url: c.website } : {}) },
        how: c.how ?? '',
        ...(c.source ? { source: { label: ((): string => { try { return new URL(c.source!).hostname.replace(/^www\./, ''); } catch { return c.source!; } })(), url: c.source } } : {}),
      })),
      options: v.options.map((o) => {
        const facets = optionFacets(nb, o);
        return { ...o, page: notebookOptionPath(nb.id, o.id), ...(facets ? { facets } : {}) };
      }),
      bands: limitBands(nb),
      summary,
      next,
      // A notebook that shows an experiment: its results, read from the experiment each time.
      ...(nb.experimentId ? { experiment: history?.experiment?.(nb.experimentId) ?? missingExperimentData(nb.experimentId) } : {}),
      ...written,
      section: Object.fromEntries([...written.answerSections, ...written.planSections].map((x) => [x.key, x])),
      runbook: { glance: runbookGlance(nb.answer, written.answerSections), lesson: runbookLessonView(nb.answer) },
      numbers,
      // Its TL;DR picture; the address changes when the notebook or the way it's drawn does, so a browser shows the new one.
      picture: { src: `/notebooks/${encodeURIComponent(nb.id)}/tldr.png?v=${encodeURIComponent(`${nb.updatedAt}.${nb.tldr?.at ?? 'standard'}`)}`, alt: `${nb.title}, in short`, href: `/notebooks/${encodeURIComponent(nb.id)}/tldr`, caption: 'The TL;DR picture. Open it to redraw or download it.' },
      // A photo of the thing itself ("a picture of a hot dog"), from its sources: never the TL;DR card, a logo or a drawing.
      ...((photo) => (photo ? { photo } : {}))(subjectPhoto(nb, active)),
      ...changesViews(nb, v.options, history, summary, next),
      // With a lead number on the page (numbers.lead), the strip doesn't say the best again.
      statItems: [
        { label: 'in the running', value: String(active.length), tone: 'ok' },
        ...(numbers.lead ? [] : [rank.by === 'score'
          ? { label: `best ${(rank.field?.label ?? 'fit').toLowerCase()}`, value: best?.score !== undefined ? best.score.toLocaleString('en-US') : '—', ...(best ? { sub: best.name.split(' ').slice(0, 3).join(' ') } : {}) }
          : { label: `best ${better === 'higher' ? (priceF?.label ?? 'pay').toLowerCase() : (priceF?.label ?? 'price').toLowerCase()}`, value: best ? money(priceF, best.price) : '—', ...(best ? { sub: best.name.split(' ').slice(0, 3).join(' ') } : {}) },
        ]),
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
function aboutViews(nb: Notebook, photos: ReadonlySet<string>, photoFrom?: (who: 'person' | 'company') => { page?: string; why?: string } | undefined, marks: WhatsNew['marks'] = {}): Pick<NotebookWidgetData['notebook'], 'person' | 'company' | 'facts' | 'notFound'> {
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
    ...(c.summary ? { about: readableNumbers(c.summary) } : {}),
    ...(photos.has('company') ? { image: notebookAboutPhotoPath(nb.id, 'company') } : {}),
    links: link(siteName(fact('company', 'website')) || 'Website', fact('company', 'website')),
    asOf: asOf(c.updatedAt),
  } : undefined;
  // Links show on the card, and a pull quote you chose leads the page, so the sheet leaves them out.
  const linkKeys = new Set(['linkedin', 'website', 'company_website', PULL_QUOTE_KEY]);
  const names = [p?.name, c?.name].filter((x): x is string => !!x);
  const rows = (one: typeof p, who: 'person' | 'company') => (one ? one.facts.filter((f) => !linkKeys.has(f.key)).map((f) => {
    const m = marks[`${who}:${f.key}`];
    return { label: f.label, value: readableNumbers(f.value, f.quote), ...(f.source ? { url: readerPage(f.source) } : f.from ? { from: tidyGiven(f.from, names) } : {}), group: one.name, ...(m ? { mark: m.mark, ...(m.was ? { was: m.was } : {}) } : {}) };
  }) : []);
  return {
    ...(person ? { person } : {}),
    ...(company ? { company } : {}),
    facts: [...rows(p, 'person'), ...rows(c, 'company')],
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
  const said = (o: NotebookViewOption) => (quoteF ? text(o, quoteF.key) : nb.about?.person ? bodyQuote(o.body) : '');
  const quotes = uniqueQuotes(ordered.filter((o) => said(o)).map((o) => {
    const group = groupKey ? (nb.facets?.[groupKey]?.labels[facetValueKey(o.fields[groupKey])] || text(o, groupKey)) : '';
    const ask = text(o, askF?.key);
    return {
      title: o.name, quote: cleanQuote(said(o)), href: page(o),
      ...(o.link ? { source: o.link } : {}), ...(o.when ? { at: o.when } : {}), ...(ask ? { ask } : {}), ...(group ? { group } : {}), ...(o.chosen ? { chosen: true } : {}),
    };
  }));
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

/** Whether the notebook can have quotes: a quote field, or it's about a person (each option's source quote, as the finder keeps it). */
function canQuote(nb: Notebook): boolean {
  return nb.fields.some((f) => f.role === 'quote') || !!nb.about?.person;
}

/** The words an option's source said, as the finder keeps them in its body ("Why. \"Their words\" (found by …)"). */
export function bodyQuote(body: string): string {
  return /"([^"]{8,600})"/.exec(body)?.[1]?.trim() ?? '';
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
function planViews(nb: Notebook, active: readonly NotebookViewOption[], summary: string, next: string | undefined, entries: readonly NotebookEntry[] = []): Pick<NotebookWidgetData['notebook'], 'planIntro' | 'planDays' | 'planBefore' | 'planOpen' | 'planSections'> {
  const p = nb.plan;
  if (!p?.items.length) return { planIntro: { label: 'Where it stands', text: summary, ...(next ? { next } : {}) }, planDays: [], planBefore: [], planOpen: [], planSections: [] };
  const refs = answerRefs(nb, active, entries);
  const days: NotebookWidgetData['notebook']['planDays'] = [];
  for (const it of p.items) {
    // Items keep the writer's order; one day's run of items is one group.
    const day = days.at(-1)?.when === it.when ? days.at(-1)! : (days.push({ when: it.when, items: [] }), days.at(-1)!);
    day.items.push({ text: it.title, ...(it.detail ? { note: it.detail } : {}), refs: refs(it.from) });
  }
  return {
    planIntro: { label: 'The plan', text: p.summary || `${String(p.items.length)} things, in order.`, cover: answerCover(nb).src },
    planDays: days, planBefore: p.before.map((text) => ({ text })), planOpen: p.open.map((text) => ({ text })),
    planSections: sectionViews(p.sections, p.struck, refs),
  };
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

type SectionView = NotebookWidgetData['notebook']['answerSections'][number];
type Ref = { label: string; href: string };

/**
 * An answer's or plan's parts for AnswerSections, without what you struck
 * (and isn't written again); a diagram laid out to draw as HTML. A table
 * whose every row cites the same sources says them once, under the table.
 */
function sectionViews(sections: NonNullable<NonNullable<Notebook['answer']>['sections']> | undefined, struckList: readonly string[] | undefined, refs: (from: readonly string[], text?: string) => Ref[]): SectionView[] {
  const struck = new Set(struckList ?? []);
  return (sections ?? []).map((x): SectionView => {
    const key = sectionKey(x);
    if (x.kind === 'steps') return { key, title: x.title, kind: x.kind, items: x.items.filter((i) => !struck.has(i.text)).map((i) => ({ text: i.text, ...(i.detail ? { detail: i.detail } : {}), ...(i.how ? { how: i.how } : {}), ...(i.see ? { see: i.see } : {}), ...(i.ifNot ? { ifNot: i.ifNot } : {}), ...(i.time ? { time: i.time } : {}), ...(i.advice ? { advice: true } : {}), ...(i.phase ? { phase: i.phase } : {}), refs: refs(i.from, `${i.text} ${i.detail ?? ''}`) })) };
    // Something to copy, as written; struck, it's gone.
    if (x.kind === 'copy') return struck.has(answerSectionLines(x)[0]) ? { key, title: x.title, kind: 'text', body: '' } : { key, title: x.title, kind: 'copy', body: x.body, ...(x.label ? { label: x.label } : {}), ...(x.lang ? { lang: x.lang } : {}) };
    if (x.kind === 'table') {
      const rows = x.rows.filter((r) => !struck.has(r.cells.join(' · '))).map((r) => ({ cells: r.cells, refs: refs(r.from, r.cells.join(' · ')) }));
      const every = rows.length > 1 ? rows[0].refs.filter((f) => rows.every((r) => r.refs.some((g) => g.href === f.href))) : [];
      const shared = new Set(every.map((f) => f.href));
      return {
        key, title: x.title, kind: x.kind, columns: x.columns, rows: rows.map((r) => ({ ...r, refs: r.refs.filter((f) => !shared.has(f.href)) })),
        ...(x.note ? { note: x.note } : {}), ...(every.length ? { refs: every } : {}),
      };
    }
    // Struck, a diagram is gone whole.
    if (x.kind === 'diagram') return { key, title: x.title, kind: x.kind, ...(answerSectionLines(x).some((t) => struck.has(t)) ? { items: [] } : { diagram: answerDiagramView(x.diagram) }), ...(x.caption ? { caption: x.caption } : {}) };
    return { key, title: x.title, kind: x.kind, body: x.body, ...(x.from?.length ? { refs: refs(x.from) } : {}) };
  }).filter((x) => (x.items ?? x.rows ?? [x.body ?? x.diagram]).length);
}

/**
 * The options in the running a line names by their company ("Hims & Hers,
 * Webflow, JLL"), in the order it names them: a row about a group cites each
 * of them even when the writer cited only a few. Only a company that is one
 * option's alone (in the running or ruled out), so "Jobgether" naming two
 * jobs, one ruled out, cites neither.
 */
function namedOptions(nb: Notebook, active: readonly NotebookViewOption[], all: readonly NotebookViewOption[]): (text: string) => string[] {
  const org = nb.fields.find((f) => f.role === 'org');
  if (!org) return () => [];
  const nameOf = (o: NotebookViewOption) => { const v = o.fields[org.key]; return typeof v === 'string' ? v.replace(/\s*\(.*$/, '').trim() : ''; };
  const count = new Map<string, number>();
  for (const o of all) { const n = nameOf(o).toLowerCase(); if (n) count.set(n, (count.get(n) ?? 0) + 1); }
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tests = active.flatMap((o) => {
    const n = nameOf(o);
    if (n.length < 2 || count.get(n.toLowerCase()) !== 1) return [];
    return [{ id: o.id, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, 'iu') }];
  });
  return (text) => tests.map((t) => ({ id: t.id, at: text.search(t.re) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).map((x) => x.id);
}

/**
 * What an answer's part rests on, as links: an option to its page, evidence
 * from a page (a source that explains) to that page.
 */
function answerRefs(nb: Notebook, active: readonly NotebookViewOption[], entries: readonly NotebookEntry[], all: readonly NotebookViewOption[] = active): (from: readonly string[], text?: string) => Array<{ label: string; href: string }> {
  const byId = new Map(active.map((o) => [o.id, o]));
  const sources = new Map(entries.filter((e) => e.kind === 'evidence' && e.fingerprint).map((e) => [e.id, e]));
  const subjects = answerSubjects(nb);
  const named = namedOptions(nb, active, all);
  return (from, text) => {
    const ids = [...new Set([...from, ...(text ? named(text) : [])])].slice(0, 12);
    const out = ids.flatMap((id) => {
      const o = byId.get(id);
      if (o) return [{ label: o.name, href: notebookOptionPath(nb.id, o.id) }];
      const e = sources.get(id);
      // Named for who publishes it (ADR-0081), else its site.
      return e ? [{ label: evidenceOrigin(e, subjects)?.publisher ?? sourceLabel(e.fingerprint!), href: e.fingerprint! }] : [];
    });
    // Two pages of one publisher: "CopilotKit", "CopilotKit (2)".
    return out.map((r, i) => { const n = out.slice(0, i).filter((x) => x.label === r.label).length; return n ? { ...r, label: `${r.label} (${String(n + 1)})` } : r; });
  };
}

/** Every entry id an answer cites (its findings, its sections' rows and steps), once each. */
function citedIds(a: NonNullable<Notebook['answer']>): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'from' && Array.isArray(x)) x.forEach((id) => { if (typeof id === 'string') out.add(id); });
      else if (k !== 'previous') walk(x);
    }
  };
  walk(a.findings);
  walk(a.sections);
  return [...out];
}

/**
 * What to weigh about where an answer's cited sources come from (SIFT:
 * investigate the source), or undefined when 2+ publishers outside its
 * subjects back it. Options it cites aren't pages it learned from, so they
 * don't count either way. Pure.
 */
export function answerSourceCaution(nb: Notebook, entries: readonly NotebookEntry[]): string | undefined {
  if (!nb.answer?.text) return undefined;
  const subjects = answerSubjects(nb);
  const cited = new Set(citedIds(nb.answer));
  const origins = entries.filter((e) => e.kind === 'evidence' && cited.has(e.id)).map((e) => evidenceOrigin(e, subjects)).filter((o): o is NonNullable<typeof o> => !!o);
  return sourceSpreadCaution(sourceSpread(origins));
}

const KIND_WORDS: Record<SourceKind, string> = { primary: 'primary source', vendor: 'vendor', independent: 'independent', community: 'community' };

/**
 * Who publishes the pages a notebook learned from (its evidence with a
 * page), one point per publisher, most pages first: "CopilotKit · its own
 * pages · primary source · 6 pages", linked to each page. Pure.
 */
export function sourcePoints(nb: Notebook, entries: readonly NotebookEntry[]): NotebookWidgetData['notebook']['sources'] {
  const subjects = answerSubjects(nb);
  const pages = entries.filter((e) => e.kind === 'evidence' && e.fingerprint).map((e) => ({ e, o: evidenceOrigin(e, subjects)! })).filter((x) => x.o);
  const spread = sourceSpread(pages.map((x) => x.o));
  const kinds = (xs: typeof pages) => SOURCE_KINDS.filter((k) => xs.some((x) => x.o.kind === k)).map((k) => KIND_WORDS[k]).join(' and ');
  return spread.byPublisher.map((p) => {
    const mine = pages.filter((x) => x.o.publisher.toLowerCase().replace(/[^a-z0-9]/g, '') === p.publisher.toLowerCase().replace(/[^a-z0-9]/g, ''));
    // By address, so pages filed in one run keep one order.
    const refs = mine.map((x) => ({ label: sourceLabel(x.e.fingerprint!), href: x.e.fingerprint! })).sort((a, b) => a.href.localeCompare(b.href));
    const whose = p.whose ? (p.whose.toLowerCase() === p.publisher.toLowerCase() ? 'its own pages' : `${p.whose}'s own pages`) : 'from outside the subjects';
    return {
      // Its pages' kinds, in a fixed order ("primary source and vendor" when they differ).
      text: [p.publisher, whose, ...(kinds(mine) ? [kinds(mine)] : []), `${String(p.pages)} page${p.pages === 1 ? '' : 's'}`].join(' · '),
      refs: refs.map((r, i) => { const n = refs.slice(0, i).filter((x) => x.label === r.label).length; return n ? { ...r, label: `${r.label} (${String(n + 1)})` } : r; }),
    };
  });
}

/** A source page's site, for its link ("consumerfinance.gov"). */
const sourceLabel = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'source'; } };

/**
 * The picture beside a subject briefing's lead: one of its sources' own
 * (a photo, not a logo or a drawing), from the subject's own site when one
 * has it, else the first. None for any other notebook, or when no source
 * has one (the lead then keeps sua's drawing). Pure.
 */
export function subjectLeadPicture(nb: Pick<Notebook, 'briefOn'>, options: ReadonlyArray<Pick<NotebookViewOption, 'image' | 'imageKind' | 'link' | 'ruledOut'>>): string | undefined {
  if (!nb.briefOn) return undefined;
  const photos = options.filter((o) => o.image && !o.ruledOut && (o.imageKind === 'listing' || o.imageKind === undefined));
  const own = subjectHost(nb.briefOn);
  const host = (u: string | undefined) => { try { return u ? new URL(u).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; } };
  return (own ? photos.find((o) => host(o.link) === own) : undefined)?.image ?? photos[0]?.image;
}

/** A photo of what a notebook is about (Picture bound to /notebook/photo), with where it's from. */
export interface NotebookSubjectPhoto { src: string; alt: string; href: string; caption: string; title: string; entry: string }

/**
 * A photo of what the notebook is about, for a page that leads with the thing
 * itself: a source's own photo (kept from its page), the best-ranked first;
 * a briefing on a subject takes its own site's first and never an example
 * photo; anything else falls back to an example photo sua found for a
 * source. Never a logo, a drawing or the TL;DR card. Undefined when no source
 * has one, so a part bound to it isn't drawn. Pure.
 */
export function subjectPhoto(nb: Pick<Notebook, 'id' | 'briefOn' | 'photo'>, options: ReadonlyArray<Pick<NotebookViewOption, 'id' | 'name' | 'image' | 'imageKind' | 'link' | 'ruledOut'>>): NotebookSubjectPhoto | undefined {
  // One you chose for the notebook (in its conversation) leads, with its credit.
  if (nb.photo) {
    const c = nb.photo;
    const from = (() => { try { return new URL(c.page ?? c.image).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    return {
      src: `/notebooks/${encodeURIComponent(nb.id)}/photo?v=${encodeURIComponent(c.at)}`, alt: c.alt ?? 'The picture chosen for this notebook',
      href: c.page ?? c.image, title: 'Where this picture is from',
      caption: c.credit ?? (from ? `Photo from ${from}` : 'The picture chosen for this notebook'), entry: '',
    };
  }
  const host = (u: string | undefined) => { try { return u ? new URL(u).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; } };
  const live = options.filter((o) => o.image && !o.ruledOut);
  const own = live.filter((o) => o.imageKind === 'listing' || o.imageKind === undefined);
  const site = nb.briefOn ? subjectHost(nb.briefOn) : undefined;
  const ordered = [
    ...(site ? own.filter((o) => host(o.link) === site) : []),
    ...own.filter((o) => !(site && host(o.link) === site)),
    ...(nb.briefOn ? [] : live.filter((o) => o.imageKind === 'representative')),
  ];
  const o = ordered[0];
  if (!o?.image) return undefined;
  const from = host(o.link);
  const example = o.imageKind === 'representative';
  return {
    src: o.image, alt: example ? `An example photo for ${o.name}` : `A photo from ${o.name}`,
    href: notebookOptionPath(nb.id, o.id), title: 'The source this photo is from',
    caption: `${example ? 'An example photo' : 'Photo'}${from ? ` from ${from}` : ''}: ${o.name}`, entry: o.id,
  };
}

/** How sure an answer is, in plain words. */
const SURE: Record<NonNullable<Notebook['answer']>['confidence'], string> = { high: 'sure', medium: 'fairly sure', low: 'not sure yet' };

/**
 * The answer for the Answer page: what sua wrote, each finding linked to the
 * options it rests on; before then, where it stands. On a shortlist that
 * gets written up, the same payload is the write-up: the lay of the land,
 * how well checked, no cover art (the page's bars and head-to-head draw it).
 */
function answerViews(nb: Notebook, active: readonly NotebookViewOption[], summary: string, next: string | undefined, entries: readonly NotebookEntry[] = [], all: readonly NotebookViewOption[] = active): Pick<NotebookWidgetData['notebook'], 'answer' | 'findings' | 'openQuestions' | 'answerSections' | 'sources' | 'sourceCautions'> {
  const a = nb.answer;
  const question = nb.statement || nb.title;
  if (!a?.text) return { answer: { question, label: 'Where it stands', text: summary, ...(next ? { next } : {}), nextLabel: 'Next:' }, findings: [], openQuestions: [], answerSections: [], sources: sourcePoints(nb, entries), sourceCautions: [] };
  const caution = answerSourceCaution(nb, entries);
  const refs = answerRefs(nb, active, entries, all);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const answerSections = runbookPlaced(a.sections ?? [], sectionViews(a.sections, a.struck, refs));
  const writeup = writesUp(nb);
  // How sure, capped by its evidence (ADR-0083), and why it isn't higher than the writer said.
  const sure = answerConfidence(nb, entries) ?? { said: a.confidence, shown: a.confidence, why: [] };
  const how = [a.basis ?? '', sure.why.length ? `Why not higher: ${sure.why.join('; ')}.` : ''].filter(Boolean).join(' ');
  return {
    answer: writeup
      ? { question, label: `The lay of the land · ${SURE[sure.shown]}`, text: a.text, ...(how ? { next: how } : {}), nextLabel: 'How well checked:' }
      : { question, label: `${nb.briefOn ? 'Briefing' : 'Answer'} · ${SURE[sure.shown]}`, text: a.text, ...(how ? { next: how } : {}), nextLabel: 'How sure:', cover: subjectLeadPicture(nb, active) ?? answerCover(nb).src },
    findings: a.findings.map((f) => { const t = findingStatus(nb, f, byId); return { text: f.text, refs: refs(f.from, f.text), ...(t ? { trace: t } : {}) }; }),
    // Where its sources come from comes first when that's what to weigh, then where they disagree.
    openQuestions: [...(caution ? [caution] : []), ...(a.contradictions ?? []).map((c) => `Sources disagree: ${c.text}`), ...a.open].map((text) => ({ text })),
    answerSections,
    sources: sourcePoints(nb, entries),
    sourceCautions: caution ? [{ text: caution }] : [],
  };
}

/**
 * An answer's parts with what each is for in a runbook (core runbookRole),
 * and each part to copy inside the step that uses it (core
 * runbookCopyPlaces): a recipe says "paste this" where you paste it. Pure.
 */
function runbookPlaced(sections: readonly NotebookAnswerSection[], views: SectionView[]): SectionView[] {
  const roleOf = new Map(sections.map((x) => [sectionKey(x), runbookRole(x)]));
  const out = views.map((v) => ({ ...v, ...(roleOf.has(v.key) ? { role: roleOf.get(v.key) } : {}) }));
  for (const place of runbookCopyPlaces(sections)) {
    if (place.index < 0) continue;
    const copy = out.find((v) => v.key === place.copy && v.kind === 'copy');
    const steps = out.find((v) => v.key === place.steps && v.kind === 'steps');
    const item = steps?.items?.[place.index];
    if (!copy || !steps || !item) continue;
    steps.items = steps.items!.map((it, i) => (i === place.index ? { ...it, copyPart: { key: copy.key, title: copy.title, kind: 'copy' as const, ...(copy.body !== undefined ? { body: copy.body } : {}), ...(copy.label ? { label: copy.label } : {}), ...(copy.lang ? { lang: copy.lang } : {}) } } : it));
    copy.inStep = true;
  }
  return out;
}

/** A runbook at a glance, as KeyValue rows: its time (as the writer said, else its steps' times added up), how many steps, for whom, what you end with. Rows it can't say are left out. Pure. */
/** A runbook's lesson for the page: as the writer gave it, else what to have ready from its ready part (`written` false: no lesson yet). Pure. */
function runbookLessonView(a: Notebook['answer']): NotebookViewDataLesson {
  const l = a?.lesson;
  return { goals: l?.goals ?? [], needs: runbookNeeds(a), ...(l?.done ? { done: l.done } : {}), keyPoints: l?.keyPoints ?? [], ...(l?.next ? { next: l.next } : {}), selfCheck: l?.selfCheck ?? [], written: !!l };
}
type NotebookViewDataLesson = { goals: string[]; needs: string[]; done?: string; keyPoints: string[]; next?: string; selfCheck: Array<{ q: string; a: string }>; written: boolean };

function runbookGlance(a: Notebook['answer'], views: readonly SectionView[]): Array<{ label: string; value: string }> {
  const method = views.filter((v) => v.kind === 'steps' && v.role === 'method');
  if (!a || !method.length) return [];
  const items = method.flatMap((v) => v.items ?? []);
  const time = a.glance?.time ?? runbookTotalTime(items);
  return [
    ...(time ? [{ label: 'Takes', value: time }] : []),
    { label: 'Steps', value: String(items.length) },
    ...(a.glance?.level ? [{ label: 'For', value: a.glance.level }] : []),
    ...(a.glance?.makes ? [{ label: 'You\u2019ll end with', value: a.glance.makes }] : []),
  ];
}

/** What a layout's `when` tests, for this notebook (core NOTEBOOK_LAYOUT_FLAGS). */
/**
 * The person's other companies: the ones their profile step found, and any
 * company a settled conflict set aside (you said ARV is their company, not
 * Arrive: Arrive is still theirs, as another). Never their main company. Pure.
 */
export function notebookAffiliations(nb: Pick<Notebook, 'about'>): NotebookAffiliation[] {
  const p = nb.about?.person;
  if (!p) return [];
  const main = (p.facts.find((f) => f.key === 'organization')?.value ?? nb.about?.company?.name ?? '').trim().toLowerCase();
  const out = [...(p.affiliations ?? [])];
  const company = (nb.about?.company?.name ?? '').trim().toLowerCase();
  const has = (n: string) => { const k = n.trim().toLowerCase(); return k === main || (!!company && k === company) || out.some((a) => a.name.trim().toLowerCase() === k); };
  for (const c of p.conflicts ?? []) {
    if (c.fact !== 'organization' || !c.settled) continue;
    for (const claim of c.claims) {
      // A claim reads "Partner, Expa" (their role, then the company): the company is what's theirs, and one they already have isn't listed twice.
      const at = roleAtCompany(claim.value);
      if (claim.value.trim().toLowerCase() === c.settled.value.trim().toLowerCase() || has(claim.value) || has(at.name)) continue;
      out.push({ name: at.name, ...(at.role ? { role: at.role } : {}), ...(claim.source ? { source: claim.source } : {}) });
    }
  }
  return out;
}

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
    competitors: !!nb.about?.company?.competitors?.length,
    affiliations: notebookAffiliations(nb).length > 0,
    answered: !!nb.answer?.text,
    planned: !!nb.plan?.items.length,
    written: !!nb.answer?.text || !!nb.plan?.items.length,
    numbers: !!leadFieldOf(nb),
    bars: !!leadFieldOf(nb) && !(nb.fields.some((f) => f.role === 'price') && nb.fields.some((f) => f.role === 'measure')),
    lesson: !!nb.answer?.lesson,
    needs: runbookNeeds(nb.answer).length > 0,
  };
}

/** The settings a layout reads from `/notebook/layout/<key>`, for this notebook (core NOTEBOOK_LAYOUT_VALUES). */
/** How many of the page's options have a picture of their own (a photo or a logo, not a drawing), of how many. Pure. */
export function picturedOptions(data: unknown): { pictured: number; of: number } {
  const options = (data as { notebook?: { options?: Array<{ image?: string; imageKind?: string; ruledOut?: unknown }> } } | undefined)?.notebook?.options ?? [];
  const active = options.filter((o) => !o.ruledOut);
  return { pictured: active.filter((o) => o.image && o.imageKind !== 'illustration').length, of: active.length };
}

export function notebookLayoutValues(nb: LayoutNotebook, data?: unknown): Partial<Record<NotebookLayoutValueKey, unknown>> {
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
    // Sources with pictures of their own are drawn as cards, so the pictures show; a table otherwise.
    evidenceLayout: picturedOptions(data).pictured > 0 ? 'grid' : 'table',
    ...(nb.status === 'decided' ? { onlyChosen: true } : {}),
    ...(leadFieldOf(nb) ? { leadField: leadFieldOf(nb)!.key, leadLabel: leadFieldOf(nb)!.label } : {}),
  };
}

/**
 * The notebook's page as plain A2UI: its layout (an A2UI document; the
 * shortlist when it has none) with its `when`s and `/notebook/layout/`
 * settings worked out for this notebook (core resolveNotebookLayout).
 */
export function notebookWidgetComponents(nb: LayoutNotebook, layout: NotebookLayout = notebookLayoutOf(nb), data?: NotebookWidgetData): ViewComponent[] {
  return resolveNotebookLayout(layout.components, notebookLayoutFlags(nb), notebookLayoutValues(nb, data), emptyPartsGo(layout, data));
}

/**
 * A drawn page leaves out parts with nothing in them yet (core
 * resolveNotebookLayout); the shortlist keeps every part, as it always has.
 */
export function emptyPartsGo(layout: NotebookLayout, data: unknown): { data?: unknown } {
  return data !== undefined && layout.preset !== 'shortlist' ? { data } : {};
}

/** The notebook's page as drawn for it now: its layout resolved, with the header (if it has one) taken out. */
/**
 * The page's layout as it's drawn: the notebook's, with a place for the TL;DR
 * card when you set it to Always and the page has none (a ready-made page), so
 * the page, its brief and its PDF all show it.
 */
export function drawnNotebookLayout(nb: Notebook): NotebookLayout {
  const layout = notebookLayoutOf(nb);
  return nb.tldrCard === 'always' ? { ...layout, components: withTldrCardSlot(layout.components) } : layout;
}

function resolvedPage(nb: Notebook, entries: readonly NotebookEntry[], data?: unknown, pending = false): ReturnType<typeof splitNotebookHeader> {
  const layout = drawnNotebookLayout(nb);
  // Nothing to quote ever (no quote field, and not about a person): its quotes panel isn't held open while a step runs.
  const cantFill = canQuote(nb) ? undefined : new Set(['QuoteList']);
  return splitNotebookHeader(resolveNotebookLayout(layout.components, notebookLayoutFlags(nb, entries.some((e) => e.kind === 'option')), notebookLayoutValues(nb, data), { ...emptyPartsGo(layout, data), ...(pending ? { pending } : {}), ...(cantFill ? { cantFill } : {}) }));
}

/** The page's data without its TL;DR card (`drop`): a Picture part with nothing to show goes. */
export function withoutTldrCard<T extends { notebook: { picture?: unknown } }>(data: T, drop: boolean): T {
  if (!drop) return data;
  const { picture: _gone, ...rest } = data.notebook;
  return { ...data, notebook: rest } as T;
}

/** The notebook's widgets as A2UI messages, or undefined when it has nothing to show as widgets yet. */
export function notebookWidgetMessages(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory, opts: { /** A step is running: empty parts keep their place as skeletons. */ pending?: boolean; /** false: the TL;DR card isn't shown (showsTldrCard), so its Picture part goes. */ tldrCard?: boolean } = {}): unknown[] | undefined {
  // The shortlist needs fields and options; a page drawn for this notebook shows what it has.
  if (!nb.layout && (nb.fields.length === 0 || !entries.some((e) => e.kind === 'option'))) return undefined;
  const data = withoutTldrCard(notebookWidgetData(nb, entries, history), opts.tldrCard === false);
  const v = validateViewComponents(resolvedPage(nb, entries, data, opts.pending === true).rest);
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
