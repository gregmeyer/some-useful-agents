/**
 * A notebook's layout is an A2UI document (ADR-0047's catalog): any
 * components, bound to the notebook's data (`/notebook/...`), so its page can
 * be whatever fits what it's for: a shortlist to choose from, a briefing
 * before a meeting, a report. Presets are documents too; a notebook keeps its
 * own, a template carries its notebook's, and sua can draw a new one.
 *
 * Two notebook extensions, resolved when the page is drawn (before the
 * document is validated and sent):
 *
 * - `when: "<flag>"` (or `"!<flag>"`) on any component: drawn only when
 *   the notebook has it (`map`: a price and a measure; `funnel`: 2+ steps or
 *   stages…). A component left out leaves its parent's children, a Columns
 *   loses its width, and a container left empty goes too.
 * - `{ "path": "/notebook/layout/<key>" }` as a prop value: replaced by that
 *   notebook-derived setting (the map's axis labels, the shortlist's sort,
 *   filters, CSV link…), or dropped when the notebook has none. Settings a
 *   component takes only as a plain value can still come from the notebook.
 */
import { validateViewComponents, resolvePointer, type ViewComponent } from './a2ui/view.js';

/** What `when` can test. */
export const NOTEBOOK_LAYOUT_FLAGS = {
  map: 'It has a price and a measure, so its options can be mapped.',
  funnel: 'It has 2+ steps or stages, so a funnel says how far options got.',
  steps: 'Its work is in steps.',
  options: 'It has options.',
  decided: 'It has a decision.',
  about: 'It knows who it\'s about: a profile step learned about a person or company.',
  person: 'It knows the person it\'s about.',
  company: 'It knows their company (or the company it\'s about).',
  competitors: 'It knows its company\'s competitors (a profile step named them).',
  affiliations: 'It knows other companies the person leads, founded or works with.',
  answered: 'It has a written answer (a write step that answers its question).',
  planned: 'It has a written plan (a write step that makes its plan).',
} as const;
export type NotebookLayoutFlag = keyof typeof NOTEBOOK_LAYOUT_FLAGS;

/** The settings `/notebook/layout/<key>` gives, from the notebook. */
export const NOTEBOOK_LAYOUT_VALUES = {
  mapNote: 'The map panel\'s note ("price by miles · your limits shaded").',
  xLabel: 'The map\'s measure label.', yLabel: 'The map\'s price label.',
  xFormat: 'number | money, for the measure.', yFormat: 'number | money, for the price.',
  xBetter: 'higher | lower, when the measure has a better way.', yBetter: 'higher | lower, for the price (lower unless said).',
  sort: 'The shortlist\'s sort: the fit score, else price.',
  filters: 'What the shortlist can be filtered by.',
  csvHref: 'The shortlist CSV link.',
  stageChips: 'false when its steps say how far each got (no stage chips).',
  onlyChosen: 'true once decided: show the chosen ones first.',
} as const;
export type NotebookLayoutValueKey = keyof typeof NOTEBOOK_LAYOUT_VALUES;

export interface NotebookLayout {
  /** The preset it started from ("shortlist"), if any. */
  preset?: string;
  /** An A2UI component list with a `root`, plus the `when` and `/notebook/layout/` extensions. */
  components: ViewComponent[];
  /** Why the page looks like this, when sua drew it ("a briefing: who they are, what they said, what to ask"). */
  about?: string;
}

export interface NotebookLayoutPreset {
  id: string;
  label: string;
  /** When it fits, for sua and the Edit page. */
  when: string;
  layout: NotebookLayout;
}

const L = (key: NotebookLayoutValueKey) => ({ path: `/notebook/layout/${key}` });
const panel = (id: string, title: string, child: string, note?: unknown): ViewComponent =>
  ({ id, component: 'Panel', title, child, ...(note !== undefined ? { note } : {}) });

/**
 * Every notebook's page until now, as a document: where it stands beside
 * done-when, the map beside the funnel, the shortlist, the checklist beside
 * the timeline, coverage beside the limits. For choosing among many options.
 */
const SHORTLIST: ViewComponent[] = [
  { id: 'root', component: 'Column', children: ['top', 'mid', 'shortlist_panel', 'low', 'ctx'] },
  { id: 'top', component: 'Columns', children: ['story', 'steps_panel'], widths: [2, 1] },
  { id: 'story', component: 'Column', children: ['callout', 'stats'] },
  { id: 'callout', component: 'Callout', label: 'Where it stands', text: { path: '/notebook/summary' }, next: { path: '/notebook/next' } },
  { id: 'stats', component: 'StatStrip', items: { path: '/notebook/statItems' } },
  panel('steps_panel', 'Done when', 'steps'),
  { id: 'steps', component: 'Steps', steps: { path: '/notebook/steps' }, label: 'Progress' },
  { id: 'mid', component: 'Columns', children: ['map_panel', 'funnel_panel'], widths: [2, 1] },
  { ...panel('map_panel', 'Where they sit', 'map', L('mapNote')), when: 'map' },
  {
    id: 'map', component: 'Scatter', points: { path: '/notebook/options' }, x: 'measure', y: 'price', label: 'name', href: 'page',
    xLabel: L('xLabel'), yLabel: L('yLabel'), xFormat: L('xFormat'), yFormat: L('yFormat'),
    xBand: { path: '/notebook/bands/measure' }, yBand: { path: '/notebook/bands/price' },
    xBetter: L('xBetter'), yBetter: L('yBetter'),
  },
  { ...panel('funnel_panel', 'How far they got', 'funnel', 'hover a stage for why'), when: 'funnel' },
  { id: 'funnel', component: 'Funnel', stages: { path: '/notebook/funnel' } },
  panel('shortlist_panel', 'Shortlist', 'shortlist', { path: '/notebook/shortlistNote' }),
  {
    id: 'shortlist', component: 'OptionGrid', options: { path: '/notebook/options' }, fields: { path: '/notebook/fields' }, stages: { path: '/notebook/stages' },
    layout: 'grid', sort: L('sort'), actions: true, filters: L('filters'), stageChips: L('stageChips'), csvHref: L('csvHref'), onlyChosen: L('onlyChosen'),
  },
  { id: 'low', component: 'Columns', children: ['check_panel', 'time_panel'], widths: [1, 2], align: 'start' },
  panel('check_panel', 'Before you decide', 'checklist', 'for the top two'),
  { id: 'checklist', component: 'Checklist', groups: { path: '/notebook/checklist' }, actions: true },
  panel('time_panel', 'How we got here', 'timeline', 'newest first'),
  { id: 'timeline', component: 'Timeline', events: { path: '/notebook/timeline' }, maxItems: 8, filters: true, search: true },
  { id: 'ctx', component: 'Columns', children: ['cov_panel', 'lim_panel'], widths: [1, 1] },
  panel('cov_panel', 'Where sua looked', 'coverage', { path: '/notebook/coverage/when' }),
  { id: 'coverage', component: 'Coverage', sources: { path: '/notebook/coverage/sources' } },
  panel('lim_panel', 'Limits', 'limits', { path: '/notebook/limitsNote' }),
  { id: 'limits', component: 'ChipList', items: { path: '/notebook/limitChips' } },
];

