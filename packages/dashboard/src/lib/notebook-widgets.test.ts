import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, NotebookStore, validateViewComponents } from '@some-useful-agents/core';
import { limitBands, limitChips, notebookWidgetData, notebookWidgetComponents, notebookWidgetMessages } from './notebook-widgets.js';

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
    expect(names).toEqual(expect.arrayContaining(['Callout', 'StatStrip', 'Steps', 'Funnel', 'Scatter', 'OptionGrid', 'Checklist', 'Timeline', 'Coverage', 'ChipList', 'Panel', 'Columns']));

    const d = notebookWidgetData(nb, s.entries(nb.id), s).notebook;
    expect(d.bands).toEqual({ price: { min: 3000, max: 6000 }, measure: { min: 130000, max: 190000 } });
    expect(d.summary).toBe('**1 in the running**, 1 ruled out. The best lead is the **2010 RAV4, Lynnwood**: $4,023, 149,652 mi. Furthest along: Checked.');
    expect(d.next).toBe('check still listed and clean title on the top one before you contact anyone.');
    expect(d.stats).toEqual({ active: '1', best: '$4,023', bestLabel: 'Best price', furthest: 'Checked', ruledOut: '1' });
    expect(d.statItems.map((x) => `${x.label}=${x.value}`)).toEqual(['in the running=1', 'best price=$4,023', 'furthest along=Checked', 'ruled out=1']);
    expect(d.checklist).toEqual([{ id: rav.id, title: '#1 · 2010 RAV4, Lynnwood', items: [{ text: 'Still listed', done: false }, { text: 'Clean title', done: false }] }]);
    s.checkOption(nb.id, rav.id, 'Still listed', true);
    expect(notebookWidgetData(s.get(nb.id)!, s.entries(nb.id), s).notebook.checklist[0].items[0]).toEqual({ text: 'Still listed', done: true });
    expect(d.timeline.map((e) => e.title)).toEqual(expect.arrayContaining(['Ruled out: 2009 Forester', '2010 RAV4 → Checked', 'Notebook started']));
    expect(d.steps[0]).toMatchObject({ text: 'Clean title', met: false, note: 'start with the top one' });

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

describe('notebook widget details', () => {
  it('flags limits that disagree, and counts the pairs', () => {
    const fields = [{ key: 'price', label: 'Price', type: 'money' as const, role: 'price' as const }, { key: 'miles', label: 'Miles', type: 'number' as const, unit: 'mi', role: 'measure' as const }];
    const { chips, disagree } = limitChips({ fields, params: ['SUV or Wagon, AWD', '125-175k miles', '3000-8000', '2005-2013 model years', '135k-180k miles', '$3k-$5k starting budget'] });
    expect(disagree).toBe(2);
    expect(chips.filter((c) => c.tone === 'warn').map((c) => c.text)).toEqual(['125-175k miles ⚠', '3000-8000 ⚠', '135k-180k miles ⚠', '$3k-$5k starting budget ⚠']);
    expect(chips.find((c) => c.text.startsWith('2005'))!.tone).toBeUndefined();
  });

  it('records which sites a search reached, and shows the latest', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nbw-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, CAR);
    s.upsertOption(nb.id, { title: 'RAV4', by: 'agent:x', data: { price: 4000, miles: 150000 } });
    s.recordSearch(nb.id, 'sweep', 'r1', 1, new Date().toISOString(), [{ name: 'CarGurus', found: 2, status: 'found' }, { name: 'Edmunds', found: 0, status: 'blocked' }]);
    const d = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id), s).notebook;
    expect(d.coverage.sources.map((x) => `${x.name}:${x.status}`)).toEqual(['CarGurus:found', 'Edmunds:blocked']);
    expect(d.coverage.when).toMatch(/^last search · /);
    expect(d.timeline[0]).toMatchObject({ kind: 'search', who: 'sweep', title: 'Search returned 1 option', body: 'CarGurus 2 · Edmunds blocked', linkText: 'run r1' });
  });

  it('a gone option is out of the running and reads as no longer available', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nbw-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, CAR);
    const a = s.upsertOption(nb.id, { title: 'RAV4, sold', by: 'agent:x', data: { price: 4000 } }).entry;
    s.ruleOut(nb.id, a.id, '', 'you', { gone: true });
    expect(s.findOption(nb.id, 'RAV4')!.ruledOut).toMatchObject({ reason: 'No longer available', gone: true });
    const d = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id), s).notebook;
    expect(d.statItems[0].value).toBe('0');
    expect(d.timeline[0]).toMatchObject({ title: 'No longer available: RAV4, sold', faded: true });
    expect(s.reinstate(nb.id, a.id).ruledOut).toBeUndefined();
  });
});

describe('timeline searches', () => {
  it('rebuilds searches from before they were recorded, by run, with agent and option count; moves have their own kind', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nbw-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, CAR);
    s.setStages(nb.id, ['Found', 'Checked']);
    const a = s.upsertOption(nb.id, { title: 'RAV4', by: 'agent:used-car-coverage-sweep', runId: 'fe433a7a-1', data: { price: 4000 } }).entry;
    s.upsertOption(nb.id, { title: 'Forester', by: 'agent:used-car-coverage-sweep', runId: 'fe433a7a-1', data: { price: 4500 } });
    s.addEntry(nb.id, { kind: 'note', title: 'Edmunds blocked', by: 'agent:used-car-coverage-sweep', runId: 'fe433a7a-1' });
    s.addEntry(nb.id, { kind: 'note', title: 'Craigslist had nothing', by: 'agent:craigslist-car-search', runId: 'c1' });
    s.moveOption(nb.id, a.id, 'Checked');
    const t = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id), s).notebook.timeline;
    const searches = t.filter((e) => e.kind === 'search');
    expect(searches.map((e) => `${e.who}|${e.title}|${e.linkText}`).sort()).toEqual([
      'craigslist-car-search|Search added notes, no options|run c1',
      'used-car-coverage-sweep|Search returned 2 options|run fe433a7a',
    ]);
    expect(t.find((e) => e.title === 'RAV4 → Checked')!.kind).toBe('move');
    // Failed runs of the agents that feed it show too (they leave nothing behind).
    const hist = Object.assign(Object.create(s), {
      recentRuns: (agentId: string) => agentId === 'used-car-coverage-sweep'
        ? [{ id: 'ab5419bc-9', status: 'failed', startedAt: new Date(Date.now() + 1000).toISOString(), error: 'Node "autotrader-sweep" timed out' }, { id: 'old-ok', status: 'completed', startedAt: new Date().toISOString() }]
        : [],
    });
    const failed = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id), hist).notebook.timeline[0];
    expect(failed).toMatchObject({ kind: 'search', who: 'used-car-coverage-sweep', title: 'Search failed', body: 'Node "autotrader-sweep" timed out', linkText: 'run ab5419bc', faded: true });
  });
});
