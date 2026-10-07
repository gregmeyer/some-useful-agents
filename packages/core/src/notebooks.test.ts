/** Notebooks (G1): the store, entries as items on the notebook's surface, and its item on Home. */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { InboxStore } from './inbox-store.js';
import { AgentStore } from './agent-store.js';
import { NotebookStore, notebookEntryItems, notebookProgress, notebookSlug, notebookViewData, cleanFields, optionFingerprint, shortName } from './notebooks.js';
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

  it('a notebook and its conversation are one row on Home: waiting on you when sua asked something', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const agents = new AgentStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const inbox = InboxStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Car', criteria: ['a'] });
    const thread = inbox.add({ priority: 'medium', source: 'manual', title: 'Notebook: Car', body: '(empty)' });
    s.setConversation(nb.id, thread.id);
    inbox.addResponse(thread.id, 'triage', 'What is your budget?');
    inbox.updateStatus(thread.id, 'awaiting_user');
    const collect = () => collectItems(itemSourcesFromHandle(runs.databaseHandle(), agents, runs));
    let items = collect();
    expect(items.some((i) => i.id === `thread:${thread.id}`)).toBe(false);
    expect(items.find((i) => i.id === 'notebook:car')).toMatchObject({
      kind: 'question', state: 'open', title: 'Notebook: Car', summary: 'sua: What is your budget?', subject: { threadId: thread.id },
    });
    expect(items.find((i) => i.id === 'notebook:car')!.actions.map((a) => a.type)).toEqual(['reply', 'open']);
    // Answered: back to how far along it is, still one row.
    inbox.updateStatus(thread.id, 'open');
    items = collect();
    expect(items.some((i) => i.id === `thread:${thread.id}`)).toBe(false);
    expect(items.find((i) => i.id === 'notebook:car')).toMatchObject({ kind: 'progress', state: 'in-progress' });
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
    expect(v.options[0]).toMatchObject({ title: '2010 RAV4', price: 4023, measure: 149652, place: 'Lynnwood', link: 'https://cargurus.com/l/1', imageSource: 'https://img.example/1.jpg', fields: { price: 4023 } });
    expect(v).toMatchObject({ limits: ['AWD'], progress: { met: 0, total: 1 } });
    expect(v.notes.map((n) => n.title)).toEqual(['Craigslist had nothing']);
    expect(v.history).toHaveLength(2);
    expect(v.fields.map((f) => f.key)).toContain('photo');
  });
});

describe('notebook stages and ruling out (a funnel)', () => {
  it('moves options through stages, rules them out with a reason, keeps them out, and counts the funnel', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    let nb = s.create({ title: 'Find a staff role' });
    s.setFields(nb.id, [{ key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }]);
    nb = s.setStages(nb.id, ['Found', 'Applied', ' applied ', 'Screen', 'Interview', 'Offer', '']);
    expect(nb.stages).toEqual(['Found', 'Applied', 'Screen', 'Interview', 'Offer']);

    const add = (title: string, n: number) => s.upsertOption(nb.id, { title, by: 'agent:jobs', data: { posting_url: `https://boards.greenhouse.io/x/jobs/${String(n)}` } }).entry;
    const stripe = add('Staff Engineer, Stripe', 1);
    const plaid = add('Staff Engineer, Plaid', 2);
    const ramp = add('Staff Engineer, Ramp', 3);
    add('Staff Engineer, Brex', 4);
    expect(stripe.stage).toBe('Found');

    s.moveOption(nb.id, stripe.id, 'interview');
    s.moveOption(nb.id, plaid.id, 'Applied');
    s.moveOption(nb.id, ramp.id, 'Applied');
    expect(() => s.moveOption(nb.id, ramp.id, 'Hired')).toThrow("isn't one of this notebook's stages");
    const out = s.ruleOut(nb.id, plaid.id, '  No callback ', 'you');
    expect(out.ruledOut).toMatchObject({ reason: 'No callback', by: 'you', stage: 'Applied' });
    s.ruleOut(nb.id, ramp.id, 'no callback');

    // A later search finds Plaid again: it stays ruled out.
    const again = s.upsertOption(nb.id, { title: 'Staff Engineer (Plaid)', by: 'agent:jobs', data: { posting_url: 'https://boards.greenhouse.io/x/jobs/2' } });
    expect(again).toMatchObject({ seenAgain: true, ruledOut: true });
    expect(s.findOption(nb.id, 'plaid')?.ruledOut?.reason).toBe('No callback');
    expect(s.findOption(nb.id, 'Staff Engineer')).toBeUndefined(); // ambiguous

    const v = notebookViewData(s.get(nb.id)!, s.entries(nb.id)).notebook;
    expect(v).toMatchObject({ active: 2, ruledOutCount: 2 });
    expect(v.options.slice(-2).every((o) => o.ruledOut)).toBe(true); // ruled out last
    expect(v.funnel.map((f) => `${f.stage}:${f.reached}/${f.here}/${f.ruledOut}`)).toEqual(['Found:4/1/0', 'Applied:3/0/2', 'Screen:1/0/0', 'Interview:1/1/0', 'Offer:0/0/0']);
    expect(v.funnel[1].reasons).toEqual([{ reason: 'no callback', count: 2 }]);

    // Reinstate, and moving an option reinstates it too.
    expect(s.reinstate(nb.id, ramp.id).ruledOut).toBeUndefined();
    expect(s.moveOption(nb.id, plaid.id, 'Screen').ruledOut).toBeUndefined();

    // Renaming stages: a stage that's gone sends its options to the first.
    s.setStages(nb.id, ['Found', 'Applied', 'Offer']);
    expect(s.findOption(nb.id, 'stripe')?.stage).toBe('Found');
    expect(s.findOption(nb.id, 'ramp')?.stage).toBe('Applied');
  });
});

