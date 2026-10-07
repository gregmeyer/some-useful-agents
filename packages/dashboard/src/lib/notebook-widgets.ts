/**
 * A notebook's widgets: its default layout as an A2UI view bound to the
 * notebook's data (`/notebook/...`, the same shape for every notebook), so the
 * same components draw a car search, a job hunt or a shopping list, and can
 * later be arranged or placed on a board. The layout follows the "notebook as
 * a story" design (canvas artboard 23):
 *
 *   Where it stands + stats (2/3)  | Done when (ring + steps, 1/3)
 *   Where they sit (map, 2/3)      | How far they got (funnel, 1/3)
 *   Shortlist (cards / table)
 *   Before you decide (1/3)        | How we got here (timeline, 2/3)
 *   Where sua looked (coverage)    | Limits (disagreements flagged)
 */
import {
  notebookViewData, cleanData, fieldNumber, validateViewComponents, viewToMessages,
  type Notebook, type NotebookEntry, type NotebookField, type NotebookViewHistory, type NotebookViewData,
  type NotebookRange, type NotebookSearchSource, type NotebookViewOption, type ViewComponent,
} from '@some-useful-agents/core';

/** What the widgets read from the store beyond the view data: the searches. */
export interface NotebookWidgetHistory extends NotebookViewHistory {
  searches?(notebookId: string, limit?: number): Array<{ agentId: string; runId?: string; at: string; found: number; sources: NotebookSearchSource[] }>;
  /** Recent runs of an agent (to show the ones that failed, which leave nothing in the notebook). */
  recentRuns?(agentId: string): Array<{ id: string; status: string; startedAt: string; error?: string }>;
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

/** Options in the running, best first by price (the better way). */
function ranked(v: NotebookViewData['notebook'], priceF: NotebookField | undefined): NotebookViewOption[] {
  const better = priceF?.better ?? 'lower';
  return v.options.filter((o) => !o.ruledOut).sort((a, b) => {
    if (a.price === undefined) return 1;
    if (b.price === undefined) return -1;
    return better === 'lower' ? a.price - b.price : b.price - a.price;
  });
}

const fmtAge = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return m < 60 ? `${String(m)}m ago` : m < 48 * 60 ? `${String(Math.round(m / 60))}h ago` : `${String(Math.round(m / 1440))}d ago`;
};

export interface NotebookWidgetData extends NotebookViewData {
  notebook: NotebookViewData['notebook'] & {
    bands: { price?: NotebookRange; measure?: NotebookRange };
    summary: string;
    next: string;
    statItems: Array<{ label: string; value: string; tone?: string; sub?: string }>;
    steps: Array<{ text: string; met: boolean; note?: string }>;
    limitChips: Array<{ text: string; tone?: string; title?: string }>;
    limitsNote: string;
    coverage: { sources: NotebookSearchSource[]; when: string };
    checklist: Array<{ id: string; title: string; items: Array<{ text: string; done: boolean }> }>;
    timeline: Array<{ at: string; title: string; body?: string; kind?: string; who?: string; tag?: string; link?: string; linkText?: string; faded?: boolean }>;
    shortlistNote: string;
    /** Kept for older layouts and boards. */
    stats: { active: string; best: string; bestLabel: string; furthest: string; ruledOut: string };
  };
}

/** The checks for options: the notebook's own, else "Still listed" plus the unmet done-whens. */
function checksFor(nb: Notebook): string[] {
  if (nb.checks.length) return nb.checks;
  return ['Still listed', ...nb.criteria.filter((c) => !c.met && !/decid/i.test(c.text)).map((c) => c.text.charAt(0).toUpperCase() + c.text.slice(1))].slice(0, 5);
}

