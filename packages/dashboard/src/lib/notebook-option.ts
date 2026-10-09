/**
 * One option's page (GET /notebooks/:id/entries/:entry): everything the
 * notebook keeps about it, as widgets bound to `/option/...`. The notebook's
 * cards show a few facts and the latest price move; this shows every fact
 * with its source and quote, the price over time, its checks, and its own
 * history (found, seen again, moved, ruled out) with the runs behind each.
 */
import { rankOptions, validateViewComponents, viewToMessages,
  type Notebook, type NotebookEntry, type NotebookField, type NotebookFieldValue, type NotebookViewOption, type ViewComponent,
} from '@some-useful-agents/core';
import { notebookWidgetData, checksFor, type NotebookWidgetHistory } from './notebook-widgets.js';
import { formatFieldValue } from '../views/notebooks.js';

/** The store's sightings carry the run that saw each one. */
export interface NotebookOptionHistory extends NotebookWidgetHistory {
  sightings(entryId: string): Array<{ at: string; runId?: string; correctedBy?: string; data: Record<string, NotebookFieldValue> }>;
}

type TimelineEvent = NotebookOptionData['option']['timeline'][number];

export interface NotebookOptionData {
  option: {
    view: NotebookViewOption;
    /** Its place among those in the running (1 = best), when it's in the running. */
    rank?: number;
    active: number;
    facts: Array<{ label: string; value: string; url?: string; note?: string }>;
    priceLabel: string;
    priceNow: string;
    priceSeries: number[];
    checks: Array<{ id: string; title: string; items: Array<{ text: string; done: boolean }> }>;
    timeline: Array<{ at: string; kind: string; title: string; body?: string; who?: string; link?: string; linkText?: string; faded?: boolean }>;
  };
}

const runLink = (runId?: string) => (runId ? { link: `/runs/${encodeURIComponent(runId)}`, linkText: `run ${runId.slice(0, 8)}` } : {});
const who = (by: string) => (by === 'you' ? 'you' : by.replace(/^(agent|run):/, ''));

