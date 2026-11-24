/**
 * A notebook page's charts as pictures, for its brief and PDF (ADR-0091): each
 * VegaChart on the page drawn to SVG on the server with the same vendored
 * Vega the browser uses (assets/vendor/a2ui-vega.js, its vegaToSvg), with no
 * eval and nothing fetched, then kept as an image (a data: URI), so nothing
 * in it can run. A chart that can't be drawn is left out of the map; the
 * brief prints its data instead.
 */
import { notebookLayoutOf, type Notebook, type NotebookEntry, type ViewComponent } from '@some-useful-agents/core';
import { notebookWidgetData, type NotebookWidgetHistory } from './notebook-widgets.js';
import { printValue } from './a2ui-print-values.js';
import { agentFunctionValue } from './a2ui-agent-functions.js';

type VegaModule = { vegaToSvg: (spec: Record<string, unknown>, options?: { config?: Record<string, unknown> }) => Promise<string> };
let vega: Promise<VegaModule> | undefined;
/** The vendored Vega, loaded once, the first time a brief has a chart. */
const loadVega = (): Promise<VegaModule> => (vega ??= import(new URL('../assets/vendor/a2ui-vega.js', import.meta.url).href) as Promise<VegaModule>);

/** Paper's colours: the brief prints light. */
const PAPER = {
  background: 'white', font: 'Inter, system-ui, sans-serif',
  axis: { domainColor: '#d6d3d1', gridColor: '#e7e5e4', tickColor: '#d6d3d1', labelColor: '#57534e', titleColor: '#1c1917' },
  legend: { labelColor: '#57534e', titleColor: '#1c1917' }, title: { color: '#1c1917' }, view: { stroke: 'transparent' },
  range: { category: ['#0f766e', '#64748b', '#b45309', '#2563eb', '#be123c', '#4d7c0f'] }, mark: { color: '#0f766e' },
};

/** A spec with the bindings inside it read from the page's data. */
function resolveSpec(spec: unknown, read: (v: unknown) => unknown): unknown {
  if (Array.isArray(spec)) return spec.map((x) => resolveSpec(x, read));
  if (!spec || typeof spec !== 'object') return spec;
  const o = spec as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1 && (typeof o['@path'] === 'string' || typeof o.path === 'string')) return read(o);
  return Object.fromEntries(keys.map((k) => [k, resolveSpec(o[k], read)]));
}

/** Each VegaChart on the notebook's page, by component id, as an SVG image's data: URI. */
export async function briefChartPictures(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const charts = (notebookLayoutOf(nb)?.components ?? []).filter((c: ViewComponent) => c.component === 'VegaChart');
  if (!charts.length) return out;
  const data = { notebook: notebookWidgetData(nb, entries, history).notebook };
  const agent = (name: string, args: Record<string, unknown>) => { const r = agentFunctionValue(nb, entries, name, args); return 'value' in r ? r.value : undefined; };
  const read = (v: unknown) => printValue(v, { data, agent });
  const m = await loadVega();
  for (const c of charts) {
    const spec = resolveSpec(read(c.spec), read);
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    const height = typeof read(c.height) === 'number' ? read(c.height) as number : 240;
    try {
      const svg = await m.vegaToSvg({ width: 640, height, ...(spec as Record<string, unknown>) }, { config: PAPER });
      out.set(c.id, `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    } catch { /* the brief prints its data */ }
  }
  return out;
}
