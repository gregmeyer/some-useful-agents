import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent, validateViewComponents, type Agent, type OutputWidgetSchema } from '@some-useful-agents/core';
import { TEMPLATE_REGISTRY, normalizeSignal } from '../views/pulse-templates.js';
import { legacyInteractiveView, legacySignalView, legacyWidgetView, statusTone, type LegacyView } from './legacy-view.js';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, '..', '..', '..', 'core', 'examples');
const examples: Agent[] = readdirSync(examplesDir).filter((f) => f.endsWith('.yaml'))
  .map((f) => { try { return parseAgent(readFileSync(join(examplesDir, f), 'utf8')); } catch { return undefined; } })
  .filter((a): a is Agent => !!a);

/** A sample value of a slot's declared type. */
function sampleSlot(type: string, name: string): unknown {
  if (type === 'number') return 42;
  if (type === 'array') return name === 'pairs' ? [{ label: 'Region', value: 'EU' }] : [{ name: 'a', value: 1 }, { name: 'b', value: 2 }];
  if (type === 'url') return 'https://example.com/x.png';
  return `sample ${name}`;
}
/** A sample run output for an output widget: one value per field, of the field's type. */
function sampleOutput(widget: OutputWidgetSchema): string {
  const out: Record<string, unknown> = {};
  for (const f of widget.fields ?? []) {
    out[f.name] = f.type === 'table'
      ? [Object.fromEntries((f.columns ?? [{ name: 'title' }]).map((c) => [c.name, c.format === 'link' ? 'https://example.com' : 'x']))]
      : f.type === 'metric' || f.type === 'stat' ? '7' : `sample ${f.name}`;
  }
  return JSON.stringify(out);
}