/**
 * A briefing before meeting someone, as a magazine spread (DESIGN.md
 * "Notebook pages"): who they are as a cover beside what's known, what to
 * talk about as the feature beside their company, what they said, and the
 * research folded at the end. Each part waits for what it shows.
 */
/** A company's competitors as a table: each a link to its site, how it competes, the page that names it. */
export const COMPETITORS_TABLE: ViewComponent = {
  id: 'rivals', component: 'Table', rows: { path: '/notebook/competitors' },
  columns: [
    { key: 'competitor', label: 'Competitor', format: 'link' },
    { key: 'how', label: 'How it competes' },
    { key: 'source', label: 'Named on', format: 'link' },
  ],
};

/** A person's other companies as a table: each a link to its site, their role there, the page that says so. */
export const AFFILIATIONS_TABLE: ViewComponent = {
  id: 'also', component: 'Table', rows: { path: '/notebook/affiliations' },
  columns: [
    { key: 'company', label: 'Company', format: 'link' },
    { key: 'role', label: 'Their role' },
    { key: 'what', label: 'What it does' },
    { key: 'source', label: 'Said on', format: 'link' },
  ],
};

const DOSSIER: ViewComponent[] = [
  { id: 'root', component: 'Column', children: ['header', 'cover_row', 'also_p', 'talk_row', 'rivals_p', 'said_p', 'more'] },
  { id: 'header', component: 'NotebookHeader', subtitle: 'Meeting briefing', steps: 'fold', cover: 'none' },
  { id: 'cover_row', component: 'Columns', children: ['who_p', 'facts_p'], widths: [2, 1], align: 'start' },
  { ...panel('who_p', 'Who they are', 'who'), treatment: 'lede', when: 'person' },
  {
    id: 'who', component: 'ProfileCard', variant: 'cover', name: { path: '/notebook/person/name' }, role: { path: '/notebook/person/role' }, org: { path: '/notebook/person/org' },
    about: { path: '/notebook/person/about' }, image: { path: '/notebook/person/image' }, links: { path: '/notebook/person/links' }, quote: { path: '/notebook/leadQuote' },
    imageFrom: { path: '/notebook/person/imageFrom' }, imageWhy: { path: '/notebook/person/imageWhy' }, rejectHref: { path: '/notebook/person/rejectHref' },
  },
  { ...panel('facts_p', 'What we know', 'facts'), treatment: 'aside', when: 'person' },
  { id: 'facts', component: 'FactSheet', facts: { path: '/notebook/personFacts' }, missing: { path: '/notebook/notFound' }, variant: 'ruled' },
  { id: 'talk_row', component: 'Columns', children: ['company_p', 'agenda_p'], widths: [1, 2], align: 'start' },
  { ...panel('company_p', 'Their company', 'company_col'), treatment: 'aside', when: 'company' },
  { id: 'company_col', component: 'Column', children: ['company', 'company_facts'] },
  { id: 'company_facts', component: 'FactSheet', facts: { path: '/notebook/companyFacts' }, variant: 'ruled' },
  {
    id: 'company', component: 'ProfileCard', name: { path: '/notebook/company/name' }, role: { path: '/notebook/company/role' }, org: { path: '/notebook/company/org' },
    about: { path: '/notebook/company/about' }, image: { path: '/notebook/company/image' }, links: { path: '/notebook/company/links' },
  },
  { ...panel('agenda_p', 'What to talk about', 'agenda'), treatment: 'feature' },
  { id: 'agenda', component: 'Agenda', points: { path: '/notebook/talkingPoints' }, questions: { path: '/notebook/questions' }, watch: { path: '/notebook/watch' }, variant: 'numerals' },
  { ...panel('also_p', 'Also runs', 'also'), treatment: 'band', when: 'affiliations' },
  AFFILIATIONS_TABLE,
  { ...panel('rivals_p', 'Their competitors', 'rivals'), treatment: 'band', when: 'competitors' },
  COMPETITORS_TABLE,
  { ...panel('said_p', 'In their words', 'quotes', 'grouped by theme'), treatment: 'feature', when: 'options' },
  { id: 'quotes', component: 'QuoteList', items: { path: '/notebook/otherQuotes' }, maxItems: 4 },
  { id: 'more', component: 'Columns', children: ['time_d', 'cov_d'], widths: [1, 1], align: 'start' },
  { id: 'time_d', component: 'Disclosure', label: 'Research activity', child: 'timeline' },
  { id: 'timeline', component: 'Timeline', events: { path: '/notebook/timeline' }, filters: true },
  { id: 'cov_d', component: 'Disclosure', label: 'Where sua looked', child: 'coverage' },
  { id: 'coverage', component: 'Coverage', sources: { path: '/notebook/coverage/sources' }, note: { path: '/notebook/coverage/when' } },
];

/**
 * An answer to a question (the header says the question): the answer
 * (until there is one, where it stands), how sure and why, the findings it rests on (each linked to its
 * sources) with what's still open, beside the steps; then the evidence sua
 * found as a table, and the research folded at the end.
 */
