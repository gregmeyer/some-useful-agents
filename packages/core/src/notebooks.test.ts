/** Notebooks (G1): the store, entries as items on the notebook's surface, and its item on Home. */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { InboxStore } from './inbox-store.js';
import { AgentStore } from './agent-store.js';
import { cleanAnswer, cleanPlan, cleanSteps, cleanMeeting, isMeetingNotebook, readOptionText, NotebookStore, vinKey, sameAddress, isListPage, stepProgress, optionLink, numbersInText, groundFacts, notebookEntryItems, notebookProgress, notebookSlug, notebookViewData, cleanFields, optionFingerprint, shortName, subjectOut, fillSubject, templateSubjectGuess, clipWords } from './notebooks.js';
import { compileSurface } from './surfaces/compile.js';
import { defaultSurface } from './surfaces/defaults.js';
import { collectItems, itemSourcesFromHandle } from './items/collect.js';

let dir: string;
let runs: RunStore;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('NotebookStore', () => {
  it('knows which notebooks an agent works for: its pipeline, its searches, what it filed', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const car = s.create({ title: 'Car', pipeline: ['car-sweep'] });
    const guitar = s.create({ title: 'Guitar' });
    const cabinet = s.create({ title: 'Cabinet' });
    s.recordSearch(guitar.id, 'research', 'r1', 2);
    s.addEntry(cabinet.id, { kind: 'note', title: 'Hooks on the left', by: 'agent:research' });
    expect(s.notebooksFedBy('car-sweep')).toEqual([car.id]);
    expect(s.notebooksFedBy('research').sort()).toEqual([cabinet.id, guitar.id].sort());
    expect(s.notebooksFedBy('nobody')).toEqual([]);
  });

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
    expect(s.setCriteria(nb.id, ['One fits', 'Decided by Oct 15']).criteria).toEqual([{ text: 'One fits', met: true, held: true }, { text: 'Decided by Oct 15', met: false }]);

    const decided = s.decide(nb.id, 'Buy the RAV4');
    expect(decided).toMatchObject({ status: 'decided', decision: 'Buy the RAV4' });
    // Deciding ticks the done-when that says so.
    expect(decided.criteria[1]).toEqual({ text: 'Decided by Oct 15', met: true });
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
      kind: 'question', state: 'open', title: 'Notebook: Car', summary: 'What is your budget?', subject: { threadId: thread.id },
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

  it('reads a briefing\'s quote and question fields from their names, and leaves other text alone', () => {
    expect(cleanFields([
      { key: 'theme', type: 'text' },
      { key: 'evidence', type: 'text' },
      { key: 'conversation_question', type: 'text' },
      { key: 'notes', type: 'text' },
    ]).map((f) => `${f.key}:${f.role ?? ''}`)).toEqual(['theme:', 'evidence:quote', 'conversation_question:ask', 'notes:']);
    expect(cleanFields([{ key: 'what_they_said', type: 'text' }, { key: 'question_to_ask', type: 'text' }]).map((f) => f.role)).toEqual(['quote', 'ask']);
    // A role given wins; only text fields are guessed.
    expect(cleanFields([{ key: 'quote', type: 'money', role: 'price' }, { key: 'questions', type: 'number' }]).map((f) => f.role ?? '')).toEqual(['price', '']);
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
    const f = s.upsertOption(nb.id, { title: '2009 Subaru Forester 2.5X', by: 'agent:sweep', fingerprint: 'autotrader 700000001' });
    expect(f.seenAgain).toBe(true);
    expect(s.entries(nb.id).filter((e) => e.kind === 'option').map((e) => e.fingerprint).sort()).toEqual(['autotrader 700000001', 'cargurus.com/cars/l-used-toyota-rav4-mg108_l37788']);
  });

  it('fills in what an older option\'s text says once the notebook has fields', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Buy a used car' });
    s.addEntry(nb.id, { kind: 'option', title: '2009 Subaru Forester 2.5X, 157k mi, $4,995, Example Motors', body: 'Not verified: https://www.autotrader.com/cars-for-sale/inventory/700000001?city=Seattle.', by: 'agent:sweep' });
    s.addEntry(nb.id, { kind: 'option', title: 'A nice one', by: 'you' });
    expect(s.backfillOptions(nb.id)).toBe(0); // no fields yet
    s.setFields(nb.id, CAR_FIELDS);
    expect(s.backfillOptions(nb.id)).toBe(1);
    const fo = s.entries(nb.id).find((e) => e.title.startsWith('2009'))!;
    expect(fo.data).toEqual({ price: 4995, miles: 157000, year: 2009, listing_url: 'https://www.autotrader.com/cars-for-sale/inventory/700000001?city=Seattle' });
    expect(fo.fingerprint).toBe('autotrader.com/cars-for-sale/inventory/700000001');
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

  it('says which options the last run that found any added, found again, or had from before', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Buy a used car' }).id, [{ key: 'url', label: 'Listing', type: 'url', role: 'link' }]);
    const tick = () => new Promise((r) => setTimeout(r, 3));
    const add = (n: string, agent: string, run: string) => s.upsertOption(nb.id, { title: `Car ${n}`, by: `agent:${agent}`, runId: run, data: { url: `https://cars.example/${n}` } });
    const added = () => Object.fromEntries(notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options.map((o) => [o.title, o.added]));
    expect(s.lastFindAt(nb.id)).toBeUndefined();
    let at = new Date().toISOString(); await tick();
    add('a', 'sweep', 'r1'); add('b', 'sweep', 'r1'); s.recordSearch(nb.id, 'sweep', 'r1', 2, at);
    await tick();
    // A step's pass with two agents is one run: what either found is new.
    const pass = s.startPass(nb.id, 'pipeline'); await tick();
    at = new Date().toISOString(); await tick();
    add('b', 'sweep', 'r2'); add('c', 'sweep', 'r2'); s.recordSearch(nb.id, 'sweep', 'r2', 2, at);
    await tick();
    at = new Date().toISOString(); await tick();
    add('d', 'finder', 'r3'); s.recordSearch(nb.id, 'finder', 'r3', 1, at);
    s.finishPass(pass);
    expect(added()).toEqual({ 'Car a': 'earlier', 'Car b': 'again', 'Car c': 'new', 'Car d': 'new' });
    // A later search that found nothing, or a run that filed only notes, isn't the last run that found options.
    await tick(); s.recordSearch(nb.id, 'sweep', 'r4', 0);
    const talk = s.startPass(nb.id, 'conversation'); await tick();
    s.addEntry(nb.id, { kind: 'note', title: 'Dealer reply', body: '', by: 'agent:helper', runId: 'r5' }); s.recordSearch(nb.id, 'helper', 'r5', 1);
    s.finishPass(talk);
    // Nor does one you add by hand.
    s.upsertOption(nb.id, { title: 'Car e', by: 'you', data: { url: 'https://cars.example/e' } });
    expect(added()).toMatchObject({ 'Car a': 'earlier', 'Car b': 'again', 'Car c': 'new', 'Car d': 'new' });
    // Without the store there's nothing to compare to.
    expect(notebookViewData(s.get(nb.id)!, s.entries(nb.id)).notebook.options[0].added).toBeUndefined();
  });
});

