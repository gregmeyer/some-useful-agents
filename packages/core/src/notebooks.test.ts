/** Notebooks (G1): the store, entries as items on the notebook's surface, and its item on Home. */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { AgentStore } from './agent-store.js';
import { NotebookStore, notebookEntryItems, notebookProgress, notebookSlug, notebookViewData, cleanFields, optionFingerprint } from './notebooks.js';
import { compileSurface } from './surfaces/compile.js';
import { defaultSurface } from './surfaces/defaults.js';
import { collectItems, itemSourcesFromHandle } from './items/collect.js';

let dir: string;
let runs: RunStore;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('NotebookStore', () => {
  it('starts, fills, ticks, decides and reopens a notebook', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    expect(notebookSlug('Buy a used car!')).toBe('buy-a-used-car');
    const nb = s.create({ title: '  Buy a used car ', statement: 'Find a reliable SUV', params: ['AWD', ' ', 'under $26k'], criteria: ['One fits', 'Clean history'], pipeline: ['listings-search', 'Bad Id!'] });
    expect(nb).toMatchObject({ id: 'buy-a-used-car', title: 'Buy a used car', params: ['AWD', 'under $26k'], pipeline: ['listings-search'], status: 'active' });
    expect(s.create({ title: 'Buy a used car' }).id).toBe('buy-a-used-car-2');
    expect(() => s.create({ title: '  ' })).toThrow('needs a title');

    const e1 = s.addEntry(nb.id, { kind: 'option', title: '2019 RAV4 XLE', body: '54k mi', by: 'you' });
    s.addEntry(nb.id, { kind: 'note', title: 'Prefer AWD', by: 'agent:notes-keeper' });
    expect(() => s.addEntry(nb.id, { kind: 'gossip' as never, title: 'x', by: 'you' })).toThrow('Not an entry kind');
    expect(s.entries(nb.id).map((e) => e.title)).toEqual(['Prefer AWD', '2019 RAV4 XLE']);

    s.markCriterion(nb.id, 0, true);
    expect(notebookProgress(s.get(nb.id)!)).toEqual({ met: 1, total: 2 });
    // Editing criteria keeps "met" for unchanged text.
    expect(s.setCriteria(nb.id, ['One fits', 'Decided by Oct 15']).criteria).toEqual([{ text: 'One fits', met: true }, { text: 'Decided by Oct 15', met: false }]);

    const decided = s.decide(nb.id, 'Buy the RAV4');
    expect(decided).toMatchObject({ status: 'decided', decision: 'Buy the RAV4' });
    expect(s.entries(nb.id)[0]).toMatchObject({ kind: 'decision', body: 'Buy the RAV4' });
    expect(s.list().map((n) => n.id)).toEqual(['buy-a-used-car-2', 'buy-a-used-car']);
    expect(s.setStatus(nb.id, 'active').status).toBe('active');
    expect(s.removeEntry(nb.id, e1.id)).toBe(true);
    expect(s.removeEntry(nb.id, e1.id)).toBe(false);
  });

  it('entries land in the notebook surface\'s regions (decisions first); an active notebook is on Home', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const agents = new AgentStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Car', criteria: ['a', 'b'] });
    s.addEntry(nb.id, { kind: 'note', title: 'n1', by: 'you' });
    s.addEntry(nb.id, { kind: 'decision', title: 'Ruled out the Outback', by: 'you' });
    s.addEntry(nb.id, { kind: 'option', title: 'RAV4', by: 'you' });
    s.addEntry(nb.id, { kind: 'evidence', title: 'Carfax clean', by: 'agent:history-check' });
    const out = compileSurface(defaultSurface(`notebook:${nb.id}`), notebookEntryItems(nb, s.entries(nb.id)));
    expect(out.regions.map((r) => [r.id, r.entries.map((e) => e.item.title)])).toEqual([
      ['options', ['RAV4']], ['notes', ['Ruled out the Outback', 'n1']], ['evidence', ['Carfax clean']],
    ]);
    const items = collectItems(itemSourcesFromHandle(runs.databaseHandle(), agents, runs));
    expect(items.find((i) => i.id === 'notebook:car')).toMatchObject({ kind: 'progress', state: 'in-progress', summary: '0 of 2 criteria met · 4 entries', href: '/notebooks/car' });
    s.decide(nb.id, 'RAV4');
    expect(collectItems(itemSourcesFromHandle(runs.databaseHandle(), agents, runs)).some((i) => i.id === 'notebook:car')).toBe(false);
    agents.close();
  });
});