const ANSWER: ViewComponent[] = [
  { id: 'root', component: 'Column', children: ['header', 'top', 'evidence_p', 'more'] },
  { id: 'header', component: 'NotebookHeader', subtitle: 'Answer', steps: 'fold', cover: 'none' },
  { id: 'top', component: 'Columns', children: ['answer_col', 'steps_panel'], widths: [2, 1], align: 'start' },
  { id: 'answer_col', component: 'Column', children: ['answer', 'findings_p'] },
  { id: 'answer', component: 'Callout', label: { path: '/notebook/answer/label' }, text: { path: '/notebook/answer/text' }, next: { path: '/notebook/answer/next' }, nextLabel: { path: '/notebook/answer/nextLabel' } },
  { ...panel('findings_p', 'What it rests on', 'findings'), treatment: 'feature', when: 'answered' },
  {
    id: 'findings', component: 'Agenda', title: 'Key findings', points: { path: '/notebook/findings' }, questions: { path: '/notebook/openQuestions' },
    questionsLabel: 'Still open', maxQuestions: 5, check: false, empty: 'No findings yet.',
  },
  panel('steps_panel', 'Done when', 'steps'),
  { id: 'steps', component: 'Steps', steps: { path: '/notebook/steps' }, label: 'Progress' },
  { ...panel('evidence_p', 'The evidence', 'evidence', 'what sua found and checked'), treatment: 'feature', when: 'options' },
  {
    id: 'evidence', component: 'OptionGrid', options: { path: '/notebook/options' }, fields: { path: '/notebook/fields' }, stages: { path: '/notebook/stages' },
    layout: 'table', sort: L('sort'), actions: true, csvHref: L('csvHref'),
  },
  { id: 'more', component: 'Columns', children: ['time_d', 'cov_d'], widths: [1, 1], align: 'start' },
  { id: 'time_d', component: 'Disclosure', label: 'Research activity', child: 'timeline' },
  { id: 'timeline', component: 'Timeline', events: { path: '/notebook/timeline' }, filters: true },
  { id: 'cov_d', component: 'Disclosure', label: 'Where sua looked', child: 'coverage' },
  { id: 'coverage', component: 'Coverage', sources: { path: '/notebook/coverage/sources' }, note: { path: '/notebook/coverage/when' } },
];

/**
 * A plan (a trip, a week, a project; the header says what for): the plan in
 * a sentence (until there is one, where it stands), then the plan day by
 * day with what to do first and what's open, beside the steps; then what
 * it draws on (the places and things found) and the research, folded.
 */
const PLAN: ViewComponent[] = [
  { id: 'root', component: 'Column', children: ['header', 'top', 'found_p', 'more'] },
  { id: 'header', component: 'NotebookHeader', subtitle: 'Plan', steps: 'fold', cover: 'none' },
  { id: 'top', component: 'Columns', children: ['plan_col', 'steps_panel'], widths: [2, 1], align: 'start' },
  { id: 'plan_col', component: 'Column', children: ['intro', 'days_p'] },
  { id: 'intro', component: 'Callout', label: { path: '/notebook/planIntro/label' }, text: { path: '/notebook/planIntro/text' }, next: { path: '/notebook/planIntro/next' } },
  { ...panel('days_p', 'Day by day', 'days'), treatment: 'feature', when: 'planned' },
  { id: 'days', component: 'Itinerary', title: 'Itinerary', days: { path: '/notebook/planDays' }, before: { path: '/notebook/planBefore' }, open: { path: '/notebook/planOpen' } },
  panel('steps_panel', 'Done when', 'steps'),
  { id: 'steps', component: 'Steps', steps: { path: '/notebook/steps' }, label: 'Progress' },
  { ...panel('found_p', 'What it draws on', 'found', 'places and things sua found'), treatment: 'feature', when: 'options' },
  {
    id: 'found', component: 'OptionGrid', options: { path: '/notebook/options' }, fields: { path: '/notebook/fields' }, stages: { path: '/notebook/stages' },
    layout: 'grid', sort: L('sort'), actions: true,
  },
  { id: 'more', component: 'Columns', children: ['time_d', 'cov_d'], widths: [1, 1], align: 'start' },
  { id: 'time_d', component: 'Disclosure', label: 'Research activity', child: 'timeline' },
  { id: 'timeline', component: 'Timeline', events: { path: '/notebook/timeline' }, filters: true },
  { id: 'cov_d', component: 'Disclosure', label: 'Where sua looked', child: 'coverage' },
  { id: 'coverage', component: 'Coverage', sources: { path: '/notebook/coverage/sources' }, note: { path: '/notebook/coverage/when' } },
];

/**
 * Keeping watch (prices, listings, openings): what changed since the search
 * before the latest first (new, price changes, gone, not seen lately),
 * beside the steps; then everything it's watching, and the research folded.
 */
const WATCH: ViewComponent[] = [
  { id: 'root', component: 'Column', children: ['header', 'top', 'all_p', 'more'] },
  { id: 'header', component: 'NotebookHeader', subtitle: 'Watch', steps: 'fold', cover: 'none' },
  { id: 'top', component: 'Columns', children: ['changes_col', 'steps_panel'], widths: [2, 1], align: 'start' },
  { id: 'changes_col', component: 'Column', children: ['intro', 'changes_p'] },
  { id: 'intro', component: 'Callout', label: { path: '/notebook/changesIntro/label' }, text: { path: '/notebook/changesIntro/text' }, next: { path: '/notebook/changesIntro/next' } },
  { ...panel('changes_p', 'What changed', 'changes'), treatment: 'feature', when: 'options' },
  { id: 'changes', component: 'Changes', items: { path: '/notebook/changes' }, empty: 'Nothing changed since the search before.' },
  panel('steps_panel', 'Done when', 'steps'),
  { id: 'steps', component: 'Steps', steps: { path: '/notebook/steps' }, label: 'Progress' },
  { ...panel('all_p', 'Everything it\'s watching', 'all', { path: '/notebook/shortlistNote' }), treatment: 'feature', when: 'options' },
  {
    id: 'all', component: 'OptionGrid', options: { path: '/notebook/options' }, fields: { path: '/notebook/fields' }, stages: { path: '/notebook/stages' },
    layout: 'grid', sort: L('sort'), actions: true, filters: L('filters'), csvHref: L('csvHref'),
  },
  { id: 'more', component: 'Columns', children: ['time_d', 'cov_d'], widths: [1, 1], align: 'start' },
  { id: 'time_d', component: 'Disclosure', label: 'Research activity', child: 'timeline' },
  { id: 'timeline', component: 'Timeline', events: { path: '/notebook/timeline' }, filters: true },
  { id: 'cov_d', component: 'Disclosure', label: 'Where sua looked', child: 'coverage' },
  { id: 'coverage', component: 'Coverage', sources: { path: '/notebook/coverage/sources' }, note: { path: '/notebook/coverage/when' } },
];