describe('option photos', () => {
  it('only trusts a page photo when the page is that listing', async () => {
    const { previewMatchesOption, looksLikeOneListing } = await import('./notebooks.js');
    expect(looksLikeOneListing('https://www.autotrader.com/cars-for-sale/inventory/700000001?city=Seattle')).toBe(true);
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
    const a = s.addEntry(nb.id, { kind: 'option', title: '2006 Subaru Forester 2.5X, 162k mi, $4,995, Example Motors', by: 'agent:x' });
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

  it('a salary range in the text is a range: it agrees with the facts, and facts a past repair took away come back', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Jobs' }).id, [
      { key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher', range: true },
      { key: 'company', label: 'Company', type: 'text', role: 'org' },
      { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' },
    ]);
    expect(readOptionText('Director of Tax, Boomi, $190k–$275k (tax only)', nb.fields)).toEqual({ salary: { min: 190000, max: 275000 } });
    expect(readOptionText('Senior Director, Tax, $217,000 - $247,700 remote base', nb.fields)).toEqual({ salary: { min: 217000, max: 247700 } });
    expect(readOptionText('Controller, base from $170k', nb.fields)).toEqual({ salary: 170000 });

    // Filed with its range and facts: they agree with the title, so all are kept.
    const full = { salary: { min: 150000, max: 160000 }, company: 'Going Concern', posting_url: 'https://example.com/job/1' };
    const a = s.upsertOption(nb.id, { title: 'Remote Accounting & Tax Director, $150k–$160k', by: 'agent:x', data: full }).entry;
    expect(s.findOption(nb.id, 'Remote Accounting')!.data).toEqual(full);
    expect(s.reconcileOptionFacts(nb.id)).toBe(0);
    // "from $170k" agrees with $170k–$200k and doesn't replace it.
    const b = s.upsertOption(nb.id, { title: 'Controller, Boom, base from $170k', by: 'agent:x', data: { company: 'Boom' } }).entry;
    s.setOptionFacts(nb.id, b.id, { salary: { min: 170000, max: 200000 } });
    expect(s.findOption(nb.id, 'Boom')!.data).toMatchObject({ salary: { min: 170000, max: 200000 } });

    // Stored by the old repair (the range read as its first number "contradicted" it): restored from its filing.
    runs.databaseHandle().prepare('UPDATE notebook_entries SET data_json = ? WHERE id = ?').run(JSON.stringify({ salary: 150000 }), a.id);
    expect(s.reconcileOptionFacts(nb.id)).toBe(1);
    expect(s.findOption(nb.id, 'Remote Accounting')!.data).toEqual(full);
    expect(s.reconcileOptionFacts(nb.id)).toBe(0);
  });

  it('corrects an option\'s facts on someone\'s word: the option changes, its history says so, and its title can\'t undo it', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Cabinet' }).id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'width', label: 'Width', type: 'number', unit: 'in', role: 'measure' },
    ]);
    const c = s.upsertOption(nb.id, { title: 'Example cabinet, 24" wide, $239', by: 'agent:x', runId: 'r1', data: { price: { value: 4023, source: 'https://shop.example/c' }, width: 24 } }).entry;
    const r = s.correctOption(nb.id, c.id, { price: 136.64 }, 'sua');
    expect(r.changed).toEqual([{ key: 'price', from: 4023, to: 136.64 }]);
    expect(s.findOption(nb.id, 'cabinet')!.data).toEqual({ price: 136.64, width: 24 });
    expect(s.findOption(nb.id, 'cabinet')!.factMeta?.price).toBeUndefined(); // the old source no longer backs it
    expect(s.sightings(c.id).at(-1)).toMatchObject({ correctedBy: 'sua', data: { price: 136.64 } });
    // The title says $239: the correction still stands.
    expect(s.reconcileOptionFacts(nb.id)).toBe(0);
    expect(s.findOption(nb.id, 'cabinet')!.data!.price).toBe(136.64);
    // The wrong price isn't a price move.
    const o = notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options[0];
    expect(o.priceHistory.map((p) => p.value)).toEqual([136.64]);
    expect(o.priceChange).toBeUndefined();
    // Saying the same again changes nothing.
    expect(s.correctOption(nb.id, c.id, { price: 136.64 }).changed).toEqual([]);
  });

  it('keeps a newer price a later search saw over the price in the option\'s own title', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Guitar' }).id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'url', label: 'Product', type: 'url', role: 'link' },
    ]);
    const url = 'https://shop.example/guitar-1';
    const g = s.upsertOption(nb.id, { title: 'Example acoustic-electric, $279.99, in stock', by: 'agent:x', runId: 'r1', data: { price: 279.99, url } }).entry;
    // A later search finds the same guitar (same link) at a new price.
    s.upsertOption(nb.id, { title: 'Example acoustic-electric', by: 'agent:x', runId: 'r2', data: { price: 299.99, url } });
    expect(s.reconcileOptionFacts(nb.id)).toBe(0);
    expect(s.findOption(nb.id, 'Example')!.data).toEqual({ price: 299.99, url });
    // Overwritten by the title before this fix: restored from the later search.
    runs.databaseHandle().prepare('UPDATE notebook_entries SET data_json = ? WHERE id = ?').run(JSON.stringify({ price: 279.99, url }), g.id);
    expect(s.reconcileOptionFacts(nb.id)).toBe(1);
    expect(s.findOption(nb.id, 'Example')!.data).toEqual({ price: 299.99, url });
    expect(s.reconcileOptionFacts(nb.id)).toBe(0);
  });
});