describe('option history and not seen lately', () => {
  it('keeps each sighting, shows the price move, and flags an option two searches in a row passed over', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Buy a used car' }).id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' },
      { key: 'url', label: 'Listing', type: 'url', role: 'link' },
    ]);
    const tick = () => new Promise((r) => setTimeout(r, 3));
    // A search: time first, then its options, then the search itself (as the keeper does).
    const search = async (run: string, cars: Array<[string, number]>) => {
      const at = new Date().toISOString();
      await tick();
      for (const [n, price] of cars) s.upsertOption(nb.id, { title: `Car ${n}`, by: 'agent:sweep', runId: run, data: { price, url: `https://cars.example/${n}` } });
      s.recordSearch(nb.id, 'sweep', run, cars.length, at);
      await tick();
    };
    await search('r1', [['a', 5000], ['b', 4500]]);
    await search('r2', [['a', 4800], ['b', 4500]]);
    await search('r3', [['a', 4700]]);           // b passed over once
    s.recordSearch(nb.id, 'sweep', 'r4', 0);      // a search that found nothing doesn't count
    await tick();
    const view = () => new Map(notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options.map((o) => [o.title, o]));
    expect(view().get('Car b')).toMatchObject({ missedSearches: 1, notSeenLately: false });
    await search('r5', [['a', 4700]]);           // b passed over twice
    const v = view();
    expect(v.get('Car a')).toMatchObject({ missedSearches: 0, notSeenLately: false, priceChange: { from: 5000, to: 4700 } });
    expect(v.get('Car a')!.priceHistory.map((p) => p.value)).toEqual([5000, 4800, 4700]); // repeats collapse
    expect(v.get('Car b')).toMatchObject({ missedSearches: 2, notSeenLately: true });
    expect(v.get('Car b')!.priceChange).toBeUndefined();
    // Without the store, the view still works (no history).
    expect(notebookViewData(s.get(nb.id)!, s.entries(nb.id)).notebook.options[0]).toMatchObject({ priceHistory: [], missedSearches: 0 });
    // Seen again clears it.
    await search('r6', [['b', 4400]]);
    expect(view().get('Car b')).toMatchObject({ missedSearches: 0, notSeenLately: false, priceChange: { from: 4500, to: 4400 } });
  });
});