const KNOWN_GAPS = [/template$/, /YouTube\/Vimeo/, /widget controls/, /action fields/, /isn't a table field/, /href\/text templates/, /no template/, /diff-apply/];
function check(label: string, v: LegacyView): 'converted' | string {
  if ('unsupported' in v) {
    expect(KNOWN_GAPS.some((re) => re.test(v.unsupported)), `${label}: unexpected gap "${v.unsupported}"`).toBe(true);
    return v.unsupported;
  }
  const r = validateViewComponents(v.components);
  expect(r, `${label}: converted view must validate`).toMatchObject({ ok: true });
  return 'converted';
}

describe('legacy widgets → A2UI views, across every example agent', () => {
  it('each signal template converts to a valid view or names a known gap', () => {
    const tally: Record<string, number> = {};
    for (const a of examples.filter((x) => x.signal)) {
      const { template } = normalizeSignal(a.signal!);
      let v: LegacyView;
      if (template === 'widget') {
        if (!a.outputWidget) continue;
        v = legacyWidgetView(a.outputWidget, sampleOutput(a.outputWidget));
      } else {
        const slots = Object.fromEntries((TEMPLATE_REGISTRY[template ?? 'text-headline']?.slots ?? []).map((s) => [s.name, sampleSlot(s.type, s.name)]));
        v = legacySignalView(a.signal!, slots);
      }
      const k = check(`${a.id} (${template})`, v);
      tally[k] = (tally[k] ?? 0) + 1;
    }
    // Every example's Pulse template converts.
    expect(Object.keys(tally)).toEqual(['converted']);
  });

  it('each output widget converts to a valid view or names a known gap', () => {
    const tally: Record<string, number> = {};
    for (const a of examples.filter((x) => x.outputWidget)) {
      const k = check(`${a.id} (${a.outputWidget!.type})`, legacyWidgetView(a.outputWidget!, sampleOutput(a.outputWidget!)));
      tally[k] = (tally[k] ?? 0) + 1;
    }
    // Every example's output widget converts.
    expect(Object.keys(tally)).toEqual(['converted']);
  });
});

describe('conversion details', () => {
  it('keeps the old values: slots and fields land in /data, templates are filled and sanitized server-side', () => {
    const metric = legacySignalView({ title: 'Stars', template: 'metric' }, { value: 120, previous: 100, unit: '★' });
    expect(metric).toMatchObject({ data: { slots: { value: 120, _delta: '+20 vs previous' } } });
    const status = legacySignalView({ title: 'API', template: 'status' }, { status: 'degraded', message: 'slow' });
    expect(status).toMatchObject({ data: { slots: { _tone: 'warn' } } });
    const ai = legacyWidgetView({ type: 'ai-template', fields: [], template: '<h3>{{outputs.title}}</h3><script>x()</script>' } as OutputWidgetSchema, '{"title":"Hello"}');
    expect(ai).toMatchObject({ data: { html: expect.stringContaining('<h3>Hello</h3>') } });
    expect(String((ai as unknown as { data: { html: string } }).data.html)).not.toContain('<script');
    expect(statusTone('DOWN')).toBe('err');
    const disk = (v: number) => legacySignalView({ title: 'Disk', template: 'metric', accent: 'green', thresholds: [{ above: 90, palette: 'accent-red' }, { above: 70, palette: 'accent-orange' }] } as never, { value: v });
    expect(disk(3)).toMatchObject({ data: { slots: { _tone: 'ok' } } });
    expect(disk(80)).toMatchObject({ data: { slots: { _tone: 'warn' } } });
    expect(disk(95)).toMatchObject({ data: { slots: { _tone: 'err' } } });
  });

  it('names what it cannot draw yet', () => {
    expect(legacySignalView({ title: 'x', template: 'media' }, { url: 'https://youtu.be/abcdefghijk' })).toEqual({ unsupported: 'the "media" template with a YouTube/Vimeo link' });
    expect(legacyWidgetView({ type: 'dashboard', fields: [{ name: 'x', type: 'text' }], controls: [{ type: 'sort', field: 'a', columns: ['b'] }] } as unknown as OutputWidgetSchema, '{"x":"1"}'))
      .toEqual({ unsupported: 'a sort control on "a", which isn\'t a table field' });
    expect(legacyWidgetView({ type: 'raw', fields: [{ name: 'x', type: 'text' }], controls: [{ type: 'filter', field: 'a', columns: ['b'] }] } as unknown as OutputWidgetSchema, '{"x":"1"}'))
      .toEqual({ unsupported: 'widget controls (filter)' });
    expect(legacyWidgetView({ type: 'key-value', fields: [{ name: 'a', type: 'text' }], interactive: true } as unknown as OutputWidgetSchema, '{"a":"1"}'))
      .toMatchObject({ components: expect.any(Array) }); // the static result; the tile adds the form
  });
});

describe('new templates and interactive forms', () => {
  it('converts time-series, funnel, image, text-image and file media to valid views', () => {
    for (const [template, slots] of [
      ['time-series', { values: [1, 3, 2, 5], current: 5, label: 'Stars' }],
      ['funnel', { stages: [{ label: 'Visit', value: 100 }, { label: 'Buy', value: 7 }] }],
      ['image', { imageUrl: 'https://example.com/a.png', alt: 'A' }],
      ['text-image', { text: 'Hi', imageUrl: 'https://example.com/a.png' }],
      ['media', { url: 'https://example.com/clip.mp4', title: 'Clip' }],
    ] as const) {
      const v = legacySignalView({ title: 'x', template } as never, slots as never);
      expect('components' in v && validateViewComponents(v.components), template).toMatchObject({ ok: true });
    }
  });

  it('builds a form from the agent\'s inputs with a Run button that carries their values', () => {
    const v = legacyInteractiveView({
      agentId: 'magic-8',
      inputs: { QUESTION: { type: 'string', description: 'Ask anything' }, MOOD: { type: 'enum', values: ['calm', 'wild'], default: 'wild' } },
      widget: { type: 'key-value', fields: [{ name: 'answer', type: 'text' }], interactive: true, askLabel: 'Shake', replayLabel: 'Shake again' } as never,
      lastOutput: '{"answer":"Yes"}',
      previousInputs: { QUESTION: 'Will it rain?' },
    });
    if (!('components' in v)) throw new Error(v.unsupported);
    const check = validateViewComponents(v.components);
    expect(check, JSON.stringify(check)).toMatchObject({ ok: true });
    expect(v.data).toMatchObject({ form: { QUESTION: 'Will it rain?', MOOD: ['wild'] }, items: [{ label: 'answer', value: 'Yes' }] });
    const run = v.components.find((c) => c.id === 'run') as unknown as { action: { event: { name: string; context: Record<string, unknown> } } };
    expect(run.action.event).toEqual({ name: 'run-agent', context: { agent: 'magic-8', in_QUESTION: { path: '/data/form/QUESTION' }, in_MOOD: { path: '/data/form/MOOD' } } });
    expect(v.components.find((c) => c.id === 'run_label')).toMatchObject({ text: 'Shake again' });
    const first = legacyInteractiveView({ agentId: 'magic-8', inputs: { QUESTION: { type: 'string' } }, widget: { type: 'key-value', fields: [], interactive: true, askLabel: 'Shake' } as never });
    expect('components' in first && first.components.find((c) => c.id === 'run_label')).toMatchObject({ text: 'Shake' });
  });
});

describe('widget controls', () => {
  const widget = {
    type: 'dashboard',
    fields: [
      { name: 'temp', type: 'metric', label: 'Now' },
      { name: 'humidity', type: 'stat', label: 'Humidity' },
      { name: 'week', type: 'table', label: 'Week', columns: [{ name: 'day' }, { name: 'high' }] },
      { name: 'chart', type: 'preview', label: 'Chart' },
    ],
    controls: [
      { type: 'view-switch', label: 'Range', default: 'week', views: [{ id: 'today', fields: ['temp'] }, { id: 'week', fields: ['week'] }] },
      { type: 'field-toggle', label: 'Extras', fields: ['humidity'], default: 'hidden' },
      { type: 'sort', field: 'week', columns: ['day', 'high'], default: 'high desc' },
      { type: 'filter', field: 'week', columns: ['day'], placeholder: 'Find a day' },
      { type: 'paginate', field: 'week', pageSize: 5 },
    ],
  } as unknown as OutputWidgetSchema;
  const output = JSON.stringify({ temp: '21', humidity: '40%', chart: 'out/chart.png', week: [{ day: 'Mon', high: 22 }, { day: 'Tue', high: 25 }] });

  it('maps view-switch to Tabs (default first), field-toggle to a Disclosure, array controls to Table props, previews to links', () => {
    const v = legacyWidgetView(widget, output);
    if (!('components' in v)) throw new Error(v.unsupported);
    const check = validateViewComponents(v.components);
    expect(check, JSON.stringify(check)).toMatchObject({ ok: true });
    const byId = Object.fromEntries(v.components.map((c) => [c.id, c]));
    expect((byId.views as unknown as { tabs: Array<{ title: string }> }).tabs.map((t) => t.title)).toEqual(['week', 'today']);
    expect(byId.toggle0).toMatchObject({ component: 'Disclosure', label: 'Extras', open: false });
    const table = v.components.find((c) => c.component === 'Table');
    expect(table).toMatchObject({ sortColumns: ['day', 'high'], defaultSort: 'high desc', filterColumns: ['day'], filterPlaceholder: 'Find a day', pageSize: 5, rows: { path: '/data/arrays/week' } });
    expect(v.data).toMatchObject({ previews: { chart: '/output-file?path=out%2Fchart.png' }, arrays: { week: [{ day: 'Mon', high: 22 }, { day: 'Tue', high: 25 }] } });
    expect(v.components.some((c) => c.component === 'Link' && (c.url as { path: string }).path === '/data/previews/chart')).toBe(true);
  });
});