describe('archiving and deleting a notebook', () => {
  it('archives out of lists (kept whole, restorable) and deletes everything in it', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const keep = s.create({ title: 'Keep' });
    const old = s.setFields(s.create({ title: 'Old search', cadence: '0 7 * * *' }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    const o = s.upsertOption(old.id, { title: 'A thing', by: 'agent:x', runId: 'r1', data: { price: 10 } }).entry;
    s.recordSearch(old.id, 'x', 'r1', 1);

    s.archive(old.id);
    expect(s.list().map((n) => n.id)).toEqual([keep.id]);
    expect(s.list({ status: 'active' }).map((n) => n.id)).toEqual([keep.id]);
    expect(s.list({ archived: 'only' }).map((n) => n.id)).toEqual([old.id]);
    expect(s.list({ archived: 'include' })).toHaveLength(2);
    expect(s.get(old.id)!.archivedAt).toEqual(expect.any(String));
    expect(s.entries(old.id)).toHaveLength(1); // nothing deleted
    s.unarchive(old.id);
    expect(s.get(old.id)!.archivedAt).toBeUndefined();
    expect(s.list()).toHaveLength(2);

    expect(s.delete(old.id)).toEqual({ entries: 1 });
    expect(s.get(old.id)).toBeUndefined();
    const db = runs.databaseHandle();
    for (const t of ['notebook_entries', 'notebook_sightings', 'notebook_searches']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE notebook_id = ?`).get(old.id) as { n: number }).n).toBe(0);
    }
    expect(s.sightings(o.id)).toEqual([]);
    expect(s.delete(old.id)).toBeUndefined();
    expect(s.list().map((n) => n.id)).toEqual([keep.id]);
  });
});

describe('numbers a source states (groundFacts)', () => {
  it('reads numbers the ways people write them', () => {
    const n = numbersInText('$4,023 · 157k mi · 4.9k OBO · $1.2M revenue · 18 million users · 136.64 · 125-175k miles · two hooks');
    for (const x of [4023, 157000, 4900, 1200000, 18000000, 136.64, 125000, 175000, 2]) expect(n).toContain(x);
  });
  it('keeps numbers the output states (rounded is fine), drops the rest, and keeps text', () => {
    const out = 'Zeus & Ruta wall cabinet, 24 in wide, two hooks, MDF. Target. Around 157k miles on the other one; $4.9k.';
    const g = groundFacts({ price: 4023, width: 24, hooks: 2, miles: 156870, alt: '4.9k', material: 'MDF', range: { min: 20, max: 24 }, src: { value: 239, source: 'https://x.example' } }, out);
    expect(g.data).toEqual({ width: 24, hooks: 2, miles: 156870, alt: '4.9k', material: 'MDF' });
    expect(g.dropped.map((d) => d.key).sort()).toEqual(['price', 'range', 'src']);
  });
});

describe("an option's listing link and its photo", () => {
  it('uses a link field, else any fact holding a web address', () => {
    const f = (o: object) => ({ label: 'x', ...o }) as never;
    expect(optionLink([f({ key: 'u', type: 'url', role: 'link' }), f({ key: 'a', type: 'text' })], { u: 'https://a.example/1', a: 'https://b.example/2' })).toBe('https://a.example/1');
    expect(optionLink([f({ key: 'avail', type: 'text' }), f({ key: 'p', type: 'url' })], { avail: 'https://shop.example/p/1', p: 'https://c.example/3' })).toBe('https://c.example/3');
    expect(optionLink([f({ key: 'avail', type: 'text' })], { avail: ' https://shop.example/p/1 ' })).toBe('https://shop.example/p/1');
    expect(optionLink([f({ key: 'avail', type: 'text' })], { avail: 'In stock' })).toBeUndefined();
  });

  it('tries a listing photo even with a drawing; a failed try keeps the drawing and is not repeated; a photo replaces it', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Cabinet' }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'availability', label: 'Availability', type: 'text' }]);
    const c = s.upsertOption(nb.id, { title: 'Example cabinet', by: 'agent:x', data: { price: 90, availability: 'https://shop.example/p/A-1' } }).entry;
    expect(notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options[0].link).toBe('https://shop.example/p/A-1');
    s.savePhoto(nb.id, c.id, 'illustration', { contentType: 'image/svg+xml', bytes: new Uint8Array([1]) }, { kind: 'illustration' });
    expect(s.photoCandidates(nb.id).map((x) => x.link)).toEqual(['https://shop.example/p/A-1']);

    s.savePhoto(nb.id, c.id, 'https://shop.example/p/A-1', { error: 'blocked' });
    expect(s.photoKind(c.id)).toBe('illustration'); // still has its drawing
    expect(s.photoCandidates(nb.id)).toEqual([]); // and that address isn't tried again

    s.savePhoto(nb.id, c.id, 'https://shop.example/p/A-1', { contentType: 'image/jpeg', bytes: new Uint8Array([9]) });
    expect(s.photoKind(c.id)).toBe('listing');
    expect(s.photoCandidates(nb.id)).toEqual([]);
  });
});

describe('shortName', () => {
  it('cuts at a comma only when what follows is facts', () => {
    expect(shortName('2010 Toyota RAV4 Sport 4WD, 149,652 mi, $4,023, Lynnwood')).toBe('2010 Toyota RAV4 Sport 4WD');
    expect(shortName('Principal Engineer, Ramp')).toBe('Principal Engineer, Ramp');
    expect(shortName('Ibanez Talman TCY621 acoustic-electric - $279.99')).toBe('Ibanez Talman TCY621 acoustic-electric');
    expect(shortName('Plain title')).toBe('Plain title');
    // One word says too little: the next part comes too.
    expect(shortName('Director, Accounting Operations (FlexJobs listing), $192k–$300k, unconfirmed')).toBe('Director, Accounting Operations (FlexJobs listing)');
    expect(shortName('Controller, $180k–$190k')).toBe('Controller');
    expect(shortName('Director, Accounting (Remote, US), Everyday Electric (formerly Renew Home), $185k–$225k')).toBe('Director, Accounting (Remote, US)');
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
    run('cl-b', 'craigslist-search', 2, ['sweep-1', 'portland']);
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
      ['cl-a', 'sweep-1', 'seattle'], ['cl-b', 'sweep-1', 'portland'], ['geo', 'cl-b', 'where'],
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

describe('the words that back a fact', () => {
  it('keeps a quote; only trusted (code-filed) facts may say it was checked; short quotes are dropped', async () => {
    const { splitFacts } = await import('./notebooks.js');
    const fact = { fit: { value: 88, source: 'https://jobs.example.com/1', quote: '  leading our   Kafka migration ', checked: true } };
    expect(splitFacts(fact).meta.fit).toEqual({ source: 'https://jobs.example.com/1', quote: 'leading our Kafka migration' });
    expect(splitFacts(fact, { trusted: true }).meta.fit).toMatchObject({ checked: true });

    dir = mkdtempSync(join(tmpdir(), 'sua-quotes-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Accounts' }).id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    const a = s.upsertOption(nb.id, { title: 'Acme', by: 'agent:x', data: { company: 'Acme', ...fact }, trustedFacts: true }).entry;
    expect(a.factMeta).toEqual({ fit: { source: 'https://jobs.example.com/1', quote: 'leading our Kafka migration', checked: true } });
    // A model can't claim the check.
    const b = s.upsertOption(nb.id, { title: 'Globex', by: 'agent:keeper', data: { company: 'Globex', ...fact } }).entry;
    expect(b.factMeta!.fit.checked).toBeUndefined();
    // Too short to prove anything: no quote kept.
    const c = s.upsertOption(nb.id, { title: 'Initech', by: 'agent:x', data: { company: 'Initech', fit: { value: 60, quote: 'Kafka' } }, trustedFacts: true }).entry;
    expect(c.factMeta).toBeUndefined();
    expect(notebookViewData(s.get(nb.id)!, s.entries(nb.id)).notebook.options.find((o) => o.name === 'Acme')!.factMeta!.fit.quote).toBe('leading our Kafka migration');
  });
});

describe('the shortlist as a spreadsheet', () => {
  it('ranks best first, one column per field, with sources, the quote, and formula-safe text', async () => {
    const { notebookCsv } = await import('./notebooks.js');
    dir = mkdtempSync(join(tmpdir(), 'sua-csv-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    let nb = s.setFields(s.create({ title: 'Accounts' }).id, [
      { key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'revenue', label: 'Revenue', type: 'money', range: true },
      { key: 'fit', label: 'Fit', type: 'number', role: 'score' },
    ]);
    nb = s.setChecks(nb.id, ['Talked to a customer', 'Pricing fits']);
    s.upsertOption(nb.id, { title: 'Globex', by: 'agent:x', data: { company: 'Globex', fit: 70 } });
    const acme = s.upsertOption(nb.id, { title: 'Acme, "the" best', by: 'agent:x', trustedFacts: true, data: {
      company: '=HYPERLINK("http://evil")', revenue: { value: { min: 2e7, max: 3e7 }, estimate: true },
      fit: { value: 91, source: 'https://jobs.example.com/1', quote: 'leading our Kafka migration', checked: true },
    } }).entry;
    s.checkOption(nb.id, acme.id, 'Pricing fits', true);
    const out = s.upsertOption(nb.id, { title: 'Initech', by: 'agent:x', data: { company: 'Initech', fit: 10 } }).entry;
    s.ruleOut(nb.id, out.id, 'Unfit (10): sells printers');
    const options = notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options;

    const csv = notebookCsv(s.get(nb.id)!, options);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Rank,Option,Stage,Company,Revenue,Fit,Estimates,Sources,Quote,Quote source,Quote checked,Checks done,First seen,Last seen');
    expect(lines).toHaveLength(3); // ruled out left out
    expect(lines[1]).toContain(`1,"Acme, ""the"" best",,"'=HYPERLINK(""http://evil"")",20000000-30000000,91,Revenue,Fit: https://jobs.example.com/1,leading our Kafka migration,https://jobs.example.com/1,yes,1 of 2,`);
    expect(lines[2].startsWith('2,Globex,,Globex,,70,,,,,,0 of 2,')).toBe(true);

    const all = notebookCsv(s.get(nb.id)!, options, { ruledOut: true }).slice(1).trimEnd().split('\r\n');
    expect(all[0].endsWith(',Ruled out')).toBe(true);
    expect(all[3]).toMatch(/^,Initech,.*,Unfit \(10\): sells printers$/);

    // With steps, Stage is how far it got; once picked, a Chosen column, and rows: 'chosen' keeps just those.
    s.setSteps(nb.id, [{ title: 'Find 2', kind: 'find', target: 2 }, { title: 'Check them', kind: 'check' }, { title: 'Pick 1', kind: 'decide', target: 1 }]);
    const globex = s.findOption(nb.id, 'Globex')!;
    s.decide(nb.id, '', 'you', [globex.id]);
    const after = notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook.options;
    const picked = notebookCsv(s.get(nb.id)!, after, { rows: 'chosen' }).slice(1).trimEnd().split('\r\n');
    expect(picked[0]).toBe('Rank,Option,Stage,Company,Revenue,Fit,Chosen,Estimates,Sources,Quote,Quote source,Quote checked,Checks done,First seen,Last seen');
    expect(picked).toHaveLength(2);
    expect(picked[1].startsWith('1,Globex,Chosen,Globex,,70,yes,')).toBe(true);
    const sel = notebookCsv(s.get(nb.id)!, after, { rows: 'all', ids: [acme.id, out.id] }).slice(1).trimEnd().split('\r\n');
    expect(sel.map((l) => l.split(',')[1])).toEqual(['Option', '"Acme', 'Initech']);
    expect(sel[0]).not.toContain('Chosen'); // none of these was picked
  });
});

describe('notebook facet labels', () => {
  it('keeps short labels per field, merges new ones without changing old, trims long ones, and records a failed try', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nbf-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Comp set' });
    expect(s.get(nb.id)!.facets).toBeUndefined();
    s.setFacetLabels(nb.id, 'value', { 'a long sentence': 'Office of the CFO', 'another one': 'Finance-led FP&A' }, '2026-10-09T00:00:00.000Z');
    s.setFacetLabels(nb.id, 'value', { 'a long sentence': 'Changed', 'a third': '  A label far longer than twenty-four characters ' });
    const f = s.get(nb.id)!.facets!.value;
    expect(f.labels).toEqual({ 'a long sentence': 'Office of the CFO', 'another one': 'Finance-led FP&A', 'a third': 'A label far longer than' });
    s.markFacetsFailed(nb.id, 'why', '2026-10-09T01:00:00.000Z');
    expect(s.get(nb.id)!.facets!.why).toMatchObject({ labels: {}, failedAt: '2026-10-09T01:00:00.000Z' });
  });
});

describe('options that are organizations match by name', () => {
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nb-org-'));
    runs = new RunStore(join(dir, 'runs.db'));
    return NotebookStore.fromHandle(runs.databaseHandle());
  };

  it('a comp set: "Motive" with its facts updates "Motive: planning and forecasting", keeping what it had', () => {
    const s = setup();
    const nb = s.create({ title: 'Comp set' });
    s.setFields(nb.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'employees', label: 'Employees', type: 'number', role: 'measure' }, { key: 'founded', label: 'Founded', type: 'number' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    const motive = s.upsertOption(nb.id, { title: 'Motive: planning and forecasting finance hiring', by: 'you', data: { company: 'Motive', fit: 97 } }).entry;
    const r = s.upsertOption(nb.id, { title: 'Motive', by: 'agent:firmographic-research', runId: 'run-1', data: { company: 'Motive', employees: { value: 4100, source: 'https://example.com/motive' }, founded: 2013 } });
    expect(r.seenAgain).toBe(true);
    expect(r.entry.id).toBe(motive.id);
    const kept = s.findOption(nb.id, motive.id)!;
    expect(kept.data).toEqual({ company: 'Motive', fit: 97, employees: 4100, founded: 2013 });
    expect(kept.factMeta?.employees?.source).toBe('https://example.com/motive');
    expect(s.entries(nb.id).filter((e) => e.kind === 'option')).toHaveLength(1);
    // Without the company fact, the title's lead name ("Motive — …") still says which.
    expect(s.upsertOption(nb.id, { title: 'Motive — 2025 update', by: 'you', data: { founded: 2013 } }).seenAgain).toBe(true);
  });

  it('never for listings or jobs, or when two options share the name', () => {
    const s = setup();
    // Jobs: the title is the role, not the company.
    const jobs = s.create({ title: 'Jobs' });
    s.setFields(jobs.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }]);
    s.upsertOption(jobs.id, { title: 'Staff Engineer, Payments', by: 'you', data: { company: 'Stripe' } });
    expect(s.upsertOption(jobs.id, { title: 'Senior Engineer, Billing', by: 'you', data: { company: 'Stripe' } }).seenAgain).toBe(false);
    // Listings: no org field at all.
    const cars = s.create({ title: 'Cars' });
    s.setFields(cars.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    s.upsertOption(cars.id, { title: '2008 Subaru Forester 2.5 X', by: 'you', data: { price: 3495 } });
    expect(s.upsertOption(cars.id, { title: '2008 Subaru Forester 2.5 X, Everett', by: 'you', data: { price: 4100 } }).seenAgain).toBe(false);
    // Two options in the running for the same company (kept before this matched): ambiguous, so none.
    const comps = s.create({ title: 'Comps 2' });
    s.setFields(comps.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }]);
    for (const t of ['Acme: planning', 'Acme: close']) s.setOptionFacts(comps.id, s.addEntry(comps.id, { kind: 'option', title: t, by: 'you' }).id, { company: 'Acme' });
    expect(s.findOrgOption(comps.id, { title: 'Acme', data: { company: 'Acme' } })).toBeUndefined();
    // One of them ruled out: the other is the one.
    const close = s.findOption(comps.id, 'Acme: close')!;
    s.ruleOut(comps.id, close.id, 'dup');
    expect(s.findOrgOption(comps.id, { title: 'Acme', data: { company: 'Acme' } })?.title).toBe('Acme: planning');
  });
});

