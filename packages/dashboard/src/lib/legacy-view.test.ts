import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent, validateViewComponents, type Agent, type OutputWidgetSchema } from '@some-useful-agents/core';
import { TEMPLATE_REGISTRY, normalizeSignal } from '../views/pulse-templates.js';
import { legacySignalView, legacyWidgetView, statusTone, type LegacyView } from './legacy-view.js';

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

const KNOWN_GAPS = [/template$/, /interactive widgets/, /widget controls/, /preview and action fields/, /href\/text templates/, /no template/, /diff-apply/];
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
    expect(tally.converted ?? 0).toBeGreaterThanOrEqual(15);
  });

  it('each output widget converts to a valid view or names a known gap', () => {
    const tally: Record<string, number> = {};
    for (const a of examples.filter((x) => x.outputWidget)) {
      const k = check(`${a.id} (${a.outputWidget!.type})`, legacyWidgetView(a.outputWidget!, sampleOutput(a.outputWidget!)));
      tally[k] = (tally[k] ?? 0) + 1;
    }
    expect(tally.converted ?? 0).toBeGreaterThanOrEqual(6);
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
    expect(legacySignalView({ title: 'x', template: 'time-series' }, {})).toEqual({ unsupported: 'the "time-series" template' });
    expect(legacyWidgetView({ type: 'dashboard', fields: [], controls: [{ type: 'sort', column: 'a' }] } as unknown as OutputWidgetSchema, '{}'))
      .toEqual({ unsupported: 'widget controls (sort)' });
    expect(legacyWidgetView({ type: 'key-value', fields: [], interactive: true } as unknown as OutputWidgetSchema, '{}'))
      .toEqual({ unsupported: 'interactive widgets (input forms)' });
  });
});