export const NOTEBOOK_LAYOUT_PRESETS: readonly NotebookLayoutPreset[] = [
  {
    id: 'shortlist',
    label: 'Shortlist',
    when: 'Choosing among many options (a car, a job, a place, accounts to call): ranks them, maps them, narrows them to a pick.',
    layout: { preset: 'shortlist', components: SHORTLIST },
  },
  {
    id: 'dossier',
    label: 'Meeting briefing',
    when: 'Getting ready to meet or work with a person or company: who they are, what\'s known, what they said, what to talk about.',
    layout: { preset: 'dossier', components: DOSSIER },
  },
  {
    id: 'answer',
    label: 'Answer',
    when: 'Answering a question or finding something out (what\'s true, what\'s best practice, what it costs, how something works): the answer and how sure, the findings it rests on with their sources, what\'s still open, then the evidence.',
    layout: { preset: 'answer', components: ANSWER },
  },
  {
    id: 'plan',
    label: 'Plan',
    when: 'Making a plan in order (a trip or itinerary, a week of meals or workouts, a move, a project): the plan day by day or step by step, what to book or do first, what\'s still open, then what it draws on.',
    layout: { preset: 'plan', components: PLAN },
  },
  {
    id: 'watch',
    label: 'Watch',
    when: 'Keeping an eye on something over time (prices, new listings or openings, whether something comes back in stock): what changed since the last search first (new, price changes, gone), then everything it\'s watching.',
    layout: { preset: 'watch', components: WATCH },
  },
];

export function layoutPreset(id: string): NotebookLayoutPreset | undefined {
  return NOTEBOOK_LAYOUT_PRESETS.find((p) => p.id === id);
}

/** A notebook with no layout of its own uses this. */
export const DEFAULT_NOTEBOOK_LAYOUT = NOTEBOOK_LAYOUT_PRESETS[0].layout;

/** The layout a notebook draws: its own, else the default (the shortlist). */
export function notebookLayoutOf(nb: { layout?: NotebookLayout }): NotebookLayout {
  return nb.layout ?? DEFAULT_NOTEBOOK_LAYOUT;
}

const LAYOUT_PATH = /^\/notebook\/layout\/([A-Za-z]+)$/;

function whenHolds(when: unknown, flags: Partial<Record<NotebookLayoutFlag, boolean>>): boolean {
  if (typeof when !== 'string') return true;
  const not = when.startsWith('!');
  const on = !!flags[(not ? when.slice(1) : when) as NotebookLayoutFlag];
  return not ? !on : on;
}

function resolveValues(v: unknown, values: Partial<Record<NotebookLayoutValueKey, unknown>>): unknown {
  if (Array.isArray(v)) return v.map((x) => resolveValues(x, values));
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (typeof o.path === 'string' && Object.keys(o).length === 1) {
    const m = LAYOUT_PATH.exec(o.path);
    if (m) return values[m[1] as NotebookLayoutValueKey];
    return v;
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    const r = resolveValues(x, values);
    if (r !== undefined) out[k] = r;
  }
  return out;
}

/**
 * How long a list part may run, so no one part takes over the page: a
 * default when the layout doesn't say, and a most it may show before "Show N
 * more". (The shortlist's own grid isn't capped: it's the page.)
 */
export const NOTEBOOK_LIST_CAPS: Readonly<Record<string, { prop: string; default?: number; max: number }>> = {
  QuoteList: { prop: 'maxItems', default: 4, max: 6 },
  Agenda: { prop: 'maxQuestions', default: 3, max: 5 },
  Timeline: { prop: 'maxItems', default: 6, max: 8 },
  Table: { prop: 'maxRows', default: 8, max: 12 },
};

function capLength(c: ViewComponent): ViewComponent {
  const cap = NOTEBOOK_LIST_CAPS[c.component];
  if (!cap) return c;
  const v = c[cap.prop];
  // A table that pages is already short.
  if (c.component === 'Table' && c.pageSize !== undefined) return c;
  if (typeof v === 'number') return v > cap.max ? { ...c, [cap.prop]: cap.max } : c;
  return cap.default !== undefined ? { ...c, [cap.prop]: cap.default } : c;
}

/** Whether a data value has something to show. */
const hasSomething = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null);

/**
 * A part with nothing to show: every data path the parts under it are bound
 * to (not its own title or note, nor the page's settings) is empty. A part
 * bound to nothing is never empty (it says what it says).
 */
function isEmptyPart(id: string, byId: ReadonlyMap<string, ViewComponent>, data: unknown): boolean {
  const paths: string[] = [];
  const collect = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.path === 'string' && Object.keys(o).length === 1) { if (!LAYOUT_PATH.test(o.path)) paths.push(o.path); return; }
    Object.values(o).forEach(collect);
  };
  const walk = (cid: string, own: boolean, seen: Set<string>) => {
    const c = byId.get(cid);
    if (!c || seen.has(cid)) return;
    seen.add(cid);
    const { id: _i, component: _c, children, child, title: _t, note: _n, label: _l, ...props } = c;
    collect(own ? props : { ...props, title: c.title, note: c.note, label: c.label });
    for (const k of Array.isArray(children) ? children as string[] : typeof child === 'string' ? [child] : []) walk(k, false, seen);
  };
  walk(id, true, new Set());
  return paths.length > 0 && !paths.some((p) => hasSomething(resolvePointer(data, p)));
}