describe('one organization, one option', () => {
  it('a company keyed differently by another agent is the same option; a job at it is not', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-org-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Comp set' });
    s.setFields(nb.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'website', label: 'Website', type: 'url', role: 'link' }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    const a = s.upsertOption(nb.id, { title: 'Pigment: connected business planning', by: 'agent:starter', data: { company: 'Pigment', website: 'https://www.pigment.com' } });
    expect(a.entry.fingerprint).toBe('pigment.com');
    const b = s.upsertOption(nb.id, { title: 'Pigment', by: 'agent:firmo', fingerprint: 'pigment', data: { company: 'Pigment', revenue: 111600000 } });
    expect(b).toMatchObject({ seenAgain: true, entry: { id: a.entry.id } });
    const c = s.upsertOption(nb.id, { title: 'Pigment: AI business planning platform', by: 'agent:acct', fingerprint: 'lever:pigment', data: { company: 'Pigment', fit: 96 } });
    expect(c.entry.id).toBe(a.entry.id);
    expect(s.entries(nb.id).filter((e) => e.kind === 'option')).toHaveLength(1);
    expect(s.entries(nb.id).find((e) => e.id === a.entry.id)!.data).toMatchObject({ revenue: 111600000, fit: 96 });
    // A job at Pigment isn't Pigment.
    const job = s.upsertOption(nb.id, { title: 'Staff Engineer, Pigment', by: 'agent:jobs', fingerprint: 'lever:pigment/123', data: { company: 'Pigment' } });
    expect(job.seenAgain).toBe(false);
  });

  it('merges copies into one: its own facts first, gaps filled, checks and picks combined, copies gone', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-org-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Comp set' });
    s.setFields(nb.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'why', label: 'Why', type: 'text' }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    s.setChecks(nb.id, ['Sells software', 'Big enough']);
    const keep = s.addEntry(nb.id, { kind: 'option', title: 'Pigment: planning', by: 'you' });
    s.setOptionFacts(nb.id, keep.id, { company: 'Pigment', why: 'Agile planning' });
    const b = s.addEntry(nb.id, { kind: 'option', title: 'Pigment', by: 'agent:firmo' });
    s.setOptionFacts(nb.id, b.id, { company: 'Pigment', why: 'Cutting observability costs', revenue: { value: 111600000, source: 'https://x.example/pigment', estimate: true } });
    const c = s.addEntry(nb.id, { kind: 'option', title: 'Pigment: AI planning', by: 'agent:acct' });
    s.setOptionFacts(nb.id, c.id, { company: 'Pigment', fit: 96 });
    s.checkOption(nb.id, c.id, 'Sells software', true);
    s.ruleOut(nb.id, c.id, 'Fails revenue');
    expect(s.mergeOptions(nb.id, keep.id, [b.id, c.id, keep.id])).toBe(2);
    const opts = s.entries(nb.id).filter((e) => e.kind === 'option');
    expect(opts.map((e) => e.id)).toEqual([keep.id]);
    expect(opts[0]).toMatchObject({ data: { company: 'Pigment', why: 'Agile planning', revenue: 111600000, fit: 96 }, checked: ['Sells software'] });
    expect(opts[0].ruledOut).toBeUndefined();
    expect(opts[0].factMeta?.revenue).toMatchObject({ source: 'https://x.example/pigment', estimate: true });
  });
});

