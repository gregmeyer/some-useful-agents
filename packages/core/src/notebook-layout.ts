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
import { validateViewComponents, type ViewComponent } from './a2ui/view.js';

/** What `when` can test. */
export const NOTEBOOK_LAYOUT_FLAGS = {
  map: 'It has a price and a measure, so its options can be mapped.',
  funnel: 'It has 2+ steps or stages, so a funnel says how far options got.',
  steps: 'Its work is in steps.',
  options: 'It has options.',
  decided: 'It has a decision.',
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

export const NOTEBOOK_LAYOUT_PRESETS: readonly NotebookLayoutPreset[] = [
  {
    id: 'shortlist',
    label: 'Shortlist',
    when: 'Choosing among many options (a car, a job, a place, accounts to call): ranks them, maps them, narrows them to a pick.',
    layout: { preset: 'shortlist', components: SHORTLIST },
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
 * A layout as plain A2UI for one notebook: components whose `when` doesn't
 * hold are left out (with everything under them), parents lose them (a
 * Columns its width too; one left takes the whole row), containers left
 * empty go, and `/notebook/layout/<key>` values are filled in.
 */
export function resolveNotebookLayout(
  components: readonly ViewComponent[],
  flags: Partial<Record<NotebookLayoutFlag, boolean>>,
  values: Partial<Record<NotebookLayoutValueKey, unknown>>,
): ViewComponent[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const out = new Map<string, ViewComponent>();
  const visit = (id: string): boolean => {
    const c = byId.get(id);
    if (!c || !whenHolds(c.when, flags)) return false;
    const { when: _w, ...rest } = c;
    const next = resolveValues(rest, values) as ViewComponent;
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
    out.set(id, next);
    return true;
  };
  visit('root');
  // In the document's own order.
  return components.filter((c) => out.has(c.id)).map((c) => out.get(c.id)!);
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
  const r = raw as { preset?: unknown; components?: unknown };
  const preset = typeof r.preset === 'string' ? layoutPreset(r.preset) : undefined;
  if (r.components === undefined) return preset?.layout;
  const v = checkNotebookLayout(r.components);
  if (!v.ok) return undefined;
  return { ...(preset ? { preset: preset.id } : {}), components: v.components };
}