/**
 * An agenda of the notebook's talking points shows what to watch for too,
 * and an Edit link once sua has written them (pages drawn before there was
 * either).
 */
function withWatch(c: ViewComponent): ViewComponent {
  if (c.component !== 'Agenda') return c;
  const points = c.points as { path?: unknown } | undefined;
  if (points?.path !== '/notebook/talkingPoints') return c;
  return { ...c, ...(c.watch === undefined ? { watch: { path: '/notebook/watch' } } : {}), ...(c.editHref === undefined ? { editHref: { path: '/notebook/talkingPointsEdit' } } : {}) };
}

/**
 * A layout as plain A2UI for one notebook: components whose `when` doesn't
 * hold are left out (with everything under them), parents lose them (a
 * Columns its width too; one left takes the whole row), containers left
 * empty go, and `/notebook/layout/<key>` values are filled in. With `data`
 * (the notebook's data model), a panel or fold with nothing in it yet (every
 * part under it bound to data that's empty) goes the same way, so a drawn
 * page has no empty boxes: its notes before there are any, its decision
 * before it's decided.
 */
export function resolveNotebookLayout(
  components: readonly ViewComponent[],
  flags: Partial<Record<NotebookLayoutFlag, boolean>>,
  values: Partial<Record<NotebookLayoutValueKey, unknown>>,
  opts: { data?: unknown } = {},
): ViewComponent[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const out = new Map<string, ViewComponent>();
  const visit = (id: string): boolean => {
    const c = byId.get(id);
    if (!c || !whenHolds(c.when, flags)) return false;
    if (opts.data !== undefined && (c.component === 'Panel' || c.component === 'Disclosure') && isEmptyPart(id, byId, opts.data)) return false;
    const { when: _w, ...rest } = c;
    const next = withWatch(capLength(resolveValues(rest, values) as ViewComponent));
    if (Array.isArray(c.children)) {
      const kids = c.children as string[];
      const kept = kids.filter((k) => visit(k));
      if (!kept.length && id !== 'root') return false;
      next.children = kept;
      if (Array.isArray(c.widths) && kept.length !== kids.length) {
        next.widths = kept.length === 1 ? [1] : kept.map((k) => (c.widths as number[])[kids.indexOf(k)] ?? 1);
      }
    } else if (typeof c.child === 'string' && !visit(c.child)) {
      return false;
    }
    // The header's side part: drawn if it holds, else the header goes without it.
    if (c.component === 'NotebookHeader' && typeof c.side === 'string' && !visit(c.side)) delete next.side;
    out.set(id, next);
    return true;
  };
  visit('root');
  // In the document's own order.
  return components.filter((c) => out.has(c.id)).map((c) => out.get(c.id)!);
}

/**
 * A drawn page's header, taken out of its layout: the page draws the header
 * itself (its buttons are forms), as the `NotebookHeader` says, with its
 * `side` part as a small layout of its own. `rest` is the page without them.
 * No header: the page's usual one.
 */
export function splitNotebookHeader(components: readonly ViewComponent[]): { header?: ViewComponent; side?: ViewComponent[]; rest: ViewComponent[] } {
  const header = components.find((c) => c.component === 'NotebookHeader');
  if (!header) return { rest: [...components] };
  const byId = new Map(components.map((c) => [c.id, c]));
  const under = (id: string, into: Set<string>) => {
    const c = byId.get(id);
    if (!c || into.has(id)) return;
    into.add(id);
    for (const k of Array.isArray(c.children) ? c.children as string[] : []) under(k, into);
    if (typeof c.child === 'string') under(c.child, into);
  };
  const sideIds = new Set<string>();
  if (typeof header.side === 'string') under(header.side, sideIds);
  const rest = components
    .filter((c) => c.id !== header.id && !sideIds.has(c.id))
    .map((c) => (Array.isArray(c.children) && (c.children as string[]).includes(header.id) ? { ...c, children: (c.children as string[]).filter((k) => k !== header.id) } : c));
  const side = typeof header.side === 'string' && sideIds.size
    ? [{ id: 'root', component: 'Column', children: [header.side] }, ...components.filter((c) => sideIds.has(c.id))]
    : undefined;
  return { header, ...(side ? { side } : {}), rest };
}

/** Row shapes a drawn page may use (DESIGN.md "Notebook pages"): full width, or these Columns widths. */
const ROW_SHAPES = new Set(['2:1', '1:2', '3:2', '2:3', '1:1', '1:1:1']);
const LONG_LISTS = new Set(['QuoteList', 'Table', 'Timeline', 'OptionGrid']);

/**
 * Where a drawn page breaks the editorial rhythm (DESIGN.md "Notebook
 * pages"): too many framed parts, more than one lede, a long list in an
 * aside, a row shape off the list, or two rows in a row with the same shape.
 * Empty when it reads well. Advice for whoever draws it, not a check every
 * page must pass (the shortlist is all frames).
 */