describe('notebook option fields', () => {
  const CAR_FIELDS = [
    { key: 'price', label: 'Price', type: 'money', role: 'price' },
    { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' },
    { key: 'year', label: 'Year', type: 'number' },
    { key: 'location', label: 'Where', type: 'text', role: 'place' },
    { key: 'listing_url', label: 'Listing', type: 'url', role: 'link' },
    { key: 'photo', label: 'Photo', type: 'image', role: 'image' },
  ];

  it('keeps well-formed fields only, one per key and one per role', () => {
    expect(cleanFields([
      ...CAR_FIELDS,
      { key: 'Bad Key', type: 'text' },
      { key: 'price', type: 'text' },                       // duplicate key
      { key: 'msrp', type: 'money', role: 'price' },         // second price role → no role
      { key: 'trim', type: 'mystery' },                      // unknown type → text
    ]).map((f) => `${f.key}:${f.type}:${f.role ?? ''}`)).toEqual([
      'price:money:price', 'miles:number:measure', 'year:number:', 'location:text:place', 'listing_url:url:link', 'photo:image:image', 'msrp:money:', 'trim:text:',
    ]);
  });

  it('knows which way is better, takes ranges, and picks out the org (a job search)', () => {
    const JOB_FIELDS = cleanFields([
      { key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher', range: true },
      { key: 'company', label: 'Company', type: 'text', role: 'org' },
      { key: 'commute', label: 'Commute', type: 'number', unit: 'min', role: 'measure', better: 'lower' },
      { key: 'title', label: 'Title', type: 'text', better: 'higher', range: true }, // not numeric: neither applies
      { key: 'price', label: 'Price', type: 'money' },
    ]);
    expect(JOB_FIELDS.map((f) => `${f.key}:${f.better ?? ''}:${f.range ? 'range' : ''}`)).toEqual(['salary:higher:range', 'company::', 'commute:lower:', 'title::', 'price::']);
    // A car's price, with no say, is better lower.
    expect(cleanFields(CAR_FIELDS)[0]).toMatchObject({ key: 'price', better: 'lower' });

    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Find a staff role' }).id, JOB_FIELDS);
    const add = (title: string, salary: unknown) => s.upsertOption(nb.id, { title, by: 'agent:jobs', data: { salary, company: 'Stripe', commute: 25 } }).entry.data?.salary;
    expect(add('Staff Engineer A', '$150k–$180k')).toEqual({ min: 150000, max: 180000 });
    expect(add('Staff Engineer B', '150-180k')).toEqual({ min: 150000, max: 180000 });
    expect(add('Staff Engineer C', '$210,000 - $190,000')).toEqual({ min: 190000, max: 210000 });
    expect(add('Staff Engineer D', { min: 200000, max: 240000 })).toEqual({ min: 200000, max: 240000 });
    expect(add('Staff Engineer E', '$175,000')).toBe(175000);
    const opt = notebookViewData(s.get(nb.id)!, s.entries(nb.id)).notebook.options.find((o) => o.title === 'Staff Engineer A')!;
    expect(opt).toMatchObject({ price: 165000, org: 'Stripe', measure: 25, fields: { salary: { min: 150000, max: 180000 } } });
  });

  it('types an option\'s facts and updates the same option when it is seen again', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Buy a used car', params: ['$3k-$5k'] });
    expect(s.setFields(nb.id, CAR_FIELDS).fields).toHaveLength(6);

    const first = s.upsertOption(nb.id, {
      title: '2010 Toyota RAV4 Sport 4WD', body: 'Best fit.', by: 'agent:sweep', runId: 'run-1',
      data: { price: '$4,023', miles: '149,652 mi', year: 2010, location: 'Lynnwood', listing_url: 'https://www.cargurus.com/listing/123/?utm_source=x', photo: 'javascript:alert(1)', color: 'gray' },
    });
    expect(first.seenAgain).toBe(false);
    expect(first.entry.data).toEqual({ price: 4023, miles: 149652, year: 2010, location: 'Lynnwood', listing_url: 'https://www.cargurus.com/listing/123/?utm_source=x' });
    expect(first.entry.fingerprint).toBe('cargurus.com/listing/123');

    // Next run: same listing, new price → one option, refreshed.
    const again = s.upsertOption(nb.id, {
      title: '2010 RAV4 Sport', by: 'agent:sweep', runId: 'run-2',
      data: { price: '$3,900', listing_url: 'https://cargurus.com/listing/123' },
    });
    expect(again.seenAgain).toBe(true);
    const options = s.entries(nb.id).filter((e) => e.kind === 'option');
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ title: '2010 Toyota RAV4 Sport 4WD', runId: 'run-2', data: { price: 3900, miles: 149652 } });
    expect(options[0].lastSeenAt).toBeTruthy();

    // An explicit fingerprint (a VIN) wins; without one or a link, options don't merge.
    expect(optionFingerprint(' JTMBK31V  ', {}, [])).toBe('jtmbk31v');
    s.upsertOption(nb.id, { title: '2009 Forester', by: 'you' });
    s.upsertOption(nb.id, { title: '2009 Forester', by: 'you' });
    expect(s.entries(nb.id).filter((e) => e.kind === 'option')).toHaveLength(3);
  });

  it('adopts an option kept before fingerprints when the same listing comes back', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Buy a used car' }).id, CAR_FIELDS);
    s.addEntry(nb.id, { kind: 'option', title: '2010 Toyota RAV4 Sport 4WD, 149,652 mi, $4,023, Lynnwood', body: 'Best fit: https://www.cargurus.com/Cars/l-Used-Toyota-RAV4-mg108_L37788', by: 'agent:sweep' });
    s.addEntry(nb.id, { kind: 'option', title: '2009 Subaru Forester 2.5X', body: 'no link', by: 'agent:sweep' });
    const r = s.upsertOption(nb.id, { title: '2010 RAV4 Sport', by: 'agent:sweep', data: { price: 4023, listing_url: 'https://cargurus.com/Cars/l-Used-Toyota-RAV4-mg108_L37788' } });
    expect(r.seenAgain).toBe(true);
    const f = s.upsertOption(nb.id, { title: '2009 Subaru Forester 2.5X', by: 'agent:sweep', fingerprint: 'autotrader 767954639' });
    expect(f.seenAgain).toBe(true);
    expect(s.entries(nb.id).filter((e) => e.kind === 'option').map((e) => e.fingerprint).sort()).toEqual(['autotrader 767954639', 'cargurus.com/cars/l-used-toyota-rav4-mg108_l37788']);
  });

  it('fills in what an older option\'s text says once the notebook has fields', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Buy a used car' });
    s.addEntry(nb.id, { kind: 'option', title: '2009 Subaru Forester 2.5X, 157k mi, $4,995, Ascend Motors', body: 'Not verified: https://www.autotrader.com/cars-for-sale/inventory/767954639?city=Seattle.', by: 'agent:sweep' });
    s.addEntry(nb.id, { kind: 'option', title: 'A nice one', by: 'you' });
    expect(s.backfillOptions(nb.id)).toBe(0); // no fields yet
    s.setFields(nb.id, CAR_FIELDS);
    expect(s.backfillOptions(nb.id)).toBe(1);
    const fo = s.entries(nb.id).find((e) => e.title.startsWith('2009'))!;
    expect(fo.data).toEqual({ price: 4995, miles: 157000, year: 2009, listing_url: 'https://www.autotrader.com/cars-for-sale/inventory/767954639?city=Seattle' });
    expect(fo.fingerprint).toBe('autotrader.com/cars-for-sale/inventory/767954639');
    expect(s.backfillOptions(nb.id)).toBe(0); // already done
  });

  it('gives every notebook the same /notebook data, with role-mapped facts for widgets', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Buy a used car', params: ['AWD'], criteria: ['One fits'] }).id, CAR_FIELDS);
    s.upsertOption(nb.id, { title: '2010 RAV4', by: 'agent:sweep', runId: 'r1', data: { price: 4023, miles: 149652, location: 'Lynnwood', listing_url: 'https://cargurus.com/l/1', photo: 'https://img.example/1.jpg' } });
    s.addEntry(nb.id, { kind: 'note', title: 'Craigslist had nothing', by: 'agent:sweep' });
    const { notebook: v } = notebookViewData(s.get(nb.id)!, s.entries(nb.id));
    expect(v.options[0]).toMatchObject({ title: '2010 RAV4', price: 4023, measure: 149652, place: 'Lynnwood', link: 'https://cargurus.com/l/1', image: 'https://img.example/1.jpg', fields: { price: 4023 } });
    expect(v).toMatchObject({ limits: ['AWD'], progress: { met: 0, total: 1 } });
    expect(v.notes.map((n) => n.title)).toEqual(['Craigslist had nothing']);
    expect(v.history).toHaveLength(2);
    expect(v.fields.map((f) => f.key)).toContain('photo');
  });
});