/** The option's facts in the notebook's field order: the value (≈ when an estimate), its source, and the words that back it. */
function optionFacts(fields: readonly NotebookField[], v: NotebookViewOption): NotebookOptionData['option']['facts'] {
  const out: NotebookOptionData['option']['facts'] = [];
  for (const f of fields) {
    const value = v.fields[f.key];
    if (value === undefined || value === '' || f.type === 'image' || f.role === 'image') continue;
    const m = v.factMeta?.[f.key];
    const text = f.type === 'url' || f.role === 'link' ? String(value).replace(/^https?:\/\//, '') : formatFieldValue(f, value);
    const url = f.type === 'url' || f.role === 'link' ? String(value) : m?.source;
    const note = [
      m?.quote ? `“${m.quote}”${m.checked ? ' · checked in the source' : ''}` : '',
      m?.estimate ? 'an estimate' : '',
      !m?.quote && m?.source && f.type !== 'url' ? `source: ${m.source.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}` : '',
    ].filter(Boolean).join(' · ');
    out.push({ label: f.label, value: `${m?.estimate ? '≈ ' : ''}${text}`, ...(url ? { url } : {}), ...(note ? { note } : {}) });
  }
  return out;
}

/** What happened to this option, newest first. */
function optionTimeline(nb: Notebook, e: NotebookEntry, history?: NotebookOptionHistory): TimelineEvent[] {
  const priceF = nb.fields.find((f) => f.role === 'price');
  const price = (data: Record<string, NotebookFieldValue>) => (priceF && typeof data[priceF.key] === 'number' ? data[priceF.key] as number : undefined);
  const out: TimelineEvent[] = [];
  const sightings = history?.sightings(e.id) ?? [];
  // The first sighting is when it was found; later ones are searches that found it again.
  out.push({
    at: e.createdAt, kind: e.by.startsWith('agent:') ? 'search' : 'note', who: who(e.by),
    title: e.by === 'you' ? 'You added it' : 'Found', ...(priceF && price(e.data ?? {}) !== undefined && !sightings.length ? { body: `${priceF.label} ${formatFieldValue(priceF, price(e.data ?? {})!)}` } : {}),
    // The run that first found it: the entry's own run moves to the latest search that saw it.
    ...runLink(sightings.length ? sightings[0].runId : e.runId),
  });
  if (sightings[0] && priceF && price(sightings[0].data) !== undefined) out[0].body = `${priceF.label} ${formatFieldValue(priceF, price(sightings[0].data)!)}`;
  let last = sightings[0] ? price(sightings[0].data) : undefined;
  // What it said so far, so a correction can show what it replaced.
  const known: Record<string, NotebookFieldValue> = { ...(sightings[0]?.correctedBy ? {} : sightings[0]?.data ?? {}) };
  for (const s of sightings.filter((x, i) => i > 0 || x.correctedBy)) {
    if (s.correctedBy) {
      const changes = Object.entries(s.data).map(([k, v]) => {
        const f = nb.fields.find((x) => x.key === k);
        const fmt = (x: NotebookFieldValue) => (f ? formatFieldValue(f, x) : String(x));
        return `${f?.label ?? k} ${known[k] !== undefined ? `${fmt(known[k])} → ` : ''}${fmt(v)}`;
      });
      out.push({ at: s.at, kind: 'note', who: who(s.correctedBy), title: 'Corrected', body: changes.join(' · ') });
      Object.assign(known, s.data);
      const p = price(s.data);
      if (p !== undefined) last = p;
      continue;
    }
    Object.assign(known, s.data);
    const p = price(s.data);
    const moved = p !== undefined && last !== undefined && p !== last;
    out.push({
      at: s.at, kind: moved ? 'move' : 'search', title: moved ? `${priceF!.label} ${p! < last! ? 'dropped' : 'went up'}` : 'Seen again',
      ...(p !== undefined && priceF ? { body: moved ? `${formatFieldValue(priceF, last!)} → ${formatFieldValue(priceF, p)}` : `${priceF.label} ${formatFieldValue(priceF, p)}` } : {}),
      ...runLink(s.runId),
    });
    if (p !== undefined) last = p;
  }
  if (e.stage && e.stageAt && e.stage !== nb.stages[0]) out.push({ at: e.stageAt, kind: 'move', title: `Moved to ${e.stage}` });
  if (e.ruledOut) {
    out.push(e.ruledOut.gone
      ? { at: e.ruledOut.at, kind: 'out', who: who(e.ruledOut.by), title: 'No longer available', faded: true }
      : { at: e.ruledOut.at, kind: 'out', who: who(e.ruledOut.by), title: `Ruled out${e.ruledOut.stage ? ` at ${e.ruledOut.stage}` : ''}`, body: e.ruledOut.reason });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Everything the option's page shows; undefined when there's no such option. */
export function notebookOptionData(nb: Notebook, entries: readonly NotebookEntry[], entryId: string, history?: NotebookOptionHistory): NotebookOptionData | undefined {
  const e = entries.find((x) => x.id === entryId && x.kind === 'option');
  if (!e) return undefined;
  const all = notebookWidgetData(nb, entries, history).notebook;
  const view = all.options.find((o) => o.id === e.id);
  if (!view) return undefined;
  const active = rankOptions(nb, all.options);
  const i = active.findIndex((o) => o.id === e.id);
  const priceF = nb.fields.find((f) => f.role === 'price');
  // The notebook's checks (the same list the top two get), ticked for this one.
  const checkList = checksFor(nb);
  return {
    option: {
      view,
      ...(i >= 0 ? { rank: i + 1 } : {}),
      active: active.length,
      facts: optionFacts(nb.fields, view),
      priceLabel: priceF?.label ?? 'Price',
      priceNow: priceF && view.fields[priceF.key] !== undefined ? formatFieldValue(priceF, view.fields[priceF.key]) : '',
      priceSeries: view.priceHistory.map((p) => p.value),
      checks: checkList.length ? [{ id: e.id, title: '', items: checkList.map((c) => ({ text: c, done: view.checked.includes(c) })) }] : [],
      timeline: optionTimeline(nb, e, history),
    },
  };
}

/** The page's widgets: facts (2/3) beside the price and checks (1/3), then its history. */
export function notebookOptionComponents(d: NotebookOptionData): ViewComponent[] {
  const panel = (id: string, title: string, child: string, note?: string): ViewComponent => ({ id, component: 'Panel', title, child, ...(note ? { note } : {}) });
  const side: string[] = [];
  const c: ViewComponent[] = [];
  if (d.option.priceSeries.length >= 2) {
    side.push('price_panel');
    c.push(panel('price_panel', `${d.option.priceLabel} over time`, 'price', `seen ${String(d.option.priceSeries.length)} times`),
      { id: 'price', component: 'Sparkline', values: { path: '/option/priceSeries' }, current: d.option.priceNow });
  }
  if (d.option.checks.length) {
    side.push('check_panel');
    c.push(panel('check_panel', 'Before you decide', 'checks'), { id: 'checks', component: 'Checklist', groups: { path: '/option/checks' }, actions: true });
  }
  const top = d.option.facts.length ? ['facts_panel'] : [];
  const sourced = d.option.facts.some((f) => f.note?.startsWith('source:') || f.note?.startsWith('“'));
  if (d.option.facts.length) c.push(panel('facts_panel', 'What sua knows', 'facts', sourced ? 'sources linked' : undefined), { id: 'facts', component: 'KeyValue', items: { path: '/option/facts' } });
  if (side.length) {
    c.push({ id: 'side', component: 'Column', children: side });
    top.push('side');
  }
  c.push(panel('time_panel', 'Its history', 'timeline', 'newest first'), { id: 'timeline', component: 'Timeline', events: { path: '/option/timeline' }, maxItems: 20 });
  const root: string[] = [];
  if (top.length) { c.push({ id: 'top', component: 'Columns', children: top, widths: top.length === 2 ? [2, 1] : [1], align: 'start' }); root.push('top'); }
  root.push('time_panel');
  return [{ id: 'root', component: 'Column', children: root }, ...c];
}

/** The option's widgets as A2UI messages (undefined if the view didn't validate). */
export function notebookOptionMessages(nb: Notebook, d: NotebookOptionData): unknown[] | undefined {
  const v = validateViewComponents(notebookOptionComponents(d));
  if (!v.ok) return undefined;
  const { view: _view, ...data } = d.option;
  return viewToMessages(`option-${nb.id}-${d.option.view.id}`, v.components, { option: data });
}