describe('the same address is the same option', () => {
  it('reads an address as what it points at', () => {
    expect(sameAddress('https://www.cars.com/vehicle/123/?utm_source=x&gclid=1#photos')).toBe('cars.com/vehicle/123');
    expect(sameAddress('http://Cars.com/vehicle/123')).toBe('cars.com/vehicle/123');
    expect(sameAddress('https://example.com/item?id=9&ref=home')).toBe('example.com/item?id=9');
    expect(sameAddress('not a url')).toBeUndefined();
    expect(sameAddress('ftp://x.example/a')).toBeUndefined();
  });

  it('an option keyed differently but at the same listing is seen again; a shared company site on jobs is not', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-addr-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const cars = s.create({ title: 'Cars' });
    s.setFields(cars.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'url', label: 'Listing', type: 'url', role: 'link' }]);
    const a = s.upsertOption(cars.id, { title: '2010 RAV4', by: 'agent:sweep', data: { price: 4023, url: 'https://www.cargurus.com/listing/777?utm_source=sua' } });
    const b = s.upsertOption(cars.id, { title: '2010 Toyota RAV4 Sport', by: 'agent:vin', fingerprint: 'JTMRF4DV5AD123456', data: { price: 3900, url: 'https://cargurus.com/listing/777/' } });
    expect(b).toMatchObject({ seenAgain: true, entry: { id: a.entry.id } });
    expect(s.entries(cars.id).find((e) => e.id === a.entry.id)!.data).toMatchObject({ price: 3900 });
    // A results page several listings point at: a different car there is its own option.
    s.setFields(cars.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', role: 'measure' }, { key: 'url', label: 'Listing', type: 'url', role: 'link' }]);
    // A dealer's page several cars share (not shaped like a search page, so only the facts tell them apart).
    const page = 'https://dealer.example/used-subarus';
    const f1 = s.upsertOption(cars.id, { title: '2008 Subaru Forester 2.5 X, 177,967 mi', by: 'agent:sweep', fingerprint: 'f1', data: { miles: 177967, url: page } });
    expect(s.upsertOption(cars.id, { title: '2010 Subaru Forester 2.5 X, 152,949 mi', by: 'agent:sweep', fingerprint: 'f2', data: { miles: 152949, url: page } }).seenAgain).toBe(false);
    expect(s.upsertOption(cars.id, { title: '2008 Subaru Forester 2.5X', by: 'agent:other', fingerprint: 'f3', data: { miles: 140000, url: page } }).seenAgain).toBe(false);
    // Same year, miles within 5%: the same car, relisted. (A search-shaped page never matches: isListPage.)
    expect(s.upsertOption(cars.id, { title: '2008 Subaru Forester 2.5 X', by: 'agent:other', fingerprint: 'f4', data: { miles: 178400, url: page } }).entry.id).toBe(f1.entry.id);
    const jobs = s.create({ title: 'Jobs' });
    s.setFields(jobs.id, [{ key: 'posting', label: 'Posting', type: 'url', role: 'link' }, { key: 'site', label: 'Company site', type: 'url' }]);
    s.upsertOption(jobs.id, { title: 'Staff Engineer, Stripe', by: 'you', data: { posting: 'https://stripe.com/jobs/1', site: 'https://stripe.com' } });
    expect(s.upsertOption(jobs.id, { title: 'Senior Engineer, Stripe', by: 'you', data: { posting: 'https://stripe.com/jobs/2', site: 'https://stripe.com' } }).seenAgain).toBe(false);
  });
});

describe("an option's own page, not a search page", () => {
  it('tells search and results pages from an item\'s own page', () => {
    for (const u of ['https://www.cargurus.com/Cars/l-Used-2009-Subaru-Forester-Bellingham-c16785_L37799', 'https://www.cargurus.com/Cars/s-Used-Subaru-Forester-Under-10000-Bay-Center-d374_spt377_L37941', 'https://www.edmunds.com/used-2011-subaru-forester-seattle-wa/',
      'https://seattle.craigslist.org/search/cta?query=forester', 'https://example.com/search?q=cabinet', 'https://shop.example/s?k=24+inch+cabinet', 'https://cars.example/results?zip=98101']) expect([u, isListPage(u)]).toEqual([u, true]);
    for (const u of ['https://www.cargurus.com/details/412345678', 'https://www.edmunds.com/subaru/forester/2011/vin/JF2SHADC1BH712345/', 'https://seattle.craigslist.org/see/cto/d/everett-2008-forester/7781234567.html',
      'https://www.autotrader.com/cars-for-sale/vehicle/700000001', 'https://jobs.lever.co/pigment/c0d1156b', 'https://www.lowes.com/pd/bearsolim-24-in/5014223?zip=98101']) expect([u, isListPage(u)]).toEqual([u, false]);
  });

  it('marks links several options share or shaped like a search page; a source step on the link counts them missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-own-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Cars' });
    s.setFields(nb.id, [{ key: 'miles', label: 'Miles', type: 'number', role: 'measure' }, { key: 'url', label: 'Listing', type: 'url', role: 'link' }]);
    const shared = 'https://dealer.example/used-subarus';
    s.upsertOption(nb.id, { title: '2008 Forester', by: 'x', fingerprint: 'a', data: { miles: 177967, url: shared } });
    s.upsertOption(nb.id, { title: '2010 Forester', by: 'x', fingerprint: 'b', data: { miles: 152949, url: shared } });
    s.upsertOption(nb.id, { title: '2009 Forester', by: 'x', fingerprint: 'c', data: { miles: 140000, url: 'https://www.cargurus.com/Cars/l-Used-Subaru-Forester-c1' } });
    s.upsertOption(nb.id, { title: '2010 RAV4', by: 'x', fingerprint: 'd', data: { miles: 149652, url: 'https://www.cargurus.com/details/412345678' } });
    const v = notebookViewData(s.get(nb.id)!, s.entries(nb.id)).notebook.options;
    expect(Object.fromEntries(v.map((o) => [o.title, !!o.linkIsList]))).toEqual({ '2008 Forester': true, '2010 Forester': true, '2009 Forester': true, '2010 RAV4': false });
    const step = { kind: 'source' as const, facts: ['url'], status: 'todo' as const };
    expect(stepProgress(s.get(nb.id)!, s.entries(nb.id), step)).toMatchObject({ met: false, have: 1, want: 4 });
  });
});