export function pageRhythm(components: readonly ViewComponent[]): string[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const out: string[] = [];
  const panels = components.filter((c) => c.component === 'Panel');
  const framed = panels.filter((c) => !c.treatment || c.treatment === 'plain');
  if (framed.length > 3) out.push(`${String(framed.length)} parts are framed (plain); at most 3. Give the others a treatment: lede, feature, aside or band.`);
  const ledes = panels.filter((c) => c.treatment === 'lede');
  if (ledes.length > 1) out.push(`${String(ledes.length)} ledes (${ledes.map((c) => c.id).join(', ')}); a page has one.`);
  const holds = (id: unknown, seen = new Set<string>()): string | undefined => {
    const c = typeof id === 'string' ? byId.get(id) : undefined;
    if (!c || seen.has(c.id)) return undefined;
    seen.add(c.id);
    if (LONG_LISTS.has(c.component)) return c.component;
    for (const k of [...(Array.isArray(c.children) ? c.children as string[] : []), ...(typeof c.child === 'string' ? [c.child] : [])]) {
      const found = holds(k, seen);
      if (found) return found;
    }
    return undefined;
  };
  for (const a of panels.filter((c) => c.treatment === 'aside')) {
    const list = holds(a.child);
    if (list) out.push(`${a.id} is an aside holding a ${list}; long lists go in a feature or a fold.`);
  }
  const ratio = (w: unknown[]) => {
    const n = w.map((x) => Number(x) || 1);
    const g = n.reduce((a, b) => { let x = a; let y = b; while (y) [x, y] = [y, x % y]; return x; });
    return n.map((x) => String(x / g)).join(':');
  };
  // A short part beside a long one leaves a hole under the short one (a cover beside a long agenda).
  const SHORT = new Set(['ProfileCard', 'Callout', 'StatStrip', 'ChipList', 'Metric', 'Badge', 'KeyValue', 'Text', 'Image', 'Link']);
  const kinds = (id: unknown, seen = new Set<string>()): Set<string> => {
    const c = typeof id === 'string' ? byId.get(id) : undefined;
    const out = new Set<string>();
    if (!c || seen.has(c.id)) return out;
    seen.add(c.id);
    out.add(c.component);
    for (const k of [...(Array.isArray(c.children) ? c.children as string[] : []), ...(typeof c.child === 'string' ? [c.child] : [])]) for (const x of kinds(k, seen)) out.add(x);
    return out;
  };
  const isLong = (id: string) => [...kinds(id)].some((k) => LONG_LISTS.has(k) || k === 'Agenda' || k === 'Checklist');
  const isShort = (id: string) => { const k = [...kinds(id)].filter((x) => !['Panel', 'Column', 'Row', 'Card'].includes(x)); return k.length > 0 && k.every((x) => SHORT.has(x)); };
  for (const c of components.filter((x) => x.component === 'Columns' && Array.isArray(x.children))) {
    const kids = c.children as string[];
    const short = kids.find(isShort);
    const long = kids.find(isLong);
    if (short && long) out.push(`${c.id} puts a short part (${short}) beside a long one (${long}), which leaves a hole under ${short}. Pair ${short} with facts or other short parts, and give ${long} a row or a column of its own.`);
  }
  const rows = ((byId.get('root')?.children as string[] | undefined) ?? []).map((id) => byId.get(id)).filter((c): c is ViewComponent => !!c && c.component !== 'NotebookHeader');
  let last = '';
  for (const r of rows) {
    const shape = r.component === 'Columns' ? ratio(Array.isArray(r.widths) ? r.widths as unknown[] : (r.children as unknown[]).map(() => 1)) : 'full';
    if (shape !== 'full' && !ROW_SHAPES.has(shape)) out.push(`${r.id} is ${shape}; rows are full width, 2:1, 1:2, 3:2, 2:3, 1:1 or 1:1:1.`);
    if (shape !== 'full' && shape === last) out.push(`${r.id} has the same shape (${shape}) as the row before it; vary them.`);
    last = shape;
  }
  return out;
}

const SAMPLE_FLAGS = Object.fromEntries(Object.keys(NOTEBOOK_LAYOUT_FLAGS).map((k) => [k, true])) as Record<NotebookLayoutFlag, boolean>;
const SAMPLE_VALUES: Record<NotebookLayoutValueKey, unknown> = {
  mapNote: 'price by measure', xLabel: 'Measure', yLabel: 'Price', xFormat: 'number', yFormat: 'money',
  xBetter: 'higher', yBetter: 'lower', sort: 'price', filters: ['added'], csvHref: '/notebooks/x/shortlist.csv',
  stageChips: false, onlyChosen: true,
};

/**
 * Check a layout: as a notebook with everything would draw it, it must be a
 * valid A2UI view (the catalog's components and props, a root, nothing
 * dangling), and every `when` must name a known flag.
 */
export function checkNotebookLayout(components: unknown): { ok: true; components: ViewComponent[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(components)) return { ok: false, errors: ['A layout is a list of components.'] };
  const errors: string[] = [];
  for (const c of components as Array<Record<string, unknown>>) {
    if (c && typeof c === 'object' && c.when !== undefined) {
      const w = typeof c.when === 'string' ? c.when.replace(/^!/, '') : '';
      if (!(w in NOTEBOOK_LAYOUT_FLAGS)) errors.push(`${String(c.id)}: "when" must be one of ${Object.keys(NOTEBOOK_LAYOUT_FLAGS).join(', ')} (or !one).`);
    }
  }
  const headers = (components as Array<Record<string, unknown>>).filter((c) => c && c.component === 'NotebookHeader');
  if (headers.length > 1) errors.push('A page has at most one NotebookHeader.');
  for (const h of headers) {
    if (h.side !== undefined && !(components as Array<Record<string, unknown>>).some((c) => c && c.id === h.side)) errors.push(`${String(h.id)}: its side "${String(h.side)}" isn't a component of the page.`);
  }
  if (errors.length) return { ok: false, errors };
  const v = validateViewComponents(resolveNotebookLayout(components as ViewComponent[], SAMPLE_FLAGS, SAMPLE_VALUES));
  if (!v.ok) return v;
  return { ok: true, components: components as ViewComponent[] };
}

/**
 * A layout as given: a preset id, `{ preset }`, or `{ components }` (sua's
 * or a template's). Kept only when it checks out (checkNotebookLayout).
 */
export function cleanLayout(raw: unknown): NotebookLayout | undefined {
  if (typeof raw === 'string') return layoutPreset(raw.trim())?.layout;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as { preset?: unknown; components?: unknown; about?: unknown };
  const preset = typeof r.preset === 'string' ? layoutPreset(r.preset) : undefined;
  if (r.components === undefined) return preset?.layout;
  const v = checkNotebookLayout(r.components);
  if (!v.ok) return undefined;
  const about = typeof r.about === 'string' ? r.about.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  return { ...(preset ? { preset: preset.id } : {}), components: v.components, ...(about ? { about } : {}) };
}

