/**
 * A first view for an agent, drawn from what its runs actually output: the
 * starting point the View editor offers (docs/a2ui-views.md). Numbers become
 * metrics (with a trend when there are earlier runs), short text becomes
 * labelled lines, lists become tables or chips, long text a paragraph. With
 * no structured outputs it shows the result text.
 */
import type { ViewComponent } from './view.js';

type C = Record<string, unknown> & { id: string; component: string };

export interface StarterViewArgs {
  /** The latest run's outputs (`/outputs`). */
  outputs: Record<string, unknown>;
  /** `/series`: names with at least two points get a trend line. */
  series?: Record<string, number[]>;
  /** Labels for output names, e.g. from the agent's old outputWidget fields. */
  labels?: Record<string, string>;
}

const MAX_METRICS = 4;
const MAX_LINES = 8;
const SHORT_TEXT = 120;

const bind = (path: string) => ({ path });
const safeId = (name: string, suffix = '') => `o_${name.replace(/[^\w-]/g, '_')}${suffix}`;
const pointer = (name: string) => `/outputs/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;

/** "issue_count" / "issueCount" → "Issue count". */
export function humanizeName(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

function isNumberLike(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && /^\s*[-+]?[$€£]?\s*\d[\d,]*(\.\d+)?\s*%?\s*$/.test(v);
}

export function starterView(args: StarterViewArgs): ViewComponent[] {
  const label = (name: string) => args.labels?.[name] ?? humanizeName(name);
  const comps: C[] = [];
  const parts: string[] = [];
  const metrics: string[] = [];
  const lines: string[] = [];
  let trend: string | undefined;

  // `result` is the raw text when the step printed JSON whose fields are already outputs.
  const hasFields = Object.keys(args.outputs).some((k) => k !== 'result');
  for (const [name, value] of Object.entries(args.outputs)) {
    if (value === null || value === undefined || value === '') continue;
    if (name === 'result' && hasFields) continue;
    const id = safeId(name);
    if (isNumberLike(value)) {
      if (metrics.length >= MAX_METRICS) continue;
      comps.push({ id, component: 'Metric', label: label(name), value: bind(pointer(name)) });
      metrics.push(id);
      if (!trend && (args.series?.[name]?.length ?? 0) >= 2) {
        trend = safeId(name, '_trend');
        comps.push({ id: trend, component: 'Sparkline', label: `${label(name)}, run by run`, values: bind(`/series/${name}`) });
      }
    } else if (Array.isArray(value)) {
      if (value.length > 0 && value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
        const first = value[0] as Record<string, unknown>;
        const keys = Object.keys(first).slice(0, 6);
        const isUrl = (k: string) => typeof first[k] === 'string' && /^https?:\/\//.test(first[k] as string);
        // A link shows the row's first plain-text field (its title or name) instead of the address.
        const textKey = keys.find((k) => typeof first[k] === 'string' && !isUrl(k));
        comps.push(
          { id, component: 'Column', children: [`${id}_l`, `${id}_t`] },
          { id: `${id}_l`, component: 'Text', text: label(name), variant: 'caption' },
          { id: `${id}_t`, component: 'Table', rows: bind(pointer(name)), columns: keys.map((k) => ({ key: k, label: humanizeName(k), ...(isUrl(k) ? { format: 'link', ...(textKey ? { linkText: textKey } : {}) } : {}) })), maxRows: 20 },
        );
        parts.push(id);
      } else if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
        comps.push(
          { id, component: 'Column', children: [`${id}_l`, `${id}_c`] },
          { id: `${id}_l`, component: 'Text', text: label(name), variant: 'caption' },
          { id: `${id}_c`, component: 'ChipList', items: bind(pointer(name)) },
        );
        parts.push(id);
      }
    } else if (typeof value === 'string') {
      if (value.length <= SHORT_TEXT) {
        if (lines.length >= MAX_LINES) continue;
        comps.push(
          { id, component: 'Column', children: [`${id}_l`, `${id}_v`] },
          { id: `${id}_l`, component: 'Text', text: label(name), variant: 'caption' },
          { id: `${id}_v`, component: 'Text', text: bind(pointer(name)) },
        );
        lines.push(id);
      } else {
        comps.push(
          { id, component: 'Column', children: [`${id}_l`, `${id}_v`] },
          { id: `${id}_l`, component: 'Text', text: label(name), variant: 'caption' },
          { id: `${id}_v`, component: 'Text', text: bind(pointer(name)), variant: 'body' },
        );
        parts.push(id);
      }
    }
  }

  const root: string[] = [];
  if (metrics.length) { comps.push({ id: 'metrics', component: 'Row', children: metrics }); root.push('metrics'); }
  if (trend) root.push(trend);
  if (lines.length) { comps.push({ id: 'facts', component: 'Column', children: lines }); root.push('facts'); }
  root.push(...parts);
  if (root.length === 0) {
    comps.push({ id: 'result', component: 'Text', text: bind('/result'), variant: 'body' });
    root.push('result');
  }
  return [{ id: 'root', component: 'Column', children: root }, ...comps] as unknown as ViewComponent[];
}