describe('one form for a VIN', () => {
  it('reads a VIN key however it was written', () => {
    for (const k of ['vin|jf1sg63648h718869', 'vin:JF1SG63648H718869', 'JF1SG63648H718869', 'VIN JF1SG63648H718869', ' vin#jf1sg63648h718869 ']) expect([k, vinKey(k)]).toEqual([k, 'jf1sg63648h718869']);
    for (const k of ['cargurus|jf1sg63648h718869|x', 'abcdefghjklmnprst', '12345678901234567', 'vin|short']) expect([k, vinKey(k)]).toEqual([k, undefined]);
  });

  it('a car kept as "vin:…" is the same car as "vin|…" or the bare VIN, and takes the one form', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-vin-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Cars' });
    s.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', role: 'measure' }]);
    // Kept before this change, in the colon form.
    const old = s.addEntry(nb.id, { kind: 'option', title: '2011 Forester', by: 'x' });
    runs.databaseHandle().prepare('UPDATE notebook_entries SET fingerprint = ? WHERE id = ?').run('vin:jf2shaec3bh747334', old.id);
    const again = s.upsertOption(nb.id, { title: '2011 Subaru Forester 2.5X Limited', by: 'x', fingerprint: 'vin|JF2SHAEC3BH747334', data: { price: 5995 } });
    expect(again).toMatchObject({ seenAgain: true, entry: { id: old.id } });
    expect(s.entries(nb.id).find((e) => e.id === old.id)?.fingerprint).toBe('vin|jf2shaec3bh747334');
    expect(s.upsertOption(nb.id, { title: '2011 Forester', by: 'y', fingerprint: 'JF2SHAEC3BH747334', data: { miles: 150182 } }).entry.id).toBe(old.id);
    expect(s.entries(nb.id).filter((e) => e.kind === 'option')).toHaveLength(1);
  });
});


describe('notebook templates', () => {
  it('keep a notebook’s setup, fresh: no options, no decision, steps to do, done-whens unmet', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Find a director-level accounting job', statement: 'Austin or remote', params: ['Remote or Austin, TX', '$180k minimum comp'], criteria: ['At least five open roles that fit', 'A decision recorded'], pipeline: [], cadence: '' });
    s.setFields(nb.id, [{ key: 'salary', label: 'Salary', type: 'money', role: 'price', range: true }, { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }]);
    s.setChecks(nb.id, ['Pays at least $200k', 'Posting is still open']);
    s.setStages(nb.id, ['Found', 'Applied', 'Offer']);
    s.setSteps(nb.id, [
      { title: 'Find 5 roles', kind: 'find', target: 5, status: 'done', tries: 2, note: '8 found, goal 5', doneAt: '2026-10-15T00:00:00Z' },
      { title: 'Source pay', kind: 'source', agentId: 'listing-page-facts', facts: ['salary'], status: 'done', tries: 1, movedOn: true, doneAt: '2026-10-15T00:00:00Z' },
      { title: 'Check pay and scope', kind: 'check', status: 'stuck', tries: 3, stalled: true },
      { title: 'Pick one', kind: 'decide', target: 1 },
    ]);
    s.upsertOption(nb.id, { title: 'Controller, Acme', by: 'x', data: { salary: 200000 } });
    s.decide(nb.id, 'Took Acme.');

    const t = s.saveTemplate('  Job   search ', nb.id, '2026-10-15T00:00:00Z');
    expect(t).toMatchObject({ id: 'job-search', name: 'Job search', description: '2 fields · 4 steps · 2 checks · 2 limits', fromNotebook: nb.id, uses: 0 });
    expect(t.setup).toMatchObject({
      statement: 'Austin or remote',
      params: ['Remote or Austin, TX', '$180k minimum comp'],
      criteria: ['At least five open roles that fit', 'A decision recorded'],
      checks: ['Pays at least $200k', 'Posting is still open'],
      stages: ['Found', 'Applied', 'Offer'],
    });
    expect(t.setup.fields.map((f) => f.key)).toEqual(['salary', 'posting_url']);
    expect(t.setup.steps).toEqual([
      { id: 's1', title: 'Find 5 roles', kind: 'find', target: 5, status: 'todo', tries: 0 },
      { id: 's2', title: 'Source pay', kind: 'source', agentId: 'listing-page-facts', facts: ['salary'], status: 'todo', tries: 0 },
      { id: 's3', title: 'Check pay and scope', kind: 'check', status: 'todo', tries: 0 },
      { id: 's4', title: 'Pick one', kind: 'decide', target: 1, status: 'todo', tries: 0 },
    ]);
    expect(JSON.stringify(t.setup)).not.toContain('Acme');

    // The same name again replaces it; uses count; delete.
    s.saveTemplate('Job search', nb.id);
    expect(s.listTemplates()).toHaveLength(1);
    s.saveTemplate('Car search', nb.id);
    s.markTemplateUsed('car-search');
    expect(s.listTemplates().map((x) => x.id)).toEqual(['car-search', 'job-search']);
    expect(s.getTemplate('car-search')).toMatchObject({ uses: 1 });
    // Archived: kept, not listed (unless asked), and saving the same name again restores it.
    expect(s.archiveTemplate('job-search')).toBe(true);
    expect(s.listTemplates().map((x) => x.id)).toEqual(['car-search']);
    expect(s.listTemplates(50, { archived: 'only' }).map((x) => x.id)).toEqual(['job-search']);
    expect(s.listTemplates(50, { archived: 'include' })).toHaveLength(2);
    expect(s.getTemplate('job-search')!.archivedAt).toBeTruthy();
    s.saveTemplate('Job search', nb.id);
    expect(s.getTemplate('job-search')!.archivedAt).toBeUndefined();
    s.archiveTemplate('job-search');
    expect(s.archiveTemplate('job-search', false)).toBe(true);
    expect(s.listTemplates()).toHaveLength(2);
    expect(s.deleteTemplate('car-search')).toBe(true);
    expect(s.getTemplate('car-search')).toBeUndefined();
    expect(() => s.saveTemplate('  ', nb.id)).toThrow('A template needs a name.');
  });
});