/** What a layout can bind to under `/notebook/...` (the page's data; add paths, never rename them). */
export const NOTEBOOK_LAYOUT_DATA: Readonly<Record<string, string>> = {
  '/notebook/title': 'Its title.',
  '/notebook/statement': 'What it\'s for.',
  '/notebook/status': 'active | decided | stopped.',
  '/notebook/decision': 'The decision, once decided.',
  '/notebook/summary': 'Where it stands, a paragraph (markdown), written for a shortlist (in the running, the best lead).',
  '/notebook/next': 'The next thing to do, one line, written for a shortlist.',
  '/notebook/statItems': 'A shortlist\'s stats (in the running, best price or fit, furthest along, ruled out) as [{label, value, sub?}] (StatStrip, KeyValue).',
  '/notebook/stats': '{active, best, bestLabel, furthest, ruledOut} as text.',
  '/notebook/steps': 'Done-whens as [{text, met}] (Steps).',
  '/notebook/progress': '{met, total} done-whens.',
  '/notebook/limits': 'Its limits, as text.',
  '/notebook/limitChips': 'Limits as chips, disagreeing ones flagged (ChipList).',
  '/notebook/fields': 'The facts each option notes: [{key, label, type, role?}].',
  '/notebook/stages': 'The stages options move through by hand, in order, as text (OptionGrid stages).',
  '/notebook/options': 'Options, best first then ruled out: {id, name, title, body, fields: {<key>: value}, price?, measure?, score?, org?, place?, link?, image?, when?, stage?, ruledOut?, chosen?, page, facets?}. Rows for OptionGrid, Table, Scatter.',
  '/notebook/funnel': 'How far options got, per step or stage (Funnel).',
  '/notebook/checklist': 'Checks on the top two (Checklist).',
  '/notebook/timeline': 'Searches, runs, rulings, notes, newest first (Timeline).',
  '/notebook/notes': 'Notes: [{title, body, by, at}].',
  '/notebook/evidence': 'Evidence entries: [{title, body, by, at}].',
  '/notebook/decisions': 'Decisions: [{title, body, by, at}].',
  '/notebook/coverage/sources': 'Where the last search looked (Coverage).',
  '/notebook/coverage/when': 'When that was.',
  '/notebook/bands/price': 'The price limits as {min, max} (Scatter yBand).',
  '/notebook/bands/measure': 'The measure limits as {min, max} (Scatter xBand).',
  '/notebook/quotes': 'What each option says (its quote field: evidence, what they said), chosen first, grouped by its short label (QuoteList items).',
  '/notebook/talkingPoints': 'The talking points sua wrote (a write step), each with why it matters and what they said it rests on; before then, the chosen options (else the first 5) with their questions (Agenda points).',
  '/notebook/questions': 'Questions to ask: the ones sua wrote, else the other options\' (their ask field) (Agenda questions).',
  '/notebook/watch': 'What to watch for in the meeting, from what sua wrote (Agenda watch).',
  '/notebook/answer/question': 'The question the notebook answers (what it\'s for) (a Panel note).',
  '/notebook/answer/label': 'The answer\'s label with how sure ("Answer · fairly sure"); before there is one, "Where it stands" (Callout label).',
  '/notebook/answer/text': 'The answer a write step wrote; before then, where the notebook stands (Callout text).',
  '/notebook/answer/next': 'Why that confidence; before an answer, what\'s next (Callout next).',
  '/notebook/answer/nextLabel': '"How sure:" with an answer, else "Next:" (Callout nextLabel).',
  '/notebook/findings': 'The findings the answer rests on, each linked to the options (sources) it came from (Agenda points).',
  '/notebook/openQuestions': 'What the answer leaves open: questions it couldn\'t settle or what to do next (Agenda questions).',
  '/notebook/planIntro/label': '"The plan" once a write step wrote one; before, "Where it stands" (Callout label).',
  '/notebook/planIntro/text': 'The plan in a sentence or two; before then, where the notebook stands (Callout text).',
  '/notebook/planIntro/next': 'Before a plan, what\'s next (Callout next).',
  '/notebook/planDays': 'The plan by day, week or slot, in order: [{when, items: [{text, note, refs}]}] (Itinerary days).',
  '/notebook/planBefore': 'What to book, buy or do before the plan starts (Itinerary before).',
  '/notebook/planOpen': 'What the plan leaves open, still to decide (Itinerary open).',
  '/notebook/changesIntro/label': '"Since <the search before> · checked <the latest>"; a first look; before any search, "Where it stands" (Callout label).',
  '/notebook/changesIntro/text': 'What changed in a line ("2 new, 1 price change"), or that nothing did (Callout text).',
  '/notebook/changesIntro/next': 'Before any search, what\'s next (Callout next).',
  '/notebook/changes': 'What changed since the search before the latest: [{kind: new | price | changed | gone | missing, title, detail, href, tone}] (Changes items).',
  '/notebook/talkingPointsEdit': 'Where to edit the talking points sua wrote, once there are some (Agenda editHref).',
  '/notebook/person': 'Who it\'s about, once a profile step learned it: {name, role?, org?, about?, image?, imageFrom?, imageWhy?, rejectHref?, links, asOf} (ProfileCard props, each bound to its own path: /notebook/person/name, /notebook/person/role…; bind imageFrom, imageWhy and rejectHref with image so the photo says where it came from and can be refused).',
  '/notebook/company': 'Their company (or the company it\'s about), the same shape (ProfileCard).',
  '/notebook/facts': 'What was learned about them, each {label, value, url, group} (FactSheet facts).',
  '/notebook/notFound': 'What was looked for about them and not found (FactSheet missing).',
  '/notebook/leadQuote': 'The first thing they said (the top quote), as text: a cover\'s pull quote.',
  '/notebook/otherQuotes': 'The quotes after that one (QuoteList items, when the pull quote is shown).',
  '/notebook/personFacts': 'What was learned about the person only (FactSheet facts beside their cover).',
  '/notebook/companyFacts': 'What was learned about their company only (FactSheet facts beside its card).',
  '/notebook/affiliations': 'The other companies the person leads, founded or works with, each {company: {label, url?}, role, what (what it does, its industry and stage), source: {label, url}} (Table rows; link columns).',
  '/notebook/competitors': 'The company\'s competitors, each {competitor: {label, url?}, how, source: {label, url}} (Table rows: the competitor linked to its site, how it competes, the page that names it; link columns).',
  '/notebook/shortlistNote': 'How the shortlist is ranked.',
  '/notebook/limitsNote': 'How many limits disagree.',
};

