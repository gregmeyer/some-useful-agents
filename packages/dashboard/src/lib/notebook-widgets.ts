/**
 * A notebook's widgets (notebooks step 2): its default layout as an A2UI view
 * bound to the notebook's data (`/notebook/...`, the same shape for every
 * notebook), so the same components draw a car search, a job hunt or a
 * shopping list, and can later be arranged or placed on a board.
 *
 * The layout: a one-line summary, a stats row, the funnel beside the market
 * map (price against the main measure, with the limits shaded), and the
 * shortlist (cards or a table) with Move / Rule out.
 */
import {
  notebookViewData, cleanData, fieldNumber, validateViewComponents, viewToMessages,
  type Notebook, type NotebookEntry, type NotebookField, type NotebookViewHistory, type NotebookViewData, type NotebookRange, type ViewComponent,
} from '@some-useful-agents/core';

/** Words a limit uses for a field's unit ("mi" → "miles"). */
const UNIT_WORDS: Record<string, string[]> = {
  mi: ['mi', 'mile', 'miles', 'mileage'],
  km: ['km', 'kilometers', 'kilometres'],
  'sq ft': ['sq ft', 'sqft', 'square feet'],
  min: ['min', 'mins', 'minute', 'minutes', 'commute'],
};

/**
 * The ranges a notebook's limits set for its price and main measure, read from
 * their text: "$3k-$6k budget" → price 3000–6000, "130k-190k miles" → measure.
 * The latest limit that names a range wins; a limit with one number isn't a range.
 */
export function limitBands(nb: Pick<Notebook, 'params' | 'fields'>): { price?: NotebookRange; measure?: NotebookRange } {
  const out: { price?: NotebookRange; measure?: NotebookRange } = {};
  const range = (text: string): NotebookRange | undefined => {
    const v = cleanData({ r: text }, [{ key: 'r', label: 'r', type: 'number', range: true }]).r;
    return v && typeof v === 'object' && v.max > v.min ? v : undefined;
  };
  const measure = nb.fields.find((f) => f.role === 'measure');
  const words = measure?.unit ? (UNIT_WORDS[measure.unit.toLowerCase()] ?? [measure.unit.toLowerCase()]) : [];
  for (const p of nb.params) {
    const lower = p.toLowerCase();
    const r = range(p);
    if (!r) continue;
    if (/\$|budget|price|salary|pay/.test(lower)) out.price = r;
    else if (words.some((w) => lower.includes(w))) out.measure = r;
  }
  return out;
}

export interface NotebookWidgetData extends NotebookViewData {
  notebook: NotebookViewData['notebook'] & {
    bands: { price?: NotebookRange; measure?: NotebookRange };
    summary: string;
    stats: { active: string; best: string; bestLabel: string; furthest: string; ruledOut: string };
  };
}

/** The notebook's data plus what the default widgets show: limit bands, a summary line, stats. */
export function notebookWidgetData(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookViewHistory): NotebookWidgetData {
  const { notebook: v } = notebookViewData(nb, entries, history);
  const priceF = nb.fields.find((f) => f.role === 'price');
  const better = priceF?.better ?? 'lower';
  const active = v.options.filter((o) => !o.ruledOut);
  const priced = active.filter((o) => o.price !== undefined).sort((a, b) => (better === 'lower' ? a.price! - b.price! : b.price! - a.price!));
  const best = priced[0];
  const money = (f: NotebookField | undefined, n: number | undefined) => (n === undefined ? '' : f?.type === 'money' ? `$${Math.round(n).toLocaleString('en-US')}` : n.toLocaleString('en-US'));
  const furthest = [...v.funnel].reverse().find((s) => s.here > 0)?.stage ?? '';
  const nextCriterion = v.criteria.find((c) => !c.met)?.text;
  const summary = active.length === 0
    ? (v.options.length ? `All ${String(v.options.length)} options are ruled out.` : 'No options yet. Ask sua to search, or tell it about one you saw.')
    : [
      `**${String(active.length)} in the running**${v.ruledOutCount ? `, ${String(v.ruledOutCount)} ruled out` : ''}.`,
      best ? `Best ${better === 'higher' ? 'pay' : 'price'}: **${money(priceF, fieldNumber(best.fields[priceF!.key]) ?? best.price)}**, ${best.title.split(',')[0]}.` : '',
      furthest && furthest !== v.stages[0] ? `Furthest along: ${furthest}.` : '',
      nextCriterion ? `Next: ${nextCriterion}.` : '',
    ].filter(Boolean).join(' ');
  return {
    notebook: {
      ...v,
      bands: limitBands(nb),
      summary,
      stats: {
        active: String(active.length),
        best: best ? money(priceF, best.price) : '—',
        bestLabel: `Best ${better === 'higher' ? (priceF?.label ?? 'pay').toLowerCase() : (priceF?.label ?? 'price').toLowerCase()}`,
        furthest: furthest || '—',
        ruledOut: String(v.ruledOutCount),
      },
    },
  };
}