describe('template subjects', () => {
  it('swap the subject for {subject}, fill it back, guess it from the title, and clip on words', () => {
    expect(subjectOut("Dana Reyes's newsletter, and dana  reyes again; not DanaReyesson", 'Dana Reyes')).toBe("{subject}'s newsletter, and {subject} again; not DanaReyesson");
    expect(fillSubject('Evidence relates to {subject}, not {subject}’s namesake', 'Acme Corp')).toBe('Evidence relates to Acme Corp, not Acme Corp’s namesake');
    expect(fillSubject('Who is {subject}?', '  ')).toBe('Who is {subject}?');
    expect(templateSubjectGuess({ title: 'Prepare for meeting with Dana Reyes', params: ['Dana Reyes', 'LinkedIn profile provided', 'upcoming meeting'] })).toBe('Dana Reyes');
    expect(templateSubjectGuess({ title: 'Find a used car', params: ['Under $15k'] })).toBe('');
    expect(clipWords('Evidence relates to Dana Reyes, not someone with a similar name', 60)).toBe('Evidence relates to Dana Reyes, not someone with a similar');
    expect(clipWords('short one', 60)).toBe('short one');
  });

  it('keep a check whole up to 120 characters', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Prepare for meeting with Dana Reyes' });
    const check = 'Evidence relates to Dana Reyes, not someone with a similar name';
    expect(s.setChecks(nb.id, [check]).checks).toEqual([check]);
    expect(s.setChecks(nb.id, ['word '.repeat(40)]).checks[0].length).toBeLessThanOrEqual(120);
    expect(s.setChecks(nb.id, ['word '.repeat(40)]).checks[0].endsWith('word')).toBe(true);
  });
});

describe('who a notebook is about', () => {
  it('merges what\'s learned: a later sighting of a fact wins, others stay, and what\'s found leaves "not found"', async () => {
    const { mergeAbout } = await import('./notebooks.js');
    const a = mergeAbout(undefined, { name: 'Dana Reyes', facts: [{ key: 'role', label: 'Role', value: 'VP Ops', source: 'https://example.com/a' }, { key: 'Bad Key', value: 'x' }, { key: 'location', value: '' }], notFound: ['Based in', 'Company'] }, '2026-10-01T00:00:00Z');
    expect(a).toEqual({ name: 'Dana Reyes', facts: [{ key: 'role', label: 'Role', value: 'VP Ops', source: 'https://example.com/a', at: '2026-10-01T00:00:00Z' }], notFound: ['Based in', 'Company'], updatedAt: '2026-10-01T00:00:00Z' });
    const b = mergeAbout(a, { facts: [{ key: 'role', label: 'Role', value: 'COO', source: 'javascript:alert(1)' }, { key: 'location', label: 'Based in', value: 'Austin' }] }, '2026-10-02T00:00:00Z');
    expect(b.name).toBe('Dana Reyes');
    expect(b.facts.map((f) => [f.key, f.value, f.source ?? ''])).toEqual([['role', 'COO', ''], ['location', 'Austin', '']]);
    expect(b.notFound).toEqual(['Company']);
  });

  it('keeps it with the notebook, gives a profile step its subject and progress, and leaves it out of the options\' funnel', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Prepare for a call with Dana Reyes' });
    s.setSteps(nb.id, [
      { title: 'Learn about Dana Reyes', kind: 'profile', subject: '  Dana   Reyes ', target: 9 },
      { title: 'Find 5 themes', kind: 'find', target: 5, subject: 'ignored' },
      { title: 'Choose', kind: 'decide', target: 2 },
    ]);
    const steps = s.get(nb.id)!.steps!;
    expect(steps.map((x) => [x.kind, x.subject ?? '', x.target ?? ''])).toEqual([['profile', 'Dana Reyes', ''], ['find', '', 5], ['decide', '', 2]]);
    expect(stepProgress(s.get(nb.id)!, [], steps[0])).toEqual({ met: false, have: 0, want: 4, missing: ['who they are'] });
    s.setAbout(nb.id, 'person', { name: 'Dana Reyes', facts: [{ key: 'role', value: 'VP Ops' }, { key: 'location', value: 'Austin' }], notFound: ['Company'] });
    expect(stepProgress(s.get(nb.id)!, [], steps[0])).toMatchObject({ met: false, have: 2, missing: ['Company'] });
    s.setAbout(nb.id, 'company', { name: 'Northwind', facts: [{ key: 'size', value: '200' }, { key: 'founded', value: '2015' }] });
    expect(stepProgress(s.get(nb.id)!, [], steps[0])).toMatchObject({ met: true, have: 4, want: 4 });
    // The funnel is the options' steps only.
    s.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }]);
    s.upsertOption(nb.id, { title: 'Ops at scale', by: 'agent:x', data: { theme: 'ops' } });
    expect(notebookViewData(s.get(nb.id)!, s.entries(nb.id)).notebook.funnel.map((f) => f.stage)).toEqual(['Found', 'Chosen']);
    // Its picture, kept and cleared with it.
    s.saveAboutPhoto(nb.id, 'person', 'https://example.com/dana.jpg', { contentType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }, 'photo');
    expect(s.aboutPhotos(nb.id)).toEqual(new Set(['person']));
    expect(s.aboutPhoto(nb.id, 'person')).toMatchObject({ contentType: 'image/jpeg', kind: 'photo', sourceUrl: 'https://example.com/dana.jpg' });
    s.delete(nb.id);
    expect(s.aboutPhotos(nb.id).size).toBe(0);
  });
});

describe('the meeting a notebook prepares for', () => {
  it('keeps a real date (or date and time), your goal and notes; nothing left is nothing', () => {
    expect(cleanMeeting({ when: '2026-10-29T14:00', goal: '  Explore a partnership  ', notes: 'Met at a conference' })).toEqual({ when: '2026-10-29T14:00', goal: 'Explore a partnership', notes: 'Met at a conference' });
    expect(cleanMeeting({ when: '2026-10-29 09:30' })).toEqual({ when: '2026-10-29T09:30' });
    expect(cleanMeeting({ when: 'next Thursday', goal: 'Pitch' })).toEqual({ goal: 'Pitch' });
    expect(cleanMeeting({ when: '2026-13-40' })).toBeUndefined();
    expect(cleanMeeting({ goal: '', notes: '  ' })).toBeUndefined();
    expect(cleanMeeting('nope')).toBeUndefined();
  });

  it('a meeting notebook: the meeting briefing page, a write step for talking points, or a meeting already', () => {
    expect(isMeetingNotebook({ layout: { preset: 'dossier', components: [] } })).toBe(true);
    expect(isMeetingNotebook({ steps: [{ id: 's1', title: 'Write the talking points', kind: 'write', status: 'todo', tries: 0 }] })).toBe(true);
    expect(isMeetingNotebook({ steps: [{ id: 's1', title: 'Write the answer', kind: 'write', shape: 'answer', status: 'todo', tries: 0 }] })).toBe(false);
    expect(isMeetingNotebook({ meeting: { goal: 'x' } })).toBe(true);
    expect(isMeetingNotebook({})).toBe(false);
  });
});