describe('option photos', () => {
  it('only trusts a page photo when the page is that listing', async () => {
    const { previewMatchesOption, looksLikeOneListing } = await import('./notebooks.js');
    expect(looksLikeOneListing('https://www.autotrader.com/cars-for-sale/inventory/767954639?city=Seattle')).toBe(true);
    expect(looksLikeOneListing('https://www.cargurus.com/Cars/l-Used-Toyota-RAV4-2006-2012-Seattle-mg108_L37788')).toBe(false);
    expect(looksLikeOneListing('https://www.edmunds.com/used-subaru-forester-seattle-wa/')).toBe(false);
    expect(looksLikeOneListing('https://cars.example/search?q=rav4&id=1234567')).toBe(false);
    expect(looksLikeOneListing('not a url')).toBe(false);
    const title = '2010 Toyota RAV4 Sport 4WD, 149,652 mi, $4,023, Lynnwood';
    expect(previewMatchesOption('2010 Toyota RAV4 Sport for sale in Lynnwood, WA', title)).toBe(true);
    expect(previewMatchesOption('2012 Toyota RAV4 Sport for sale', title)).toBe(false); // wrong year
    expect(previewMatchesOption('Used cars for sale near Seattle', title)).toBe(false);
    expect(previewMatchesOption('Staff Engineer, Payments - Stripe', 'Staff Engineer, Stripe')).toBe(true);
  });

  it('keeps one photo per option, remembers addresses that failed, and serves the copy in the view', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, [
      { key: 'photo', label: 'Photo', type: 'image', role: 'image' },
      { key: 'url', label: 'Listing', type: 'url', role: 'link' },
    ]);
    const a = s.upsertOption(nb.id, { title: 'A', by: 'agent:x', data: { photo: 'https://img.example/a.jpg', url: 'https://cars.example/listing/12345' } }).entry;
    const b = s.upsertOption(nb.id, { title: 'B', by: 'agent:x', data: { url: 'https://cars.example/listing/67890' } }).entry;
    s.upsertOption(nb.id, { title: 'C', by: 'agent:x' }); // nothing to fetch
    expect(s.photoCandidates(nb.id).map((c) => `${c.entry.title}:${c.image ?? '-'}:${c.link ?? '-'}`)).toEqual(['B:-:https://cars.example/listing/67890', 'A:https://img.example/a.jpg:https://cars.example/listing/12345']);

    s.savePhoto(nb.id, a.id, 'https://img.example/a.jpg', { contentType: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]) });
    s.savePhoto(nb.id, b.id, 'https://cars.example/listing/67890', { error: 'HTTP 403' });
    expect(s.photoCandidates(nb.id)).toEqual([]); // A has one; B's address already failed
    expect(s.photo(a.id)).toMatchObject({ contentType: 'image/jpeg', sourceUrl: 'https://img.example/a.jpg' });
    expect(s.hasPhoto(b.id)).toBe(false);

    const v = notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options;
    expect(v.find((o) => o.title === 'A')).toMatchObject({ image: `/notebooks/car/entries/${a.id}/photo`, imageSource: 'https://img.example/a.jpg' });
    expect(v.find((o) => o.title === 'B')!.image).toBeUndefined();
    // Ruled out: no photo tries; removed: photo gone.
    s.ruleOut(nb.id, b.id, 'no');
    s.removeEntry(nb.id, a.id);
    expect(s.photo(a.id)).toBeUndefined();
  });
});