/** The default layout: what a notebook with options looks like as widgets. */
export function notebookWidgetComponents(nb: Pick<Notebook, 'fields' | 'stages'>): ViewComponent[] {
  const priceF = nb.fields.find((f) => f.role === 'price');
  const measureF = nb.fields.find((f) => f.role === 'measure');
  const hasMap = !!(priceF && measureF);
  const hasFunnel = nb.stages.length > 1;
  const middle = [hasFunnel ? 'funnel_card' : '', hasMap ? 'map_card' : ''].filter(Boolean);
  const c: ViewComponent[] = [
    { id: 'root', component: 'Column', children: ['summary', 'stats', ...(middle.length ? ['middle'] : []), 'shortlist_card'] },
    { id: 'summary', component: 'Text', text: { path: '/notebook/summary' } },
    { id: 'stats', component: 'Row', children: ['s_active', 's_best', 's_furthest', 's_out'] },
    { id: 's_active', component: 'Metric', label: 'In the running', value: { path: '/notebook/stats/active' } },
    { id: 's_best', component: 'Metric', label: { path: '/notebook/stats/bestLabel' }, value: { path: '/notebook/stats/best' }, tone: 'ok' },
    { id: 's_furthest', component: 'Metric', label: 'Furthest along', value: { path: '/notebook/stats/furthest' } },
    { id: 's_out', component: 'Metric', label: 'Ruled out', value: { path: '/notebook/stats/ruledOut' } },
  ];
  if (middle.length) c.push({ id: 'middle', component: 'Row', children: middle, align: 'start' });
  if (hasFunnel) {
    c.push(
      { id: 'funnel_card', component: 'Card', child: 'funnel_col', weight: 2 },
      { id: 'funnel_col', component: 'Column', children: ['funnel_title', 'funnel'] },
      { id: 'funnel_title', component: 'Text', text: 'How far they got', variant: 'h4' },
      { id: 'funnel', component: 'Funnel', stages: { path: '/notebook/funnel' } },
    );
  }
  if (hasMap) {
    c.push(
      { id: 'map_card', component: 'Card', child: 'map_col', weight: 3 },
      { id: 'map_col', component: 'Column', children: ['map_title', 'map'] },
      { id: 'map_title', component: 'Text', text: `Where they sit: ${priceF!.label.toLowerCase()} by ${measureF!.label.toLowerCase()}`, variant: 'h4' },
      {
        id: 'map', component: 'Scatter', points: { path: '/notebook/options' }, x: 'measure', y: 'price',
        xLabel: measureF!.label, yLabel: priceF!.label, xFormat: measureF!.type === 'money' ? 'money' : 'number', yFormat: priceF!.type === 'money' ? 'money' : 'number',
        xBand: { path: '/notebook/bands/measure' }, yBand: { path: '/notebook/bands/price' },
        ...(measureF!.better ? { xBetter: measureF!.better } : {}), yBetter: priceF!.better ?? 'lower',
      },
    );
  }
  c.push(
    { id: 'shortlist_card', component: 'Card', child: 'shortlist_col' },
    { id: 'shortlist_col', component: 'Column', children: ['shortlist_title', 'shortlist'] },
    { id: 'shortlist_title', component: 'Text', text: 'Shortlist', variant: 'h4' },
    { id: 'shortlist', component: 'OptionGrid', options: { path: '/notebook/options' }, fields: { path: '/notebook/fields' }, stages: { path: '/notebook/stages' }, layout: 'grid', sort: 'price', actions: true },
  );
  return c;
}

/** The notebook's widgets as A2UI messages, or undefined when it has nothing to show as widgets yet. */
export function notebookWidgetMessages(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookViewHistory): unknown[] | undefined {
  if (nb.fields.length === 0 || !entries.some((e) => e.kind === 'option')) return undefined;
  const v = validateViewComponents(notebookWidgetComponents(nb));
  if (!v.ok) return undefined;
  return viewToMessages(`notebook-${nb.id}`, v.components, notebookWidgetData(nb, entries, history));
}