describe('an answer a write step wrote', () => {
  it('keeps an answer with its findings resting only on options the notebook has', () => {
    const ids = new Set(['o1', 'o2']);
    const a = cleanAnswer({ answer: '  About **$30** a seat. ', confidence: 'MEDIUM', basis: 'Two sources agree.', findings: [{ text: 'Vendor says $25', from: ['o1', 'ghost'] }, 'Survey says $20–40', { text: '' }], open: ['Annual plans?', ''] }, ids, 'What do teams pay?', 'notebook-writer', '2026-10-26T00:00:00Z');
    expect(a).toEqual({ question: 'What do teams pay?', text: 'About **$30** a seat.', confidence: 'medium', basis: 'Two sources agree.', findings: [{ text: 'Vendor says $25', from: ['o1'] }, { text: 'Survey says $20–40', from: [] }], open: ['Annual plans?'], at: '2026-10-26T00:00:00Z', by: 'notebook-writer' });
    // No answer, no keeping; an unknown confidence is low.
    expect(cleanAnswer({ findings: ['x'] }, ids, 'q', 'w')).toBeUndefined();
    expect(cleanAnswer({ answer: 'Yes.', confidence: 'certain' }, ids, 'q', 'w')!.confidence).toBe('low');
  });

  it('a write step keeps shape "answer" or "plan"; other steps never have one', () => {
    const steps = cleanSteps([{ title: 'Write the answer', kind: 'write', shape: 'answer' }, { title: 'Find', kind: 'find', shape: 'answer' }, { title: 'Write points', kind: 'write', shape: 'poem' }, { title: 'Write the plan', kind: 'write', shape: 'plan' }]);
    expect(steps.map((x) => x.shape)).toEqual(['answer', undefined, undefined, 'plan']);
  });

  it('keeps a plan in its order, a missing day joining the one before, using only options the notebook has', () => {
    const p = cleanPlan({ summary: ' Two easy days. ', items: [{ when: 'Day 1', title: 'Castle', from: ['o1', 'ghost'] }, { title: 'Dinner', detail: 'Book ahead' }, { when: 'Day 2', title: '' }, { when: 'Day 2', what: 'Sintra' }], before: ['Book dinner', ''], open: ['Which palace?'] }, new Set(['o1']), 'notebook-writer', '2026-10-26T00:00:00Z');
    expect(p).toEqual({ summary: 'Two easy days.', items: [{ when: 'Day 1', title: 'Castle', from: ['o1'] }, { when: 'Day 1', title: 'Dinner', detail: 'Book ahead', from: [] }, { when: 'Day 2', title: 'Sintra', from: [] }], before: ['Book dinner'], open: ['Which palace?'], at: '2026-10-26T00:00:00Z', by: 'notebook-writer' });
    expect(cleanPlan({ summary: 'Nothing in it', items: [] }, new Set(), 'w')).toBeUndefined();
  });
});

describe('a notebook\'s steps and page, changed later', () => {
  it('keeps why a step came out short while it is stuck or moved on from, and drops it when it runs again', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Buy a wagon' });
    s.setSteps(nb.id, [{ title: 'Find 5 wagons', kind: 'find', target: 5 }]);
    const why = 'Its last search looked at Craigslist and OfferUp: neither had a match.';
    s.updateStep(nb.id, 's1', { status: 'stuck', stalled: true, why });
    expect(s.get(nb.id)!.steps![0]).toMatchObject({ status: 'stuck', why });
    // Moving on keeps it (the step says why it was left short).
    s.updateStep(nb.id, 's1', { status: 'done', movedOn: true });
    expect(s.get(nb.id)!.steps![0]).toMatchObject({ status: 'done', movedOn: true, why });
    // Running again drops it, and a step that met its goal never has one.
    s.updateStep(nb.id, 's1', { status: 'running' });
    expect(s.get(nb.id)!.steps![0].why).toBeUndefined();
    s.setSteps(nb.id, [{ ...s.get(nb.id)!.steps![0], status: 'met', why: 'left over' }]);
    expect(s.get(nb.id)!.steps![0].why).toBeUndefined();
  });

  it('adds a step in front without renumbering the others, and says who set the page last', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Prepare for a call' });
    s.setSteps(nb.id, [{ title: 'Find 5 themes', kind: 'find', target: 5 }, { title: 'Choose', kind: 'decide', target: 2 }]);
    s.updateStep(nb.id, 's1', { status: 'done' });
    s.setSteps(nb.id, [{ title: 'Learn about Dana', kind: 'profile' }, ...s.get(nb.id)!.steps!]);
    expect(s.get(nb.id)!.steps!.map((x) => `${x.id}:${x.kind}:${x.status}`)).toEqual(['s3:profile:todo', 's1:find:done', 's2:decide:todo']);

    const page = { components: [{ id: 'root', component: 'Column', children: ['c'] }, { id: 'c', component: 'Callout', text: 'x' }] };
    expect(s.get(nb.id)!.layoutBy).toBeUndefined();
    s.setLayout(nb.id, page, 'notebook');
    expect(s.get(nb.id)!.layoutBy).toBe('notebook');
    s.undoLayout(nb.id);
    expect(s.get(nb.id)).toMatchObject({ layoutBy: 'you' });
    expect(s.get(nb.id)!.layout).toBeUndefined();
  });
});

describe('a write step (the talking points)', () => {
  it('keeps points that rest on the notebook\'s own options, and is met with enough of them', async () => {
    const { cleanBriefing, stepProgress, optionSteps, NotebookStore: Store } = await import('./notebooks.js');
    const ids = new Set(['a', 'b']);
    const b = cleanBriefing({
      points: [
        { text: '  Ask how they decide   what stays human ', why: 'She writes her first drafts herself.', ask: 'What do you never hand to AI?', from: ['a', 'zzz', 'a'] },
        { point: 'Small campaigns', from: ['b'] },
        { text: '' },
        'A plain one',
      ],
      questions: ['Which signals do you trust?', 7, ''], watch: ['Don\'t assume they use AI for everything'],
    }, ids, 'notebook-writer', '2026-10-25T00:00:00Z');
    expect(b).toEqual({
      points: [
        { text: 'Ask how they decide what stays human', why: 'She writes her first drafts herself.', ask: 'What do you never hand to AI?', from: ['a'] },
        { text: 'Small campaigns', from: ['b'] },
        { text: 'A plain one', from: [] },
      ],
      questions: ['Which signals do you trust?'], watch: ['Don\'t assume they use AI for everything'], at: '2026-10-25T00:00:00Z', by: 'notebook-writer',
    });
    const long = cleanBriefing({ points: [{ text: 'x' }], watch: [`${'word '.repeat(80)}end`] }, ids, 'x')!;
    expect(long.watch[0].endsWith('word…')).toBe(true);
    expect(long.watch[0].length).toBeLessThanOrEqual(320);
    expect(cleanBriefing({ points: [] }, ids, 'x')).toBeUndefined();
    expect(cleanBriefing('nope', ids, 'x')).toBeUndefined();

    const dir = mkdtempSync(join(tmpdir(), 'sua-nb-write-'));
    const runs = new RunStore(join(dir, 'runs.db'));
    try {
      const s = Store.fromHandle(runs.databaseHandle());
      const nb = s.create({ title: 'Meet Dana' });
      s.setSteps(nb.id, [{ title: 'Find what she said', kind: 'find', target: 2 }, { title: 'Write the talking points', kind: 'write', target: 3 }]);
      const step = s.get(nb.id)!.steps![1];
      expect(step.target).toBe(3);
      expect(optionSteps(s.get(nb.id)!.steps!).map((x) => x.kind)).toEqual(['find']);
      expect(stepProgress(s.get(nb.id)!, [], step)).toEqual({ met: false, have: 0, want: 3, missing: ['the talking points'] });
      s.setBriefing(nb.id, b);
      expect(s.get(nb.id)!.briefing!.points).toHaveLength(3);
      expect(stepProgress(s.get(nb.id)!, [], step)).toMatchObject({ met: true, have: 3, want: 3 });
      s.setBriefing(nb.id, undefined);
      expect(s.get(nb.id)!.briefing).toBeUndefined();
    } finally { runs.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