describe('fields without roles, and facts that belong to another option', () => {
  it('infers roles and units from field names', () => {
    const f = cleanFields([
      { key: 'price', label: 'Price', type: 'money' }, { key: 'miles', label: 'Miles', type: 'number' },
      { key: 'listing_url', label: 'Listing', type: 'url' }, { key: 'photo', label: 'Photo', type: 'text' },
      { key: 'location', label: 'Where', type: 'text' }, { key: 'seller', label: 'Seller', type: 'text' }, { key: 'year', label: 'Year', type: 'number' },
    ]);
    expect(f.map((x) => `${x.key}:${x.type}:${x.role ?? ''}:${x.unit ?? ''}`)).toEqual([
      'price:money:price:', 'miles:number:measure:mi', 'listing_url:url:link:', 'photo:image:image:', 'location:text:place:', 'seller:text:org:', 'year:number::',
    ]);
  });

  it('keeps only what an option\'s own text says when given facts contradict it, and repairs stored ones', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, [{ key: 'price', type: 'money' }, { key: 'miles', type: 'number' }, { key: 'year', type: 'number' }]);
    const a = s.addEntry(nb.id, { kind: 'option', title: '2006 Subaru Forester 2.5X, 162k mi, $4,995, Ascend Motors', by: 'agent:x' });
    // Setup mixed up ids: the 2007's numbers.
    s.setOptionFacts(nb.id, a.id, { price: 4699, miles: 178630, year: 2007 });
    expect(s.findOption(nb.id, '2006')!.data).toEqual({ price: 4995, miles: 162000, year: 2006 });
    // Stored before this check: repaired on read.
    runs.databaseHandle().prepare('UPDATE notebook_entries SET data_json = ? WHERE id = ?').run(JSON.stringify({ price: 4699, miles: 178630, year: 2007 }), a.id);
    expect(s.reconcileOptionFacts(nb.id)).toBe(1);
    expect(s.findOption(nb.id, '2006')!.data).toEqual({ price: 4995, miles: 162000, year: 2006 });
    // Rounded text still agrees: no change.
    s.setOptionFacts(nb.id, a.id, { price: 4995, miles: 161870, year: 2006 });
    expect(s.reconcileOptionFacts(nb.id)).toBe(0);
  });
});

describe('shortName', () => {
  it('cuts at a comma only when what follows is facts', () => {
    expect(shortName('2010 Toyota RAV4 Sport 4WD, 149,652 mi, $4,023, Lynnwood')).toBe('2010 Toyota RAV4 Sport 4WD');
    expect(shortName('Principal Engineer, Ramp')).toBe('Principal Engineer, Ramp');
    expect(shortName('Ibanez Talman TCY621 acoustic-electric - $279.99')).toBe('Ibanez Talman TCY621 acoustic-electric');
    expect(shortName('Plain title')).toBe('Plain title');
  });
});

