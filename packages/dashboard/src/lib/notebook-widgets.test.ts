import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, NotebookStore, validateViewComponents } from '@some-useful-agents/core';
import { limitBands, notebookWidgetData, notebookWidgetComponents, notebookWidgetMessages } from './notebook-widgets.js';

let dir: string;
let runs: RunStore;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

const CAR = [
  { key: 'price', label: 'Price', type: 'money', role: 'price' },
  { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' },
  { key: 'url', label: 'Listing', type: 'url', role: 'link' },
];

describe('notebook widgets', () => {
  it('reads limit ranges for the price and the measure from the limits\' text', () => {
    const fields = [{ key: 'price', label: 'Price', type: 'money' as const, role: 'price' as const }, { key: 'miles', label: 'Miles', type: 'number' as const, unit: 'mi', role: 'measure' as const }];
    expect(limitBands({ fields, params: ['125-175k miles', '$3k-$5k starting budget', '2005-2013 model years', '135k-180k miles', 'AWD', 'under $6,000'] }))
      .toEqual({ price: { min: 3000, max: 5000 }, measure: { min: 135000, max: 180000 } });
    expect(limitBands({ fields: [], params: ['$3k-$5k'] })).toEqual({ price: { min: 3000, max: 5000 } });
  });

  it('draws any notebook with fields and options as a valid view, with a summary and stats', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nbw-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb0 = s.create({ title: 'Car', params: ['$3k-$6k budget', '130k-190k miles'], criteria: ['clean title'] });
    expect(notebookWidgetMessages(nb0, [])).toBeUndefined(); // no fields: cards
    s.setFields(nb0.id, CAR);
    s.setStages(nb0.id, ['Found', 'Checked', 'Test drive']);
    const rav = s.upsertOption(nb0.id, { title: '2010 RAV4, Lynnwood', by: 'agent:x', data: { price: 4023, miles: 149652, url: 'https://cars.example/1' } }).entry;
    const fo = s.upsertOption(nb0.id, { title: '2009 Forester', by: 'agent:x', data: { price: 4995, miles: 157000 } }).entry;
    s.moveOption(nb0.id, rav.id, 'Checked');
    s.ruleOut(nb0.id, fo.id, 'too pricey');
    const nb = s.get(nb0.id)!;

    const v = validateViewComponents(notebookWidgetComponents(nb));
    expect(v.ok).toBe(true);
    const names = (v.ok ? v.components : []).map((c) => c.component);
    expect(names).toEqual(expect.arrayContaining(['Metric', 'Funnel', 'Scatter', 'OptionGrid']));

    const d = notebookWidgetData(nb, s.entries(nb.id), s).notebook;
    expect(d.bands).toEqual({ price: { min: 3000, max: 6000 }, measure: { min: 130000, max: 190000 } });
    expect(d.summary).toBe('**1 in the running**, 1 ruled out. Best price: **$4,023**, 2010 RAV4. Furthest along: Checked. Next: clean title.');
    expect(d.stats).toEqual({ active: '1', best: '$4,023', bestLabel: 'Best price', furthest: 'Checked', ruledOut: '1' });

    const msgs = notebookWidgetMessages(nb, s.entries(nb.id), s) as Array<Record<string, { surfaceId?: string; value?: { notebook?: { options?: unknown[] } } }>>;
    expect(msgs[0].createSurface.surfaceId).toBe('notebook-car');
    expect(msgs[2].updateDataModel.value?.notebook?.options).toHaveLength(2);
  });

  it('leaves out the map without a price and a measure, and the funnel without stages', () => {
    const names = notebookWidgetComponents({ fields: [{ key: 'company', label: 'Company', type: 'text', role: 'org' }], stages: [] }).map((c) => c.component);
    expect(names).not.toContain('Scatter');
    expect(names).not.toContain('Funnel');
    expect(names).toContain('OptionGrid');
    expect(validateViewComponents(notebookWidgetComponents({ fields: [], stages: [] })).ok).toBe(true);
  });
});