/**
 * How to draw a notebook's page, for sua: the shape, what it can bind to,
 * the `when` flags and `/notebook/layout/` settings, and the components.
 */
export function notebookLayoutGuide(components: ReadonlyArray<{ name: string; summary: string; example?: Record<string, unknown> }>): string {
  const line = (k: string, v: string) => `- ${k}: ${v}`;
  // Each component's own example shows its props by name: a guessed name ("items" for Steps) fails the check.
  const props = (c: { example?: Record<string, unknown> }) => {
    if (!c.example) return '';
    const { id: _id, component: _c, ...rest } = c.example;
    return ` Props, e.g. ${JSON.stringify(rest)}`;
  };
  return `## A notebook's page (its layout): an A2UI document
A flat list of components; \`root\` is the top; children/child name other ids. Each prop is a literal or { "path": "/notebook/..." }.

Data (bind with { "path": ... }):
${Object.entries(NOTEBOOK_LAYOUT_DATA).map(([k, v]) => line(k, v)).join('\n')}

Notebook settings, filled in per notebook: { "path": "/notebook/layout/<key>" }:
${Object.entries(NOTEBOOK_LAYOUT_VALUES).map(([k, v]) => line(k, v)).join('\n')}

"when" on any component draws it only when the notebook has it ("!flag" for not):
${Object.entries(NOTEBOOK_LAYOUT_FLAGS).map(([k, v]) => line(k, v)).join('\n')}

Components: Text (text, variant: h3 / body / caption), Row, Column, Card (child), Tabs (tabs: [{ title, child }]), Divider, Image (url), plus sua's:
${components.map((c) => line(c.name, c.summary.split(/(?<=[.!?])\s/)[0] + props(c))).join('\n')}

Rules:
- The header (title, status, buttons, steps) is always drawn by the page. To shape it, put a NotebookHeader first in root's children: a subtitle that says what the page is ("Meeting briefing"), cover "none" when the lead option's picture isn't what the notebook is about, steps "fold" once the work is mostly done, and a short \`side\` part (a StatStrip, a short Agenda, a Callout) for what matters at a glance. Don't repeat its title, what it's for, its steps or its done-whens elsewhere.
- Draw it like a magazine page, not a grid of boxes: give each Panel a treatment. One lede opens it (no frame, a teal eyebrow), a feature carries the main story (a rule above), asides hold facts and context beside it (a hairline on the left), a band is a full-width strip; plain (a frame) is for tools, at most 3. Rows are full width or Columns of 2:1, 1:2, 3:2, 2:3, 1:1 or 1:1:1, and two rows in a row never share a shape. Long lists go in a feature or a fold, never an aside. For a person: ProfileCard variant "cover" with a pull quote (/notebook/leadQuote); Agenda variant "numerals"; FactSheet variant "ruled" in an aside; QuoteList lead: true when its first quote should be set large.
- Vary the page: open with a row of 2–3 short parts side by side (Columns), never two long lists stacked at the top. Never put a short part (a cover, a callout, a few stats) beside a long one (an agenda, quotes, a table): it leaves a hole. Pair a cover with the facts about them. A list longer than about 6 rows goes lower, or in a Disclosure. Lists are cut to a few rows with "Show N more" (QuoteList 4–6, Agenda questions 3–5, Timeline 6–8, Table 8–12).
- Lead with what the notebook is for (a briefing leads with what to talk about and what they said; a shortlist with where it stands), then the detail. Summary, next and the stats are written for a shortlist: use them only on one.
- Panel (title, child, note) frames a part; Columns (children, widths) puts parts side by side.
- Bind to paths; never type a value from today's data into the layout: it is redrawn as the notebook changes.
- Use each component's props exactly as named above; a prop it doesn't have fails the whole page. "when" takes only the flags above.
- Keep every id unique (short word characters), at most about 60 components.`;
}

/** One line per component for a change preview: "Panel “Shortlist”", "Timeline". */
function componentLabel(c: ViewComponent): string {
  const t = typeof c.title === 'string' ? c.title : typeof c.label === 'string' ? c.label : '';
  return t ? `${c.component} “${t}”` : c.component;
}

/**
 * What a layout change does, for its card: the parts it adds, removes and
 * changes, by id; and whether the top-level order moved.
 */
export function describeLayoutChange(before: NotebookLayout, after: NotebookLayout): Array<{ what: string; before: string; after: string }> {
  const b = new Map(before.components.map((c) => [c.id, c]));
  const a = new Map(after.components.map((c) => [c.id, c]));
  const added = after.components.filter((c) => !b.has(c.id)).map(componentLabel);
  const removed = before.components.filter((c) => !a.has(c.id)).map(componentLabel);
  const changed = after.components.filter((c) => b.has(c.id) && JSON.stringify(b.get(c.id)) !== JSON.stringify(c)).map(componentLabel);
  const order = (l: NotebookLayout) => ((l.components.find((c) => c.id === 'root')?.children as string[] | undefined) ?? []).join(' → ');
  const out: Array<{ what: string; before: string; after: string }> = [];
  if (after.preset !== before.preset && after.preset) out.push({ what: 'layout', before: before.preset ?? 'custom', after: after.preset });
  if (order(before) !== order(after)) out.push({ what: 'top to bottom', before: order(before) || '—', after: order(after) || '—' });
  if (added.length) out.push({ what: 'adds', before: '—', after: added.slice(0, 12).join(', ') + (added.length > 12 ? ` and ${String(added.length - 12)} more` : '') });
  if (removed.length) out.push({ what: 'removes', before: '—', after: removed.slice(0, 12).join(', ') + (removed.length > 12 ? ` and ${String(removed.length - 12)} more` : '') });
  if (changed.length) out.push({ what: 'changes', before: '—', after: changed.slice(0, 12).join(', ') + (changed.length > 12 ? ` and ${String(changed.length - 12)} more` : '') });
  return out.length ? out : [{ what: 'layout', before: '—', after: 'no change' }];
}