describe('how a notebook was made', () => {
  it('collects the runs that filed into it, their sub-runs (nested), and what each left', async () => {
    const { notebookLineage } = await import('./notebook-lineage.js');
    dir = mkdtempSync(join(tmpdir(), 'sua-lineage-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    const at = (m: number) => new Date(Date.UTC(2026, 9, 7, 12, m)).toISOString();
    const run = (id: string, agentName: string, m: number, parent?: [string, string]) => runs.createRun({
      id, agentName, status: 'completed', startedAt: at(m), completedAt: at(m + 1), triggeredBy: 'dashboard',
      ...(parent ? { parentRunId: parent[0], parentNodeId: parent[1] } : {}),
    } as never);
    run('sweep-1', 'car-sweep', 0);
    run('cl-a', 'craigslist-search', 1, ['sweep-1', 'seattle']);
    run('cl-b', 'craigslist-search', 2, ['sweep-1', 'bellingham']);
    run('geo', 'geocode', 3, ['cl-b', 'where']);
    run('sweep-2', 'car-sweep', 30);
    run('other', 'unrelated', 40);
    s.recordSearch(nb.id, 'car-sweep', 'sweep-1', 2, at(5));
    const a = s.upsertOption(nb.id, { title: 'RAV4', by: 'agent:car-sweep', runId: 'sweep-1', data: { price: 4023 } }).entry;
    s.upsertOption(nb.id, { title: 'Forester', by: 'agent:car-sweep', runId: 'sweep-1' });
    s.addEntry(nb.id, { kind: 'note', title: 'One site blocked', by: 'agent:car-sweep', runId: 'sweep-1' });
    s.recordSearch(nb.id, 'car-sweep', 'sweep-2', 1, at(35));
    s.upsertOption(nb.id, { title: 'RAV4', by: 'agent:car-sweep', runId: 'sweep-2', data: { price: 3900 } }); // seen again
    expect(a.id).toBeTruthy();

    const l = notebookLineage(s, runs, nb.id);
    expect(l.feeders.map((f) => f.run.id)).toEqual(['sweep-2', 'sweep-1']); // newest first; 'other' never filed
    const first = l.feeders[1];
    expect(first).toMatchObject({ found: 2, kinds: { option: 2, note: 1 } });
    expect(first.subRuns.map((r) => [r.id, r.parentRunId, r.parentNodeId])).toEqual([
      ['cl-a', 'sweep-1', 'seattle'], ['cl-b', 'sweep-1', 'bellingham'], ['geo', 'cl-b', 'where'],
    ]);
    expect(l.feeders[0]).toMatchObject({ found: 1, seenAgain: 1 });
    expect(notebookLineage(s, runs, nb.id, 1)).toMatchObject({ more: 1 });

    // A run's page: which notebooks it (or the run that started it) filed into.
    expect(s.notebooksForRuns(['geo', 'cl-b', 'sweep-1'])).toEqual([{ notebookId: 'car', title: 'Car', runId: 'sweep-1' }]);
    expect(s.notebooksForRuns(['other'])).toEqual([]);
  });
});

describe('passes', () => {
  it('a pass groups its runs (in order, failed ones too); runs from before passes are one-run passes', async () => {
    const { notebookLineage } = await import('./notebook-lineage.js');
    dir = mkdtempSync(join(tmpdir(), 'sua-passes-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Car' });
    const at = (m: number) => new Date(Date.UTC(2026, 9, 7, 12, m)).toISOString();
    const run = (id: string, agentName: string, m: number, status = 'completed') => runs.createRun({ id, agentName, status, startedAt: at(m), completedAt: at(m + 1), triggeredBy: 'dashboard' } as never);
    run('old', 'car-sweep', 0);
    s.recordSearch(nb.id, 'car-sweep', 'old', 2, at(1));
    run('p1', 'car-sweep', 10);
    run('p2', 'craigslist-search', 12, 'failed');
    const pass = s.startPass(nb.id, 'pipeline', at(10));
    s.addRunToPass(pass, 'p1');
    s.addRunToPass(pass, 'p2');
    s.addRunToPass(pass, 'p1'); // once
    s.recordSearch(nb.id, 'car-sweep', 'p1', 3, at(11));
    s.finishPass(pass, '3 new entries · car-sweep: 3 new · craigslist-search: failed', at(13));
    expect(s.passes(nb.id)).toEqual([expect.objectContaining({ id: pass, kind: 'pipeline', runIds: ['p1', 'p2'], finishedAt: at(13), note: expect.stringContaining('3 new') })]);

    const l = notebookLineage(s, runs, nb.id);
    expect(l.passes.map((p) => [p.kind, p.feeders.map((f) => f.run.id)])).toEqual([['pipeline', ['p1', 'p2']], ['earlier', ['old']]]);
    expect(l.passes[0].feeders[1]).toMatchObject({ run: { status: 'failed' }, kinds: {} }); // a failed run with nothing filed still shows in its pass
    expect(l.passes[1]).toMatchObject({ id: 'run:old' });
  });
});

describe('fit score', () => {
  it('a score field (inferred from fit/icp_score) ranks options by fit instead of price', async () => {
    const { rankBy, rankOptions } = await import('./notebooks.js');
    const fields = cleanFields([
      { key: 'company', type: 'text', role: 'org' }, { key: 'revenue', type: 'money', range: true },
      { key: 'employees', type: 'number' }, { key: 'icp_score', type: 'number' },
    ]);
    expect(fields.find((f) => f.key === 'icp_score')).toMatchObject({ role: 'score', better: 'higher' });
    expect(fields.find((f) => f.key === 'revenue')!.role).toBeUndefined(); // revenue isn't a price
    expect(cleanFields([{ key: 'rating', type: 'number' }])[0].role).toBe('measure');
    expect(rankBy({ fields })).toMatchObject({ by: 'score', better: 'higher' });
    expect(rankBy({ fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }] })).toMatchObject({ by: 'price', better: 'lower' });
    const opts = [{ name: 'b', score: 61 }, { name: 'a', score: 88 }, { name: 'c' }, { name: 'd', score: 95, ruledOut: { reason: 'x' } }] as never[];
    expect(rankOptions({ fields }, opts).map((o: { name: string }) => o.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('where a fact came from', () => {
  it('a fact can carry its source and an estimate flag; re-stating it replaces them; bad links are dropped', async () => {
    const { splitFacts } = await import('./notebooks.js');
    expect(splitFacts({ revenue: { value: 2e7, source: 'https://news.example.com/a', estimate: true }, employees: 140, range: { min: 1, max: 2 } }))
      .toEqual({ values: { revenue: 2e7, employees: 140, range: { min: 1, max: 2 } }, meta: { revenue: { source: 'https://news.example.com/a', estimate: true } } });
    expect(splitFacts({ x: { value: 1, confidence: 'estimate' } }).meta).toEqual({ x: { estimate: true } });

    dir = mkdtempSync(join(tmpdir(), 'sua-factmeta-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Accounts' }).id, [
      { key: 'website', label: 'Website', type: 'url', role: 'link' }, { key: 'revenue', label: 'Revenue', type: 'money', range: true },
      { key: 'employees', label: 'Employees', type: 'number', role: 'measure' },
    ]);
    const first = s.upsertOption(nb.id, { title: 'Ledgerline', by: 'agent:x', data: {
      website: 'https://ledgerline.example.com',
      revenue: { value: 2e7, source: 'https://news.example.com/series-b' },
      employees: { value: 140, estimate: true, source: 'javascript:alert(1)' },
    } }).entry;
    expect(first.data).toMatchObject({ revenue: 2e7, employees: 140 });
    expect(first.factMeta).toEqual({ revenue: { source: 'https://news.example.com/series-b' }, employees: { estimate: true } });
    // Seen again: employees now confirmed (no flag), revenue not re-stated keeps its source.
    const again = s.upsertOption(nb.id, { title: 'Ledgerline', by: 'agent:x', data: { website: 'https://ledgerline.example.com', employees: { value: 150, source: 'https://ledgerline.example.com/careers' } } }).entry;
    expect(again.data).toMatchObject({ revenue: 2e7, employees: 150 });
    expect(s.entries(nb.id).find((e) => e.id === first.id)!.factMeta).toEqual({
      revenue: { source: 'https://news.example.com/series-b' }, employees: { source: 'https://ledgerline.example.com/careers' },
    });
    // A plain re-statement clears its meta.
    s.upsertOption(nb.id, { title: 'Ledgerline', by: 'agent:x', data: { website: 'https://ledgerline.example.com', revenue: 2.1e7 } });
    expect(s.entries(nb.id).find((e) => e.id === first.id)!.factMeta).toEqual({ employees: { source: 'https://ledgerline.example.com/careers' } });
    // The view carries it to the widgets.
    const v = notebookViewData(s.get(nb.id)!, s.entries(nb.id)).notebook.options[0];
    expect(v.factMeta).toEqual({ employees: { source: 'https://ledgerline.example.com/careers' } });
  });
});

describe("an option's text vs its facts", () => {
  it('a link the text cites is not a mix-up and never replaces the option\'s own link; numbers still are', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Accounts' }).id, [
      { key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'careers', label: 'Careers', type: 'url', role: 'link' },
      { key: 'fit', label: 'Fit', type: 'number', role: 'score' }, { key: 'tier', label: 'Tier', type: 'text' },
    ]);
    const a = s.upsertOption(nb.id, {
      title: 'Capital: Postgres migration planned', by: 'agent:x',
      body: 'Tier 2 (76).\n\n"an active Oracle-to-PostgreSQL migration" (https://jobs.lever.co/capital/2b44)',
      data: { company: 'Capital', careers: 'https://jobs.lever.co/capital', fit: 76, tier: 'Tier 2' },
    }).entry;
    // The page's repair leaves it alone, and its facts stay whole.
    expect(s.reconcileOptionFacts(nb.id)).toBe(0);
    expect(s.findOption(nb.id, 'Capital')!.data).toEqual({ company: 'Capital', careers: 'https://jobs.lever.co/capital', fit: 76, tier: 'Tier 2' });
    // Setup giving facts: the cited post doesn't take over the careers link.
    s.setOptionFacts(nb.id, a.id, { fit: 80 });
    expect(s.findOption(nb.id, 'Capital')!.data).toMatchObject({ careers: 'https://jobs.lever.co/capital', fit: 80 });
    // No link of its own yet: the text's link fills in.
    const b = s.addEntry(nb.id, { kind: 'option', title: 'Globex', body: 'See https://globex.example.com/jobs', by: 'agent:x' });
    expect(s.setOptionFacts(nb.id, b.id, { company: 'Globex' })!.data).toEqual({ company: 'Globex', careers: 'https://globex.example.com/jobs' });
  });
});