/** The notebook's data plus what the default widgets show. */
export function notebookWidgetData(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory, now = Date.now()): NotebookWidgetData {
  const { notebook: v } = notebookViewData(nb, entries, history);
  const priceF = nb.fields.find((f) => f.role === 'price');
  const better = priceF?.better ?? 'lower';
  const active = ranked(v, priceF);
  const best = active.find((o) => o.price !== undefined);
  const furthest = [...v.funnel].reverse().find((s) => s.here > 0)?.stage ?? '';
  const nextCriterion = v.criteria.find((c) => !c.met)?.text;
  const searches = history?.searches?.(nb.id, 20) ?? [];
  const checks = checksFor(nb);
  const top = active.slice(0, 2);
  const checkedTop = top.reduce((n, o) => n + (o.checked.length >= checks.length && checks.length ? 1 : 0), 0);

  const second = active.filter((o) => o.price !== undefined)[1];
  const summary = active.length === 0
    ? (v.options.length ? `All ${String(v.options.length)} options are ruled out.` : 'No options yet. Ask sua to search, or tell it about one you saw.')
    : [
      `**${String(active.length)} in the running**${searches.length ? ` after ${String(searches.length)} search${searches.length === 1 ? '' : 'es'}` : ''}${v.ruledOutCount ? `, ${String(v.ruledOutCount)} ruled out` : ''}.`,
      best ? `The best lead is the **${best.name}**: ${money(priceF, best.price)}${best.measure !== undefined ? `, ${best.measure.toLocaleString('en-US')}${nb.fields.find((f) => f.role === 'measure')?.unit ? ` ${nb.fields.find((f) => f.role === 'measure')!.unit!}` : ''}` : ''}${best.place ? `, in ${best.place}` : ''}.` : '',
      second && best && second.price !== undefined && best.price !== undefined
        ? `Next best: ${second.name} at ${money(priceF, second.price)}.`
        : '',
      furthest && furthest !== v.stages[0] ? `Furthest along: ${furthest}.` : '',
    ].filter(Boolean).join(' ');
  const next = active.length === 0
    ? 'ask sua to search again, or bring one back.'
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
  // Runs of the agents that feed it that failed (they leave nothing in the notebook).
  if (history?.recentRuns) {
    const feeders = new Set([...nb.pipeline, ...searches.map((s) => s.agentId), ...[...byRun.values()].map((g) => g.agent)]);
    for (const agentId of feeders) {
      for (const r of history.recentRuns(agentId)) {
        if (r.status !== 'failed' || r.startedAt < nb.createdAt) continue;
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

  return {
    notebook: {
      ...v,
      bands: limitBands(nb),
      summary,
      next,
      statItems: [
        { label: 'in the running', value: String(active.length), tone: 'ok' },
        { label: `best ${better === 'higher' ? (priceF?.label ?? 'pay').toLowerCase() : (priceF?.label ?? 'price').toLowerCase()}`, value: best ? money(priceF, best.price) : '—', ...(best ? { sub: best.name.split(' ').slice(0, 3).join(' ') } : {}) },
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
      shortlistNote: `ranked by ${(priceF?.label ?? 'price').toLowerCase()}${better === 'higher' ? ', highest first' : ''}`,
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

const shortOf = (title: string) => title.split(',')[0].trim();

/** At most `n` characters, cut at a word, with "…". */
function clip(text: string, n: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n * 0.6)).replace(/[,;:.\s]+$/, '')}…`;
}

/** The default layout (see the module comment). */
export function notebookWidgetComponents(nb: Pick<Notebook, 'fields' | 'stages'>): ViewComponent[] {
  const priceF = nb.fields.find((f) => f.role === 'price');
  const measureF = nb.fields.find((f) => f.role === 'measure');
  const hasMap = !!(priceF && measureF);
  const hasFunnel = nb.stages.length > 1;
  const panel = (id: string, title: string, child: string, note?: Record<string, unknown> | string): ViewComponent =>
    ({ id, component: 'Panel', title, child, ...(note ? { note } : {}) });
  const c: ViewComponent[] = [
    { id: 'root', component: 'Column', children: ['top', ...(hasMap || hasFunnel ? ['mid'] : []), 'shortlist_panel', 'low', 'ctx'] },
    // Where it stands (two thirds), beside done-when (one third).
    { id: 'top', component: 'Columns', children: ['story', 'steps_panel'], widths: [2, 1] },
    { id: 'story', component: 'Column', children: ['callout', 'stats'] },
    { id: 'callout', component: 'Callout', label: 'Where it stands', text: { path: '/notebook/summary' }, next: { path: '/notebook/next' } },
    { id: 'stats', component: 'StatStrip', items: { path: '/notebook/statItems' } },
    panel('steps_panel', 'Done when', 'steps'),
    { id: 'steps', component: 'Steps', steps: { path: '/notebook/steps' }, label: 'Progress' },
  ];
  if (hasMap || hasFunnel) {
    c.push({ id: 'mid', component: 'Columns', children: [...(hasMap ? ['map_panel'] : []), ...(hasFunnel ? ['funnel_panel'] : [])], widths: hasMap && hasFunnel ? [2, 1] : [1] });
  }
  if (hasMap) {
    c.push(
      panel('map_panel', 'Where they sit', 'map', `${priceF!.label.toLowerCase()} by ${measureF!.label.toLowerCase()} · your limits shaded`),
      {
        id: 'map', component: 'Scatter', points: { path: '/notebook/options' }, x: 'measure', y: 'price', label: 'name',
        xLabel: measureF!.label, yLabel: priceF!.label, xFormat: measureF!.type === 'money' ? 'money' : 'number', yFormat: priceF!.type === 'money' ? 'money' : 'number',
        xBand: { path: '/notebook/bands/measure' }, yBand: { path: '/notebook/bands/price' },
        ...(measureF!.better ? { xBetter: measureF!.better } : {}), yBetter: priceF!.better ?? 'lower',
      },
    );
  }
  if (hasFunnel) {
    c.push(panel('funnel_panel', 'How far they got', 'funnel', 'hover a stage for why'), { id: 'funnel', component: 'Funnel', stages: { path: '/notebook/funnel' } });
  }
  c.push(
    panel('shortlist_panel', 'Shortlist', 'shortlist', { path: '/notebook/shortlistNote' }),
    { id: 'shortlist', component: 'OptionGrid', options: { path: '/notebook/options' }, fields: { path: '/notebook/fields' }, stages: { path: '/notebook/stages' }, layout: 'grid', sort: 'price', actions: true },
    // The timeline is the longer story: two thirds; the checklist's groups stack in its third.
    { id: 'low', component: 'Columns', children: ['check_panel', 'time_panel'], widths: [1, 2], align: 'start' },
    panel('check_panel', 'Before you decide', 'checklist', 'for the top two'),
    { id: 'checklist', component: 'Checklist', groups: { path: '/notebook/checklist' }, actions: true },
    panel('time_panel', 'How we got here', 'timeline', 'newest first'),
    { id: 'timeline', component: 'Timeline', events: { path: '/notebook/timeline' }, maxItems: 8, filters: true },
    { id: 'ctx', component: 'Columns', children: ['cov_panel', 'lim_panel'], widths: [1, 1] },
    panel('cov_panel', 'Where sua looked', 'coverage', { path: '/notebook/coverage/when' }),
    { id: 'coverage', component: 'Coverage', sources: { path: '/notebook/coverage/sources' } },
    panel('lim_panel', 'Limits', 'limits', { path: '/notebook/limitsNote' }),
    { id: 'limits', component: 'ChipList', items: { path: '/notebook/limitChips' } },
  );
  return c;
}

/** The notebook's widgets as A2UI messages, or undefined when it has nothing to show as widgets yet. */
export function notebookWidgetMessages(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory): unknown[] | undefined {
  if (nb.fields.length === 0 || !entries.some((e) => e.kind === 'option')) return undefined;
  const v = validateViewComponents(notebookWidgetComponents(nb));
  if (!v.ok) return undefined;
  return viewToMessages(`notebook-${nb.id}`, v.components, notebookWidgetData(nb, entries, history));
}

export { fieldNumber };
