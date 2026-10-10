import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore,
  AgentStore,
  DashboardsStore,
  LocalProvider,
  MemorySecretsStore,
  PacksStore,
  RunStore,
  buildLoopbackAllowlist,
  loadAgents,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3998;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let suggesterSaw = '';
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp(opts: { schedule?: string; allowHighFrequency?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-route-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  packsStore = new PacksStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  agentStore.createAgent({
    id: 'sched-agent',
    name: 'Sched Agent',
    status: 'active',
    source: 'local',
    mcp: false,
    schedule: opts.schedule,
    allowHighFrequency: opts.allowHighFrequency,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
  }, 'cli');

  const ctx: DashboardContext = {
    token: TOKEN,
    allowlist: buildLoopbackAllowlist(PORT),
    port: PORT,
    provider,
    runStore,
    agentStore,
    loadAgents: () => loadAgents({ directories: [agentsDir] }),
    secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }),
    tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30,
    dbPath,
    secretsPath: join(dir, 'secrets.enc'),
    rotateToken: () => 'r'.repeat(64),
    packsStore,
    dashboardsStore,
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
    inboxStore: InboxStore.fromHandle(runStore.databaseHandle()),
    // Never a real model in tests: setup gets a fixed keeper answer.
    // Never a real picture model either.
    notebookPictureRun: async () => undefined,
    // (only "staff role" notebooks get set up, so other tests keep the card layout).
    // The drafter answers with a fixed draft (its CHANGE, when given, lands in the title).
    notebookDrafterRun: async (inputs) => `<draft>${JSON.stringify({
      title: inputs.CHANGE ? `Headphones (${inputs.CHANGE})` : 'Pick noise-cancelling headphones',
      statement: 'For flights, under $300.', params: ['under $300', 'over-ear', 'under $300'], criteria: ['One pair that fits', 'A decision recorded by Oct 20'],
      fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'rating', label: 'Rating', type: 'number', role: 'measure', better: 'higher' }, { key: 'bad key!', label: 'x' }],
      checks: ['Comfortable with glasses'], stages: ['Found', 'Shortlist', 'Bought'], pipeline: ['sched-agent', 'made-up-agent'], cadence: 'every morning', why: 'Assumed over-ear.',
    })}</draft>`,
    // The suggester sees your conversations (kept for the test to read) and answers with fixed pills.
    notebookSuggesterRun: async (inputs) => { suggesterSaw = inputs.CONVERSATIONS; return `<suggestions>${JSON.stringify([
      { label: 'Tires for the RAV4', text: 'Good tires for my 2012 RAV4, wet and dry', from: 'tires?' },
      { label: 'tires for the rav4', text: 'a duplicate label' },
      { label: 'Remote AI PM job', text: 'A remote senior AI PM job over $200k' },
      { label: '', text: 'no label' },
      { label: 'Rental', text: 'A 2-bed rental' }, { label: 'Fourth', text: 'one too many' },
    ])}</suggestions>`; },
    // A test run whose output is already a keeper answer is kept as-is.
    notebookKeeperRun: async (inputs) => inputs.RUN_OUTPUT.startsWith('<notebook>') ? inputs.RUN_OUTPUT : (inputs.SOURCE_AGENT === 'notebook-setup' && /staff role/i.test(inputs.NOTEBOOK)
      ? `<notebook>${JSON.stringify({ entries: [], fields: [{ key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher', range: true }, { key: 'company', label: 'Company', type: 'text', role: 'org' }], stages: ['Found', 'Applied', 'Offer'] })}</notebook>`
      : undefined),
  };

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  if (provider) {
    const start = Date.now();
    while ((provider as unknown as { running?: { size: number } }).running?.size && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await provider.shutdown();
  }
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { packsStore?.close(); } catch { /* ignore */ }
  try { dashboardsStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});


describe('notebooks pages', () => {
  const post = (app: Awaited<ReturnType<typeof makeApp>>, path: string, body: Record<string, string>) => request(app).post(path)
    .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);

  it('starts a notebook, shows its cover, adds entries, ticks criteria, decides', async () => {
    const app = await makeApp();
    const empty = await get(app, '/notebooks');
    expect(empty.text).toContain('+ New notebook');
    expect(empty.text).toContain('class="btn btn--primary nbl-new__btn" href="/notebooks/new"');

    const made = await post(app, '/notebooks', { title: 'Buy a used car', statement: 'Find a reliable SUV', params: 'AWD\nunder $26k', criteria: 'One fits\nClean history\nDecided' });
    expect(made.status).toBe(303);
    expect(made.headers.location).toMatch(/^\/notebooks\/buy-a-used-car\?flash=/);

    await post(app, '/notebooks/buy-a-used-car/edit', { title: 'Buy a used car', statement: 'Find a reliable SUV', params: 'AWD\nunder $26k', criteria: 'One fits\nClean history\nDecided', pipeline: 'sched-agent\nnot-there', cadence: '0 7 * * *' });
    const bad = await post(app, '/notebooks/buy-a-used-car/edit', { title: 'x', cadence: 'every day' });
    expect(decodeURIComponent(bad.headers.location)).toContain("isn't a schedule sua understands");

    await post(app, '/notebooks/buy-a-used-car/entries', { kind: 'option', title: '2019 RAV4 XLE', body: '54k mi, $24,900' });
    await post(app, '/notebooks/buy-a-used-car/criteria/0', { met: '1' });
    const page = await get(app, '/notebooks/buy-a-used-car');
    expect(page.status).toBe(200);
    expect(page.text).toContain('class="nb-hero"');
    expect(page.text).toContain('aria-label="1 of 3 criteria met"');
    expect(page.text).toContain('<span class="nb-chip">AWD</span>');
    expect(page.text).toContain('runs every day at 7:00 AM');
    expect(page.text).toMatch(/class="nb-pipe"[\s\S]*sched-agent \(not run yet\), not-there \(not installed\)/);
    expect(page.text).toContain('data-surface-region="options"');
    expect(page.text).toContain('2019 RAV4 XLE');

    await post(app, '/notebooks/buy-a-used-car/decide', { decision: 'Buy the RAV4' });
    const done = await get(app, '/notebooks/buy-a-used-car');
    expect(done.text).toContain('nb-status--decided');
    expect(done.text).toContain('Buy the RAV4');
    expect(done.text).toContain('>Reopen</button>');
    expect((await get(app, '/notebooks?status=decided')).text).toContain('Buy the RAV4');
    expect((await get(app, '/notebooks/nope')).status).toBe(303);
  });

  it('Home\'s Notebooks line', async () => {
    await makeApp();
    const { renderHomeNotebooksLine } = await import('../views/notebooks.js');
    const { render } = await import('../views/html.js');
    expect(render(renderHomeNotebooksLine(0, 0))).toContain('>Notebooks</a>');
    expect(render(renderHomeNotebooksLine(2, 3))).toContain('>2 notebooks</a>');
    expect(render(renderHomeNotebooksLine(1, 1))).toContain('href="/notebooks/new" class="home-notebooks__new" aria-label="New notebook">+ New');
  });
});

describe('notebook pipeline (G2–G3)', () => {
  it('the keeper sets fields once, records option facts, and refreshes an option found again', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Buy a used commuter car' });
    const block = (o: unknown) => `<notebook>${JSON.stringify(o)}</notebook>`;
    const fields = [
      { key: 'price', label: 'Price', type: 'money', role: 'price' },
      { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' },
      { key: 'listing_url', label: 'Listing', type: 'url', role: 'link' },
    ];
    const rav4 = { kind: 'option', title: '2010 Toyota RAV4 Sport 4WD', body: 'Best fit.', data: { price: 4023, miles: 149652, listing_url: 'https://www.cargurus.com/l/123' } };

    const first = applyKeeperResult(store, nb, 'sweep', 'run-1', block({ fields, entries: [rav4, { kind: 'note', title: 'Edmunds blocked page reads' }] }));
    expect(first).toMatchObject({ added: 2, skipped: 0 });
    expect(store.get(nb.id)!.fields.map((f) => f.key)).toEqual(['price', 'miles', 'listing_url']);

    // Next run: the same car, cheaper, reworded; and a keeper that tries to change the fields.
    const second = applyKeeperResult(store, store.get(nb.id)!, 'sweep', 'run-2', block({
      fields: [{ key: 'rent', type: 'money' }],
      entries: [{ ...rav4, title: 'RAV4 Sport, Lynnwood', data: { price: '$3,900', listing_url: 'https://cargurus.com/l/123/' } }],
    }));
    expect(second).toMatchObject({ added: 0, refreshed: 1 });
    expect(store.get(nb.id)!.fields.map((f) => f.key)).toEqual(['price', 'miles', 'listing_url']);
    const options = store.entries(nb.id).filter((e) => e.kind === 'option');
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ title: '2010 Toyota RAV4 Sport 4WD', runId: 'run-2', data: { price: 3900, miles: 149652 } });
    // Facts the keeper gives with a source or as an estimate keep that; the same option is still found.
    const third = applyKeeperResult(store, store.get(nb.id)!, 'sweep', 'run-3', block({
      entries: [{ ...rav4, data: { price: { value: 3850, source: 'https://www.cargurus.com/l/123/history' }, miles: { value: 150000, estimate: true }, listing_url: 'https://www.cargurus.com/l/123' } }],
    }));
    expect(third).toMatchObject({ added: 0, refreshed: 1 });
    const kept = store.entries(nb.id).find((e) => e.kind === 'option')!;
    expect(kept.data).toMatchObject({ price: 3850, miles: 150000 });
    expect(kept.factMeta).toEqual({ price: { source: 'https://www.cargurus.com/l/123/history' }, miles: { estimate: true } });
  });

  it('the keeper adds new entries with provenance, skips what the notebook has, and ticks criteria with a reason', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult, pipelineInputs, notebookBrief } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Buy a used car', statement: 'Find a reliable SUV', params: ['AWD'], criteria: ['One fits', 'Clean history'] });
    store.addEntry(nb.id, { kind: 'option', title: '2019 RAV4 XLE, 54k mi', by: 'you' });

    const raw = `Here you go.\n<notebook>${JSON.stringify({
      entries: [
        { kind: 'option', title: '2019 RAV4 XLE — 54k mi!', body: 'dup, reworded punctuation' },
        { kind: 'option', title: '2020 Mazda CX-5 Touring, 38k mi, $23,400', body: 'one owner' },
        { kind: 'evidence', title: 'Carfax: CX-5 clean' },
        { kind: 'gossip', title: 'nope' },
      ],
      criteriaMet: [{ index: 0, why: 'The CX-5 fits every parameter.' }, { index: 7, why: 'no such' }],
      summary: 'One new option and its history.',
    })}</notebook>`;
    const out = applyKeeperResult(store, nb, 'listings-search', 'run-abc', raw);
    expect(out).toEqual({ added: 2, skipped: 2, criteriaMet: 1, summary: 'One new option and its history.' });
    const entries = store.entries(nb.id);
    expect(entries.find((e) => e.title.startsWith('2020 Mazda'))).toMatchObject({ by: 'agent:listings-search', runId: 'run-abc' });
    expect(entries.find((e) => e.title === 'Met: One fits')).toMatchObject({ kind: 'note', body: 'The CX-5 fits every parameter.' });
    expect(store.get(nb.id)!.criteria[0].met).toBe(true);
    expect(applyKeeperResult(store, nb, 'x', 'r', 'no block here').error).toContain('no <notebook> block');

    expect(pipelineInputs({ inputs: { GOAL: { type: 'string' }, topic: { type: 'string' }, LIMIT: { type: 'number' } } } as never, nb))
      .toEqual({ GOAL: notebookBrief(nb), topic: 'Find a reliable SUV' });
    expect(notebookBrief(nb)).toBe('Find a reliable SUV\nParameters: AWD\nDone when: One fits; Clean history');
    // An agent that files directly gets the notebook's field keys and roles.
    const withFields = store.setFields(nb.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    expect(JSON.parse(pipelineInputs({ inputs: { FIELDS: { type: 'string' } } } as never, withFields).FIELDS))
      .toEqual([{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
  });

  it('runs from the page: refuses without agents, runs once at a time, and records what happened', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    await post('/notebooks', { title: 'Car' });
    expect(decodeURIComponent((await post('/notebooks/car/run')).headers.location)).toContain('Add agents to the pipeline under Edit first');
    await post('/notebooks/car/edit', { title: 'Car', pipeline: 'not-there' });
    expect(decodeURIComponent((await post('/notebooks/car/run')).headers.location)).toContain('Running the pipeline');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    for (let i = 0; i < 50 && !store.get('car')!.lastRunAt; i++) await new Promise((r) => setTimeout(r, 20));
    expect(store.get('car')!.lastRunNote).toBe('0 new entries · not-there: not installed');
    const page = await request(app).get('/notebooks/car').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(page.text).toContain('Run the pipeline now');
    expect(page.text).toMatch(/Last run .*0 new entries · not-there: not installed/);
    await post('/notebooks/car/decide', { decision: 'done' });
    expect(decodeURIComponent((await post('/notebooks/car/run')).headers.location)).toContain('Reopen the notebook');
  });
});

describe('the talk box follows the notebook', () => {
  it('suggests the next useful thing to tell sua, step by step', async () => {
    await makeApp();
    const { nextStep } = await import('../views/notebooks.js');
    const base = { id: 'car', title: 'Buy a used commuter car', statement: '', params: [] as string[], criteria: [{ text: 'clean title', met: false }], pipeline: [] as string[], fields: [], stages: [] as string[], checks: [] as string[], cadence: '', status: 'active' as const, createdAt: '', updatedAt: '' };
    const opt = { id: 'e1', notebookId: 'car', kind: 'option' as const, title: '2011 Subaru Forester, 150k, $7,200', body: '', by: 'sua', createdAt: '' };
    expect(nextStep(base, []).placeholder).toContain('what "Buy a used commuter car" is for');
    const withWhy = { ...base, statement: 'Find a reliable car for a new driver.' };
    expect(nextStep(withWhy, []).hint).toBe('Next: your limits (budget, must-haves, deal-breakers).');
    expect(nextStep(withWhy, []).placeholder).toBe('e.g. a budget, the must-haves, the deal-breakers, and where to look');
    const limited = { ...withWhy, params: ['AWD'] };
    expect(nextStep(limited, []).hint).toContain('candidates');
    expect(nextStep(limited, [opt]).hint).toBe('1 option so far. sua can keep looking for you.');
    const piped = { ...limited, pipeline: ['craigslist-car-search'] };
    expect(nextStep(piped, [opt])).toEqual({ hint: 'Next: “clean title”.', placeholder: 'e.g. what you know about “clean title” for the 2011 Subaru Forester, 150k, $7,200' });
    const met = { ...piped, criteria: [{ text: 'clean title', met: true }] };
    expect(nextStep(met, [opt]).hint).toBe('Every criterion is met. Ready to decide?');
    expect(nextStep({ ...met, status: 'decided' }, [opt]).hint).toContain('Decided');
  });
});

describe('the funnel on the page and in the conversation', () => {
  it('moves, rules out and brings back from the page; the page shows the funnel', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    await post('/notebooks', { title: 'Car' });
    await post('/notebooks/car/edit', { title: 'Car', stages: 'Found\nChecked\nTest drive' });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const rav4 = store.upsertOption('car', { title: '2010 RAV4', by: 'you' }).entry;
    const xt = store.upsertOption('car', { title: '2009 Forester XT', by: 'you' }).entry;

    expect(decodeURIComponent((await post(`/notebooks/car/entries/${rav4.id}/stage`, { stage: 'Checked' })).headers.location)).toContain('2010 RAV4 → Checked');
    expect(decodeURIComponent((await post(`/notebooks/car/entries/${rav4.id}/stage`, { stage: 'Bought' })).headers.location)).toContain("isn't one of this notebook's stages");
    expect(decodeURIComponent((await post(`/notebooks/car/entries/${xt.id}/rule-out`, { quick: 'Too expensive', reason: '' })).headers.location)).toContain("Searches won't suggest it again");
    expect(store.findOption('car', 'XT')?.ruledOut).toMatchObject({ reason: 'Too expensive', by: 'you', stage: 'Found' });

    const page = await request(app).get('/notebooks/car').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(page.text).toContain('class="nb-funnel"');
    expect(page.text).toContain('Ruled out at Found: Too expensive');
    expect(page.text).toContain('Move to Test drive →');
    expect(page.text.indexOf('2010 RAV4')).toBeLessThan(page.text.indexOf('2009 Forester XT')); // ruled out sinks

    await post(`/notebooks/car/entries/${xt.id}/reinstate`);
    expect(store.findOption('car', 'XT')?.ruledOut).toBeUndefined();
  });

  it('sua rules out, moves, brings back and ticks criteria by name, and says what it couldn\'t find', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { parseNotebookAdd, applyNotebookAdd } = await import('../lib/notebook-chat.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Staff role', criteria: ['An offer in hand', 'Decided by Nov'] });
    store.setStages(nb.id, ['Found', 'Applied', 'Interview', 'Offer']);
    for (const t of ['Staff Engineer, Stripe', 'Staff Engineer, Plaid', 'Staff Engineer, Ramp']) store.upsertOption(nb.id, { title: t, by: 'agent:jobs' });

    const { add, error } = parseNotebookAdd(JSON.stringify({
      moves: [{ option: 'Stripe', stage: 'Interview' }, { option: 'Ramp', stage: 'Hired' }],
      ruleOut: [{ option: 'plaid', reason: 'no callback' }, { option: 'Brex', reason: 'x' }],
      met: ['offer in hand', 'a pony'],
    }));
    expect(error).toBeUndefined();
    const { added } = applyNotebookAdd(store, nb.id, add!, 'sua');
    expect(added).toEqual([
      'moved: Staff Engineer, Stripe → Interview',
      expect.stringContaining('"Hired" isn\'t one of this notebook\'s stages'),
      'ruled out: Staff Engineer, Plaid (no callback)',
      'couldn\'t find an option matching "Brex"',
      'met: An offer in hand',
      'couldn\'t find a done-when matching "a pony"',
    ]);
    expect(store.findOption(nb.id, 'Plaid')?.ruledOut).toMatchObject({ reason: 'no callback', by: 'sua', stage: 'Found' });
    expect(applyNotebookAdd(store, nb.id, parseNotebookAdd(JSON.stringify({ reinstate: ['Plaid'] })).add!).added).toEqual(['brought back: Staff Engineer, Plaid']);
    expect(parseNotebookAdd('{}').error).toBe('Nothing to add.');
  });
});

describe('notebook photos', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

  it('keeps photos from the image field or a matching listing page, and remembers what failed', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { keepPhotos } = await import('../lib/notebook-photos.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Car' }).id, [
      { key: 'photo', label: 'Photo', type: 'image', role: 'image' },
      { key: 'url', label: 'Listing', type: 'url', role: 'link' },
    ]);
    const add = (title: string, data: Record<string, string>) => store.upsertOption(nb.id, { title, by: 'agent:x', data }).entry;
    const given = add('2010 Toyota RAV4 Sport', { photo: 'https://img.example/rav4.jpg' });
    const listing = add('2009 Subaru Forester 2.5X', { url: 'https://www.autotrader.com/cars-for-sale/inventory/700000001' });
    const results = add('2007 Subaru Forester', { url: 'https://www.cargurus.com/Cars/l-Used-Subaru-Forester-Seattle-c8308' });
    const wrongCar = add('2006 Subaru Forester 2.5X', { url: 'https://www.autotrader.com/cars-for-sale/inventory/772291286' });
    const fetched: string[] = [];
    const deps = {
      fetchImage: async (u: string) => { fetched.push(u); if (u.includes('broken')) throw new Error('HTTP 404'); return { bytes: JPEG, contentType: 'image/jpeg' }; },
      pagePreview: async (u: string) => (u.endsWith('700000001')
        ? { image: 'https://images.autotrader.com/forester-09.jpg', title: '2009 Subaru Forester 2.5X for sale in Seattle' }
        : { image: 'https://images.autotrader.com/other.jpg', title: '2014 Honda CR-V EX' }),
    };
    expect(await keepPhotos(store, nb.id, { deps })).toEqual({ kept: 2, tried: 4 });
    expect(fetched.sort()).toEqual(['https://images.autotrader.com/forester-09.jpg', 'https://img.example/rav4.jpg']);
    expect(store.hasPhoto(given.id) && store.hasPhoto(listing.id)).toBe(true);
    expect(store.hasPhoto(results.id) || store.hasPhoto(wrongCar.id)).toBe(false);
    // Tried once: not again.
    expect(await keepPhotos(store, nb.id, { deps })).toEqual({ kept: 0, tried: 0 });
  });

  it('serves a kept photo as an image only, and the card shows it', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Car' }).id, [{ key: 'photo', label: 'Photo', type: 'image', role: 'image' }]);
    const e = store.upsertOption(nb.id, { title: 'RAV4', by: 'agent:x', data: { photo: 'https://img.example/a.jpg' } }).entry;
    store.savePhoto(nb.id, e.id, 'https://img.example/a.jpg', { contentType: 'image/jpeg', bytes: JPEG });
    const res = await request(app).get(`/notebooks/car/entries/${e.id}/photo`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect((await request(app).get('/notebooks/car/entries/nope/photo').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).status).toBe(404);
    const page = await request(app).get('/notebooks/car').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    // With fields, options are drawn by the shortlist widget: the kept copy is its image.
    expect(page.text).toContain('data-a2ui-surface');
    expect(page.text).toContain(`"image":"/notebooks/car/entries/${e.id}/photo"`);
    expect(page.text).toContain('Get photos');
    // The header shows the notebook's picture, as the conversation card does.
    expect(page.text).toContain(`<img class="nb-hero__cover" src="/notebooks/car/entries/${e.id}/photo"`);
    const bare = store.create({ title: 'Bike' });
    const barePage = await request(app).get(`/notebooks/${bare.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(barePage.text).not.toContain('nb-hero__cover');
    expect(barePage.text).toContain('nb-hero__icon');
  });
});

describe('setting a notebook up', () => {
  it('a setup pass sets fields, stages and the facts of options already there, and records no search', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult, NOTEBOOK_SETUP } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Buy a used car' });
    const rav = store.addEntry(nb.id, { kind: 'option', title: '2010 RAV4, 149,652 mi, $4,023', body: 'https://cars.example/listing/123456', by: 'agent:old' });
    expect(store.needsSetup(nb.id)).toBe(true);
    const out = applyKeeperResult(store, nb, NOTEBOOK_SETUP, 'setup-1', `<notebook>${JSON.stringify({
      entries: [],
      fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' }, { key: 'url', label: 'Listing', type: 'url', role: 'link' }],
      stages: ['Found', 'Checked', 'Bought'],
      facts: [{ id: rav.id, data: { price: 4023, miles: 149652, url: 'https://cars.example/listing/123456' } }, { id: 'nope', data: { price: 1 } }],
    })}</notebook>`);
    expect(out).toMatchObject({ added: 0, factsSet: 1 });
    const after = store.get(nb.id)!;
    expect(after.fields.map((f) => f.key)).toEqual(['price', 'miles', 'url']);
    expect(after.stages).toEqual(['Found', 'Checked', 'Bought']);
    const e = store.findOption(nb.id, 'RAV4')!;
    expect(e).toMatchObject({ data: { price: 4023, miles: 149652 }, fingerprint: 'cars.example/listing/123456', stage: 'Found' });
    expect(store.missedSearches(nb.id, { by: 'agent:old', createdAt: '2000-01-01T00:00:00Z' })).toBe(0);
    expect(runStore.databaseHandle().prepare('SELECT COUNT(*) AS n FROM notebook_searches').get()).toMatchObject({ n: 0 });
    expect(store.needsSetup(nb.id)).toBe(false); // it has fields now
  });

  it('starts setup when a notebook is created and when an options-but-no-fields notebook is opened, once', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    expect(decodeURIComponent((await post('/notebooks', { title: 'Find a staff role' })).headers.location)).toContain('sua is setting up what to track');
    expect(store.get('find-a-staff-role')!.setupAt).toBeTruthy();

    const old = store.create({ title: 'Old car hunt' });
    store.addEntry(old.id, { kind: 'option', title: '2009 Forester', by: 'you' });
    expect(store.get(old.id)!.setupAt).toBeUndefined();
    await request(app).get(`/notebooks/${old.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(store.get(old.id)!.setupAt).toBeTruthy();
    expect(store.needsSetup(old.id)).toBe(false); // tried: a later visit doesn't try again
  });

  it('options sua files from conversation keep their facts once the notebook has fields', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { parseNotebookAdd, applyNotebookAdd } = await import('../lib/notebook-chat.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Car' });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' }]);
    const { add } = parseNotebookAdd(JSON.stringify({ entries: [
      { kind: 'option', title: '2011 Forester at the Ballard lot', body: 'saw it Saturday', data: { price: '$6,200', miles: 141000, color: 'blue' }, fingerprint: 'VIN JF2SH' },
      { kind: 'note', title: 'Wants heated seats', data: { price: 1 } },
    ] }));
    applyNotebookAdd(store, nb.id, add!, 'sua');
    expect(store.findOption(nb.id, 'Ballard')).toMatchObject({ data: { price: 6200, miles: 141000 }, fingerprint: 'vin jf2sh' });
    expect(store.entries(nb.id).find((e) => e.kind === 'note')!.data).toBeUndefined();
  });
});

describe('the notebooks list', () => {
  it('filters by status (active first), searches, sorts, pages, and shows each notebook\'s facts and cover', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(runStore.databaseHandle());
    for (let i = 1; i <= 14; i++) s.create({ title: `Notebook ${String(i).padStart(2, '0')}`, statement: i === 7 ? 'Find a staff role' : 'x' });
    const car = s.setFields(s.create({ title: 'Buy a used car', params: ['$3k-$5k budget'], criteria: ['One fits'] }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    const rav = s.upsertOption(car.id, { title: '2010 Toyota RAV4, 149,652 mi, $4,023', by: 'agent:x', data: { price: 4023 } }).entry;
    s.savePhoto(car.id, rav.id, 'https://img.example/r.jpg', { contentType: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]) }, { kind: 'representative' });
    s.decide(s.create({ title: 'Laptop' }).id, 'MacBook');

    const first = await get('/notebooks');
    expect(first.text).toContain('Active <span class="nb-tabs__n">15</span>');
    expect(first.text).toContain('Decided <span class="nb-tabs__n">1</span>');
    expect(first.text).not.toContain('>Laptop ');                 // active by default
    expect(first.text).toContain('1–12 of 15');
    expect(first.text).toContain('href="/notebooks?page=2"');
    expect((await get('/notebooks?page=2')).text).toContain('13–15 of 15');
    expect((await get('/notebooks?status=decided')).text).toContain('Laptop');
    const search = await get('/notebooks?q=staff');
    expect(search.text).toContain('Notebook 07');
    expect(search.text).not.toContain('Notebook 08');
    const carCard = await get('/notebooks?q=used%20car');
    expect(carCard.text).toContain('<span class="nbl-card__price">$4,023</span><span class="nbl-card__leadname">2010 Toyota RAV4</span>');
    expect(carCard.text).toContain('<span class="nbl-chip">1 option</span><span class="nbl-chip">1 in the running</span>');
    expect(carCard.text).toContain('<span class="nbl-card__done">0 of 1 done</span>');
    expect(carCard.text).toContain(`src="/notebooks/buy-a-used-car/entries/${rav.id}/photo"`);
    expect(carCard.text).toContain('example photo');
    // No picture yet: its own generated cover, with an icon for its kind.
    const plain = await get('/notebooks?q=Notebook%2001');
    expect(plain.text).toContain('class="nbl-card__art"');
    expect((await get('/notebooks?q=nothing-like-this')).text).toContain('No active notebooks matching');
  });
});

describe('sua greets a new notebook', () => {
  it('says what it set up and the first useful thing to tell it', async () => {
    await makeApp();
    const { notebookGreeting } = await import('../lib/notebook-chat.js');
    const nb = {
      id: 'car', title: 'Buy a used car', statement: 'A reliable car for a new driver.', params: [], pipeline: [], cadence: '', status: 'active' as const, createdAt: '', updatedAt: '', checks: [],
      criteria: [{ text: 'At least one car that fits', met: false }, { text: 'Clean title', met: false }],
      fields: [{ key: 'price', label: 'Price', type: 'money' as const, role: 'price' as const }, { key: 'miles', label: 'Miles', type: 'number' as const }, { key: 'photo', label: 'Photo', type: 'image' as const, role: 'image' as const }],
      stages: ['Found', 'Checked', 'Bought'],
    };
    const text = notebookGreeting(nb);
    expect(text.split('\n')[0]).toBe("I've started **Buy a used car**. What are your limits? Budget, must-haves, deal-breakers, and where to look.");
    expect(text).toContain("Here's how I'll keep it:");
    expect(text).toContain("I'll note its price and miles");
    expect(text).not.toContain('photo');
    expect(text).toContain('Found → Checked → Bought');
    expect(text).toContain('**Done when:** at least one car that fits; clean title.');
    expect(text).toContain('What are your limits? Budget, must-haves, deal-breakers, and where to look.');
    expect(notebookGreeting({ ...nb, params: ['AWD'] })).toContain("Tell me about any you've already seen, or ask me to search");
    expect(notebookGreeting({ ...nb, statement: '' })).toContain("What's this notebook for?");
  });

  it('posts it once, into the notebook\'s own conversation, after setup', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    await post('/notebooks', { title: 'Find a staff role', statement: 'Remote, product company' });
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    for (let i = 0; i < 200 && !store.get('find-a-staff-role')!.conversationId; i++) await new Promise((r) => setTimeout(r, 25));
    const nb = store.get('find-a-staff-role')!;
    expect(nb.conversationId).toBeTruthy();
    const inbox = InboxStore.fromHandle(runStore.databaseHandle());
    const thread = inbox.get(nb.conversationId!)!;
    expect(thread).toMatchObject({ title: 'Notebook: Find a staff role', status: 'awaiting_user' });
    const said = inbox.listResponses(thread.id);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ role: 'triage' });
    expect(said[0].body).toContain("I've started **Find a staff role**");
    // Talking to sua continues the same conversation.
    await post('/notebooks/find-a-staff-role/ask', { text: 'remote only' });
    expect(store.get('find-a-staff-role')!.conversationId).toBe(thread.id);
  });
});

describe("a notebook's conversation shows the notebook", () => {
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  it('as a card under the title: from the page it was started on, or the notebook it belongs to; not on other threads', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Guitar', criteria: ['Has a pickup'] }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    store.upsertOption(nb.id, { title: 'Ibanez Talman', by: 'agent:x', data: { price: 279.99 } });
    store.upsertOption(nb.id, { title: 'Yamaha FSX', by: 'agent:x', data: { price: 349 } });
    const inbox = InboxStore.fromHandle(runStore.databaseHandle());
    const fromPage = inbox.add({ priority: 'medium', source: 'manual', title: 'Notebook: Guitar', body: '(empty)',
      contextJson: JSON.stringify({ page: { kind: 'notebook', id: nb.id, path: `/notebooks/${nb.id}`, title: 'Guitar' } }) });
    let res = await get(app, `/inbox/${fromPage.id}/fragment`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`class="ib-notebook" href="/notebooks/${nb.id}"`);
    expect(res.text).toContain('2 options · 2 in the running · 0 of 1 done');
    expect(res.text).toContain('<strong>$279.99</strong> Ibanez Talman');

    const linked = inbox.add({ priority: 'medium', source: 'manual', title: 'About the guitar', body: '(empty)' });
    store.setConversation(nb.id, linked.id);
    expect((await get(app, `/inbox/${linked.id}/fragment`)).text).toContain(`href="/notebooks/${nb.id}"`);

    const other = inbox.add({ priority: 'medium', source: 'manual', title: 'Something else', body: '(empty)' });
    res = await get(app, `/inbox/${other.id}/fragment`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('ib-notebook');
  });
});

describe('a notebook page names its conversation', () => {
  it('for the sua panel to open when you arrive with it open', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Bike' });
    const page = () => request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await page()).text).toContain('data-page-thread=""');
    const thread = InboxStore.fromHandle(runStore.databaseHandle()).add({ priority: 'medium', source: 'manual', title: 'Notebook: Bike', body: '(empty)' });
    store.setConversation(nb.id, thread.id);
    expect((await page()).text).toContain(`data-page-thread="${thread.id}"`);
  });
});

describe('runs not in the notebook yet', () => {
  it('lists finished runs of its agents that ran elsewhere, and Add to notebook files one', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Car' });
    store.addEntry(nb.id, { kind: 'option', title: '2010 RAV4', by: 'agent:sweep', runId: 'run-filed' });
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    const keeper = `<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: '2007 Forester 2.5 X' }] })}</notebook>`;
    const run = (id: string, agentName: string, status: 'completed' | 'failed', msAgo: number, result?: string) =>
      runStore.createRun({ id, agentName, status, startedAt: iso(msAgo), completedAt: iso(msAgo - 1000), triggeredBy: 'dashboard', ...(result ? { result } : {}) } as never);
    run('run-filed', 'sweep', 'completed', 3_600_000, keeper);
    run('run-new', 'sweep', 'completed', 60_000, keeper);
    run('run-failed', 'sweep', 'failed', 120_000);
    run('run-old', 'sweep', 'completed', 20 * 86_400_000, keeper);
    run('run-other', 'weather', 'completed', 60_000, keeper);
    const get = () => request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    let page = await get();
    expect(page.text).toContain('Runs not in this notebook yet');
    expect(page.text).toContain(`/notebooks/${nb.id}/runs/run-new/add`);
    for (const r of ['run-filed', 'run-failed', 'run-old', 'run-other']) expect(page.text).not.toContain(`/runs/${r}/add`);
    // A run already filed into another notebook belongs there.
    run('run-other-nb', 'sweep', 'completed', 30_000, keeper);
    const other = store.create({ title: 'Other' });
    store.recordSearch(other.id, 'sweep', 'run-other-nb', 1);
    expect((await get()).text).not.toContain('/runs/run-other-nb/add');

    const post = (runId: string) => request(app).post(`/notebooks/${nb.id}/runs/${runId}/add`)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(decodeURIComponent((await post('run-other')).headers.location.replace(/\+/g, ' '))).toContain("isn't one of its agents");
    expect(decodeURIComponent((await post('run-new')).headers.location.replace(/\+/g, ' '))).toContain("Adding that run's results");
    for (let i = 0; i < 50 && !store.entries(nb.id).some((e) => e.title.startsWith('2007 Forester')); i++) await new Promise((r) => setTimeout(r, 20));
    expect(store.entries(nb.id).find((e) => e.title.startsWith('2007 Forester'))?.runId).toBe('run-new');
    page = await get();
    expect(page.text).not.toContain('Runs not in this notebook yet');
    expect(decodeURIComponent((await post('run-new')).headers.location.replace(/\+/g, ' '))).toContain('already in the notebook');
    // Adding it was a pass of its own, and the Workflow draws it.
    const passes = store.passes(nb.id);
    expect(passes[0]).toMatchObject({ kind: 'added', runIds: ['run-new'], note: expect.stringContaining('sweep: 1 new') });
    const wf = await request(app).get(`/notebooks/${nb.id}/workflow?pass=${passes[0].id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(wf.text).toContain('class="nbw-pass is-on"');
    expect(wf.text).toContain('Added to notebook');
    expect(wf.text).toContain('Earlier run'); // run-filed, from before passes
  });
});

describe("Home's notebooks shelf", () => {
  it('shows the active notebooks newest first (four at most), what sua is waiting on, and + New', async () => {
    const app = await makeApp();
    agentStore.createAgent({ id: 'hello', name: 'Hello', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const home = async () => (await request(app).get('/').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;

    // None yet: an inviting + New, nothing else.
    let page = await home();
    expect(page).toContain('Your notebooks');
    expect(page).toContain('class="nbs-new nbs-new--alone" href="/notebooks/new"');
    expect(page).not.toContain('class="nbs-card"');

    const ids: string[] = [];
    for (const t of ['Bike', 'Laptop', 'Trip', 'Job']) ids.push(store.create({ title: t }).id);
    // The car changes after them, in a later millisecond, so it's the newest.
    await new Promise((r) => setTimeout(r, 15));
    const car = store.setFields(store.create({ title: 'Car', criteria: ['Clean title', 'Under budget'] }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    store.markCriterion(car.id, 0, true);
    store.upsertOption(car.id, { title: '2010 RAV4', by: 'agent:x', data: { price: 4023 } });
    const done = store.create({ title: 'Old couch' });
    store.decide(done.id, 'Kept it');
    const thread = InboxStore.fromHandle(runStore.databaseHandle()).add({ priority: 'medium', source: 'manual', title: 'Notebook: Car', body: '(empty)' });
    store.setConversation(car.id, thread.id);
    InboxStore.fromHandle(runStore.databaseHandle()).updateStatus(thread.id, 'awaiting_user');

    page = await home();
    const cards = page.match(/class="nbs-card" href="\/notebooks\/([^"]+)"/g) ?? [];
    expect(cards).toHaveLength(4);
    expect(cards[0]).toContain(`/notebooks/${car.id}"`); // changed last, so first
    expect(page).not.toContain(`/notebooks/${done.id}"`);
    expect(page).toContain('All notebooks (5) →');
    const carCard = page.slice(page.indexOf(`/notebooks/${car.id}"`), page.indexOf('</a>', page.indexOf(`/notebooks/${car.id}"`)));
    expect(carCard).toContain('sua asked you');
    expect(carCard).toContain('<span class="nbs-card__price">$4,023</span>');
    expect(carCard).toContain('aria-label="1 of 2 done"');
    expect((carCard.match(/nbs-dot is-met/g) ?? []).length).toBe(1);
    expect(page.match(/sua asked you/g)).toHaveLength(1);
    expect(page).toContain('class="nbs-new" href="/notebooks/new"');
  });
});

describe('new notebook: say it, sua drafts it, you check it', () => {
  const form = (app: Awaited<ReturnType<typeof makeApp>>, path: string, body: Record<string, string | string[]>) => request(app).post(path)
    .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  const ready = async (app: Awaited<ReturnType<typeof makeApp>>, id: string) => {
    for (let i = 0; i < 250; i++) {
      const r = await get(app, `/notebooks/draft/${id}`);
      if (r.body.status !== 'working') return r.body as { status: string; html?: string; error?: string };
      await new Promise((res) => setTimeout(res, 20));
    }
    return { status: 'working' };
  };

  it('drafts from a sentence, cleans it, changes it on request, and starts it set up', async () => {
    const app = await makeApp();
    expect((await get(app, '/notebooks/new')).text).toContain('Describe it like you\'d tell a friend');
    expect((await get(app, '/notebooks?new=1')).headers.location).toBe('/notebooks/new');
    expect((await form(app, '/notebooks/draft', { text: '  ' })).status).toBe(400);

    const started = await form(app, '/notebooks/draft', { text: 'noise-cancelling headphones under $300' });
    expect(started.status).toBe(202);
    const d = await ready(app, started.body.id);
    expect(d.status).toBe('ready');
    expect(d.html).toContain('value="Pick noise-cancelling headphones"');
    expect(d.html!.match(/name="params" value="under \$300"/g)).toHaveLength(1); // duplicates dropped
    expect(d.html).toContain('value="sched-agent" checked');
    expect(d.html).not.toContain('made-up-agent'); // only agents you have
    expect(d.html).not.toContain('bad key'); // fields cleaned
    expect(d.html).toContain('<option value="" selected>when I ask</option>'); // "every morning" isn't a schedule

    const changed = await form(app, '/notebooks/draft', { text: 'noise-cancelling headphones under $300', from: started.body.id, change: 'only Sony' });
    expect(changed.body.id).toBe(started.body.id); // a change keeps the draft's address
    expect((await ready(app, changed.body.id)).html).toContain('value="Headphones (only Sony)"');

    const made = await form(app, '/notebooks', {
      title: 'Pick noise-cancelling headphones', statement: 'For flights.', params: ['over-ear', 'under $300'], criteria: ['One pair that fits'],
      field: [JSON.stringify({ key: 'price', label: 'Price', type: 'money', role: 'price' }), JSON.stringify({ key: 'rating', label: 'Rating', type: 'number', role: 'measure' })],
      checks: ['Comfortable with glasses'], stages: 'Found → Shortlist → Bought', pipeline: ['sched-agent', 'made-up-agent'], cadence: '0 7 * * *',
    });
    expect(made.status).toBe(303);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const nb = NotebookStore.fromHandle(runStore.databaseHandle()).get('pick-noise-cancelling-headphones')!;
    expect(nb).toMatchObject({ params: ['over-ear', 'under $300'], stages: ['Found', 'Shortlist', 'Bought'], checks: ['Comfortable with glasses'], pipeline: ['sched-agent'], cadence: '0 7 * * *' });
    expect(nb.fields.map((f) => f.key)).toEqual(['price', 'rating']);
    expect(nb.criteria.map((c) => c.text)).toEqual(['One pair that fits']);
  });

  it('keeps a draft you leave: its address brings it back with your changes, the lists offer it, starting it clears it', async () => {
    const app = await makeApp();
    const started = await form(app, '/notebooks/draft', { text: 'noise-cancelling headphones under $300' });
    const id = started.body.id as string;
    expect((await ready(app, id)).status).toBe('ready');

    // Your edits are kept (the page posts its form as you change it).
    const edited = await form(app, `/notebooks/draft/${id}/edits`, {
      title: 'Quiet headphones for flights', statement: 'For long flights.', params: ['under $300', 'over-ear'], criteria: ['One pair that fits'],
      field: [JSON.stringify({ key: 'price', label: 'Price', type: 'money', role: 'price' })], checks: ['Comfortable with glasses'], stages: 'Found → Bought', cadence: '',
      // sched-agent unticked: still offered when you come back, just not ticked.
    });
    expect(edited.status).toBe(204);
    expect((await form(app, '/notebooks/draft/no-such/edits', { title: 'x' })).status).toBe(404);

    // Coming back: the sentence and the draft as you left it, ready to start.
    const back = await get(app, `/notebooks/new?draft=${id}`);
    expect(back.text).toContain('>noise-cancelling headphones under $300</textarea>');
    expect(back.text).toContain('value="Quiet headphones for flights"');
    expect(back.text).toContain('name="params" value="over-ear"');
    expect(back.text).toContain('value="Found → Bought"');
    expect(back.text).toMatch(/value="sched-agent"><span>/);
    expect(back.text).toContain(`<input type="hidden" name="draft" value="${id}">`);

    // The notebooks list and a fresh New page offer it.
    const list = await get(app, '/notebooks');
    expect(list.text).toContain('A draft you haven’t started');
    expect(list.text).toContain(`href="/notebooks/new?draft=${id}">Quiet headphones for flights</a>`);
    expect((await get(app, '/notebooks/new')).text).toContain(`/notebooks/new?draft=${id}`);

    // Starting it from the draft clears it.
    const made = await form(app, '/notebooks', { draft: id, title: 'Quiet headphones for flights', statement: 'For long flights.' });
    expect(made.status).toBe(303);
    expect((await get(app, '/notebooks')).text).not.toContain('haven’t started');
    expect((await get(app, `/notebooks/new?draft=${id}`)).text).toContain('That draft is gone');
  });

  it('a draft survives a restart, and one cut off mid-draft reads as failed; Discard and drafting again remove it', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(runStore.databaseHandle());
    // Left "working" by a dashboard that stopped 20 minutes ago.
    s.saveDraft('cut-off', { status: 'working', text: 'a quiet rental' }, new Date(Date.now() - 20 * 60_000).toISOString());
    const page = await get(app, '/notebooks/new?draft=cut-off');
    expect(page.text).toContain('sua stopped before it finished');
    expect(page.text).not.toContain('data-nbd-resume');
    // Discard.
    const gone = await form(app, '/notebooks/draft/cut-off/discard', { back: 'list' });
    expect(gone.headers.location).toBe('/notebooks');
    expect(s.getDraft('cut-off')).toBeUndefined();
    // Drafting the sentence again replaces the draft you were on.
    const first = await form(app, '/notebooks/draft', { text: 'headphones' });
    await ready(app, first.body.id);
    const again = await form(app, '/notebooks/draft', { text: 'headphones under $200', replace: first.body.id });
    await ready(app, again.body.id);
    expect(s.listDrafts().map((d) => d.id)).toEqual([again.body.id]);
  });

  it('Skip the draft starts it from the sentence alone', async () => {
    const app = await makeApp();
    const made = await form(app, '/notebooks', { statement: 'A quiet 2-bed rental in Fremont under $2,600. Move by December.' });
    expect(made.status).toBe(303);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const nb = NotebookStore.fromHandle(runStore.databaseHandle()).list()[0];
    expect(nb.title).toBe('A quiet 2-bed rental in Fremont under $2,600');
  });
});

describe("new notebook's suggestions from your conversations", () => {
  it('reads your own conversations (not notebook or fix threads), keeps three clean pills, and caches them', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const inbox = InboxStore.fromHandle(runStore.databaseHandle());
    const say = (title: string, first: string, status?: 'resolved' | 'dismissed') => {
      const m = inbox.add({ priority: 'medium', source: 'manual', title, body: '(empty)' });
      inbox.addResponse(m.id, 'user', first);
      if (status) inbox.updateStatus(m.id, status);
      return m;
    };
    say('tires?', 'can you help me research some good tires for my 2012 rav4', 'dismissed');
    say('jobs', 'find me remote ai senior product manager roles', 'resolved');
    say('Fix Apple reminder demo', 'it failed');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const nbThread = say('Notebook: Car', 'hello');
    const s = NotebookStore.fromHandle(runStore.databaseHandle());
    s.setConversation(s.create({ title: 'Car' }).id, nbThread.id);

    let page = await get('/notebooks/new');
    expect(page.text).toContain('data-nbd-pills data-nbd-pills-refreshing');
    let j: { refreshing: boolean; html: string } = { refreshing: true, html: '' };
    for (let i = 0; i < 100 && j.refreshing; i++) { j = (await get('/notebooks/suggestions')).body; if (j.refreshing) await new Promise((r) => setTimeout(r, 20)); }
    expect(suggesterSaw).toContain('tires? — can you help me research some good tires');
    expect(suggesterSaw).toContain('jobs — find me remote ai senior product manager roles');
    expect(suggesterSaw).not.toContain('Fix Apple');
    expect(suggesterSaw).not.toContain('Notebook: Car');
    const pills = j.html.match(/data-nbd-pill="([^"]+)"/g) ?? [];
    expect(pills).toEqual(['data-nbd-pill="Good tires for my 2012 RAV4, wet and dry"', 'data-nbd-pill="A remote senior AI PM job over $200k"', 'data-nbd-pill="A 2-bed rental"']);
    expect(j.html).toContain('From your conversations');
    // Cached: the next visit shows them at once and doesn't ask again.
    suggesterSaw = '';
    page = await get('/notebooks/new');
    expect(page.text).toContain('>Tires for the RAV4</button>');
    expect(page.text).not.toContain('data-nbd-pills-refreshing');
    expect(suggesterSaw).toBe('');
  });
});

describe('how a notebook was made (Workflow)', () => {
  it('draws its runs and their sub-runs, links them, and run pages link back; sub-runs are never offered to file', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = s.create({ title: 'Car' });
    const now = Date.now();
    const run = (id: string, agentName: string, msAgo: number, parent?: [string, string]) => runStore.createRun({
      id, agentName, status: 'completed', startedAt: new Date(now - msAgo).toISOString(), completedAt: new Date(now - msAgo + 1000).toISOString(),
      triggeredBy: 'dashboard', result: 'found things', ...(parent ? { parentRunId: parent[0], parentNodeId: parent[1] } : {}),
    } as never);
    run('sweep-1', 'car-sweep', 120_000);
    run('cl-a', 'craigslist-search', 110_000, ['sweep-1', 'seattle']);
    s.recordSearch(nb.id, 'craigslist-search', 'old-direct', 0, new Date(now - 900_000).toISOString()); // makes craigslist-search a source
    s.recordSearch(nb.id, 'car-sweep', 'sweep-1', 1, new Date(now - 100_000).toISOString());
    s.upsertOption(nb.id, { title: 'RAV4', by: 'agent:car-sweep', runId: 'sweep-1' });

    expect((await get('/notebooks/car')).text).toContain('href="/notebooks/car/workflow">How it was made →</a>');
    const page = await get('/notebooks/car/workflow');
    expect(page.status).toBe(200);
    expect(page.text).toContain('How this notebook was made');
    const data = JSON.parse(/<script id="dag-data" type="application\/json">([\s\S]*?)<\/script>/.exec(page.text)![1]) as { elements: Array<{ data: Record<string, string> }> };
    const ids = data.elements.map((e) => e.data.id);
    expect(ids).toEqual(expect.arrayContaining(['nb', 'sweep-1', 'cl-a', 'nb->sweep-1', 'sweep-1->cl-a', 'left:sweep-1']));
    expect(data.elements.find((e) => e.data.id === 'cl-a')!.data.href).toBe('/runs/cl-a');
    expect(data.elements.find((e) => e.data.id === 'left:sweep-1')!.data.label).toBe('1 option');
    expect(page.text).toContain('data-layout="lr"');
    expect(page.text).toContain('1 run it started');
    expect((await get('/notebooks/nope/workflow')).status).toBe(404);

    // The sub-run is part of the sweep's search: not offered to Add to notebook.
    expect((await get('/notebooks/car')).text).not.toContain('/runs/cl-a/add');
    // Run pages link back, the sub-run through its parent.
    expect((await get('/runs/sweep-1')).text).toContain('<a href="/notebooks/car">Car</a> · <a href="/notebooks/car/workflow">how it was made</a>');
    expect((await get('/runs/cl-a')).text).toContain('(through the run that started this one)');
  });
});

describe('a run that files its own structured block', () => {
  it('is filed directly, without the keeper model, and can add more than a keeper would', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { directBlock } = await import('../lib/notebook-pipeline.js');
    expect(directBlock('no block here')).toBeUndefined();
    expect(directBlock('<notebook>{"entries": []}</notebook>')).toBeUndefined(); // nothing to file: the keeper reads it
    expect(directBlock('<notebook>{not json</notebook>')).toBeUndefined();

    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Accounts' }).id, [
      { key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'website', label: 'Website', type: 'url', role: 'link' },
      { key: 'fit', label: 'Fit', type: 'number', role: 'score' },
    ]);
    store.addEntry(nb.id, { kind: 'note', title: 'started', by: 'agent:acct', runId: 'seed-run' }); // makes acct a source
    const entries: unknown[] = Array.from({ length: 20 }, (_, i) => ({ kind: 'option', title: `Company ${String(i + 1)}`, data: { company: `Company ${String(i + 1)}`, website: `https://c${String(i + 1)}.example.com`, fit: { value: 50 + i, estimate: true } } }));
    // The agent's code checked this quote; and it rules one company out itself.
    (entries[0] as { data: Record<string, unknown> }).data.fit = { value: 50, source: 'https://c1.example.com/jobs/1', quote: 'migrating our billing to Kafka', checked: true };
    entries.push({ kind: 'option', title: 'Initech', ruleOut: 'Unfit (12): sells printers', data: { company: 'Initech', website: 'https://initech.example.com', fit: 12 } });
    // Prose around the block: the test keeper only answers when output STARTS with <notebook>, so only direct filing can file this.
    const output = `Found 20 accounts.\n<notebook>${JSON.stringify({ entries })}</notebook>\nDone.`;
    runStore.createRun({ id: 'acct-run', agentName: 'acct', status: 'completed', startedAt: new Date(Date.now() - 60_000).toISOString(), completedAt: new Date().toISOString(), triggeredBy: 'dashboard', result: output } as never);
    const res = await request(app).post(`/notebooks/${nb.id}/runs/acct-run/add`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    for (let i = 0; i < 100 && store.entries(nb.id).filter((e) => e.kind === 'option').length < 21; i++) await new Promise((r) => setTimeout(r, 20));
    const options = store.entries(nb.id).filter((e) => e.kind === 'option');
    expect(options.filter((e) => !e.ruledOut)).toHaveLength(20); // a keeper pass would stop at 12
    expect(options.find((e) => e.title === 'Company 1')!.factMeta!.fit).toEqual({ source: 'https://c1.example.com/jobs/1', quote: 'migrating our billing to Kafka', checked: true });
    expect(options.find((e) => e.title === 'Initech')!.ruledOut).toMatchObject({ reason: 'Unfit (12): sells printers', by: 'agent:acct' });
    expect(options.find((e) => e.title === 'Company 20')!.factMeta).toEqual({ fit: { estimate: true } });
    for (let i = 0; i < 50 && !store.passes(nb.id)[0]?.note; i++) await new Promise((r) => setTimeout(r, 20));
    expect(store.passes(nb.id)[0].note).toContain('acct: 21 new (filed directly)');
  });
});

describe('download the shortlist', () => {
  it('sends a CSV attachment best first, and the header links to it once there are options', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Accounts to call' }).id, [{ key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await get(`/notebooks/${nb.id}`)).text).not.toContain('shortlist.csv');
    store.upsertOption(nb.id, { title: 'Low', by: 'agent:x', data: { fit: 40 } });
    store.upsertOption(nb.id, { title: 'High', by: 'agent:x', data: { fit: 90 } });
    expect((await get(`/notebooks/${nb.id}`)).text).toContain(`href="/notebooks/${nb.id}/shortlist.csv"`);
    const res = await get(`/notebooks/${nb.id}/shortlist.csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${nb.id}-shortlist.csv"`);
    const rows = res.text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(rows.slice(1).map((r) => r.split(',').slice(0, 2).join(','))).toEqual(['1,High', '2,Low']);
    expect((await get(`/notebooks/${nb.id}/shortlist.csv?all=1`)).headers['content-disposition']).toContain('-all.csv');
    expect((await get('/notebooks/nope/shortlist.csv')).status).toBe(404);
  });
});

describe('the catalog knows which agents fill notebooks', () => {
  it('badges and filters the agents list, shows the notebooks on the agent page, and the drafter sees them first', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { searchAgents } = await import('../lib/notebook-draft.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    agentStore.createAgent({ id: 'car-sweep', name: 'Car sweep', description: 'Sweeps car listings', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    agentStore.createAgent({ id: 'zz-idle', name: 'Idle', description: 'Never filed', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    const cars = store.create({ title: 'Buy a car', pipeline: ['car-sweep'] });
    const bikes = store.create({ title: 'Buy a bike' });
    store.addEntry(bikes.id, { kind: 'note', title: 'found one', by: 'agent:car-sweep', runId: 'r1' });
    store.addEntry(bikes.id, { kind: 'note', title: 'set up', by: 'agent:notebook-keeper', runId: 'r2' });

    const byAgent = store.notebooksByAgent(new Set(['notebook-keeper']));
    expect(byAgent.get('car-sweep')!.map((n) => n.title).sort()).toEqual(['Buy a bike', 'Buy a car']);
    expect(byAgent.has('notebook-keeper')).toBe(false);

    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const list = (await get('/agents')).text;
    expect(list).toContain('feeds 2 notebooks');
    expect(list).toContain('Feeds notebooks (1)');
    const only = (await get('/agents?feeds=1')).text;
    expect(only).toContain('car-sweep');
    expect(only).not.toContain('zz-idle');

    const page = (await get('/agents/car-sweep')).text;
    expect(page).toContain('Fills notebooks');
    expect(page).toContain(`href="/notebooks/${cars.id}"`);
    expect(page).toContain(`href="/notebooks/${bikes.id}/workflow"`);
    expect((await get('/agents/zz-idle')).text).not.toContain('Fills notebooks');

    const agents = searchAgents(app.locals as never);
    expect(agents[0]).toMatchObject({ id: 'car-sweep' });
    expect(agents[0].feeds!.sort()).toEqual(['Buy a bike', 'Buy a car']);
    expect(agents.find((a) => a.id === 'zz-idle')!.feeds).toBeUndefined();
  });
});

describe("a notebook's schedule", () => {
  it('runs the pipeline once per slot, waits on a new schedule, catches up once, and marks the pass', async () => {
    const app = await makeApp();
    const ctx = app.locals as never as Parameters<typeof import('../lib/notebook-cadence.js')['runNotebookCadenceOnce']>[0];
    const { runNotebookCadenceOnce } = await import('../lib/notebook-cadence.js');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Cars every morning', pipeline: ['sched-agent'], cadence: '0 7 * * *' });
    const at = (s: string) => new Date(s);
    const idle = async () => { for (let i = 0; i < 200 && ctx.notebookPipelines?.size; i++) await new Promise((r) => setTimeout(r, 20)); };

    // First sight: the 7:00 already past isn't owed.
    expect(runNotebookCadenceOnce(ctx, at('2026-10-07T08:00:00')).get(nb.id)).toBe('first-seen');
    expect(runNotebookCadenceOnce(ctx, at('2026-10-07T08:30:00')).get(nb.id)).toBe('waiting');
    // Next morning: runs once.
    expect(runNotebookCadenceOnce(ctx, at('2026-10-08T07:01:00')).get(nb.id)).toBe('started');
    await idle();
    expect(runNotebookCadenceOnce(ctx, at('2026-10-08T07:02:00')).get(nb.id)).toBe('waiting');
    expect(store.passes(nb.id)[0]).toMatchObject({ kind: 'pipeline', scheduled: true });
    // Down for three days: one catch-up run, not three.
    expect(runNotebookCadenceOnce(ctx, at('2026-10-11T09:00:00')).get(nb.id)).toBe('started');
    await idle();
    expect(runNotebookCadenceOnce(ctx, at('2026-10-11T09:01:00')).get(nb.id)).toBe('waiting');
    expect(store.passes(nb.id).filter((p) => p.scheduled)).toHaveLength(2);
    // Someone pressed Run: busy, retried next tick.
    store.markCadenceFired(nb.id, '2026-10-11T07:00:00.000Z');
    ctx.notebookPipelines ??= new Map();
    ctx.notebookPipelines.set(nb.id, { agentId: 'sched-agent', step: 1, of: 1, startedAt: Date.now() });
    expect(runNotebookCadenceOnce(ctx, at('2026-10-12T07:00:30')).get(nb.id)).toBe('busy');
    ctx.notebookPipelines.delete(nb.id);
    // A changed schedule starts fresh.
    store.update(nb.id, { cadence: '0 9 * * 1' });
    expect(store.get(nb.id)!.cadenceFiredAt).toBeUndefined();
    expect(runNotebookCadenceOnce(ctx, at('2026-10-12T10:00:00')).get(nb.id)).toBe('first-seen');
    // Closed, or nothing to run: left alone.
    store.setStatus(nb.id, 'stopped');
    expect(runNotebookCadenceOnce(ctx, at('2026-10-20T10:00:00')).has(nb.id)).toBe(false);
  });

  it('says when it runs next in the header', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Weekly accounts', pipeline: ['sched-agent'], cadence: '0 7 * * 1' });
    const page = (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(page).toMatch(/runs [^<]*, next (today|tomorrow|Mon) 7:00 am/);
    const idle = store.create({ title: 'No searches yet', cadence: '0 7 * * 1' });
    expect((await request(app).get(`/notebooks/${idle.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text).toContain('once it has a search (add one under Edit)');
  });
});

describe("an option's own page", () => {
  it('shows every fact with its source, the price over time, its checks and its history; its controls come back to it', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Commuter car' });
    store.setFields(nb.id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' },
      { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' },
      { key: 'link', label: 'Listing', type: 'url', role: 'link' },
    ]);
    store.setStages(nb.id, ['Found', 'Checked', 'Test drive']);
    store.setChecks(nb.id, ['Clean title', 'Service records']);
    const link = 'https://example.com/listing/1';
    const wagon = store.upsertOption(nb.id, { title: '2010 Example Wagon', by: 'agent:car-search', runId: 'run-aaaa1111', data: { price: 4800, miles: { value: 150000, source: 'https://example.com/report', quote: 'odometer reads 150,000 miles' }, link } }).entry;
    store.upsertOption(nb.id, { title: '2010 Example Wagon', by: 'agent:car-search', runId: 'run-bbbb2222', data: { price: 4500, link } });
    store.upsertOption(nb.id, { title: '2012 Example Hatch', by: 'you', data: { price: 5200 } });
    store.checkOption(nb.id, wagon.id, 'Clean title', true);
    const note = store.addEntry(nb.id, { kind: 'note', title: 'Ask about rust', by: 'you' });

    const page = await get(`/notebooks/${nb.id}/entries/${wagon.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('2010 Example Wagon');
    expect(page.text).toContain('best price'); // the cheaper of the two
    expect(page.text).toContain('Move to Checked →');
    expect(page.text).toContain('name="back" value="option"');
    expect(page.text).toContain(`href="/notebooks/${nb.id}"`);
    // The widgets: facts with the source and quote, the price over time, checks, its own history.
    expect(page.text).toContain('“odometer reads 150,000 miles”');
    expect(page.text).toContain('https://example.com/report');
    expect(page.text).toContain('"priceSeries":[4800,4500]');
    expect(page.text).toContain('Price dropped');
    expect(page.text).toContain('$4,800 → $4,500');
    // Found links the run that found it; seen again links the later one.
    expect(page.text).toMatch(/"title":"Found"[^}]*run-aaaa1111/);
    expect(page.text).toMatch(/"title":"Price dropped"[^}]*run-bbbb2222/);
    expect(page.text).toContain('{"text":"Clean title","done":true}');
    // Its widgets carry only this option; the other is named once, by Next.
    const widgets = /data-a2ui-surface[^>]*><script type="application\/json">([\s\S]*?)<\/script>/.exec(page.text)![1];
    expect(widgets).not.toContain('2012 Example Hatch');
    expect(page.text).toMatch(/data-nbo-(?:next|prev)[^>]*>[^<]*<span class="nbo-nav__name" data-nbo-name>#\d 2012 Example Hatch/);

    // Its controls come back here; the notebook's cards still go to the notebook.
    const moved = await post(`/notebooks/${nb.id}/entries/${wagon.id}/stage`, { stage: 'Checked', back: 'option' });
    expect(moved.headers.location).toMatch(new RegExp(`^/notebooks/${nb.id}/entries/${wagon.id}\\?flash=`));
    const out = await post(`/notebooks/${nb.id}/entries/${wagon.id}/rule-out`, { quick: 'No reply', back: 'option' });
    expect(out.headers.location).toMatch(new RegExp(`^/notebooks/${nb.id}/entries/${wagon.id}\\?flash=`));
    const outPage = await get(`/notebooks/${nb.id}/entries/${wagon.id}`);
    expect(outPage.text).toContain('Ruled out at Checked: No reply');
    expect(outPage.text).toContain('Moved to Checked');
    expect(outPage.text).not.toContain('best price');
    expect((await post(`/notebooks/${nb.id}/entries/${wagon.id}/reinstate`)).headers.location).toMatch(new RegExp(`^/notebooks/${nb.id}\\?flash=.*#entry-${wagon.id}$`));

    // A note has no page: it goes to its place in the notebook. Nothing there is a 404.
    expect((await get(`/notebooks/${nb.id}/entries/${note.id}`)).headers.location).toBe(`/notebooks/${nb.id}#entry-${note.id}`);
    expect((await get(`/notebooks/${nb.id}/entries/nope`)).status).toBe(404);
    expect((await get(`/notebooks/nope/entries/${wagon.id}`)).status).toBe(404);
  });
});

describe('a correction in the conversation', () => {
  it("changes the option itself (not a note beside it), and its page shows what it replaced", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { parseNotebookAdd, applyNotebookAdd } = await import('../lib/notebook-chat.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Cabinet' });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'width', label: 'Width', type: 'number', unit: 'in', role: 'measure' }]);
    const c = store.upsertOption(nb.id, { title: 'Example cabinet, 24" wide', by: 'agent:x', runId: 'r1', data: { price: 4023, width: 24 } }).entry;
    const before = store.entries(nb.id).length;

    const { add, error } = parseNotebookAdd(JSON.stringify({ update: [{ option: 'Example cabinet', data: { price: 136.64 } }, { option: 'Nope', data: { price: 1 } }, { option: 'x', data: {} }] }));
    expect(error).toBeUndefined();
    expect(add!.update).toHaveLength(2); // the empty one is dropped
    const out = applyNotebookAdd(store, nb.id, add!);
    expect(out.added).toEqual(['corrected: Example cabinet, 24" wide (Price $4,023 → $136.64)', 'couldn\'t find an option matching "Nope"']);
    expect(store.findOption(nb.id, 'Example')!.data).toEqual({ price: 136.64, width: 24 });
    expect(store.entries(nb.id)).toHaveLength(before); // no evidence entry beside it

    const page = await request(app).get(`/notebooks/${nb.id}/entries/${c.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(page.text).toContain('$136.64');
    expect(page.text).toMatch(/"who":"sua","title":"Corrected","body":"Price \$4,023 → \$136.64"/);
  });
});

describe('archiving and deleting a notebook from its page', () => {
  it('archive hides it from the list (Archived shows it, the page offers Restore); delete removes it and its pages', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Old cabinet search' }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    const o = store.upsertOption(nb.id, { title: 'Example cabinet', by: 'you', data: { price: 90 } }).entry;
    store.create({ title: 'Another notebook' });

    const page = await get(`/notebooks/${nb.id}`);
    expect(page.text).toContain(`action="/notebooks/${nb.id}/archive"`);
    expect(page.text).toContain('Delete…');

    const archived = await post(`/notebooks/${nb.id}/archive`, { archived: '1' });
    expect(decodeURIComponent(archived.headers.location)).toContain('Archived “Old cabinet search”');
    const list = await get('/notebooks?status=all');
    expect(list.text).not.toContain('Old cabinet search');
    expect(list.text).toContain('Archived <span class="nb-tabs__n">1</span>');
    expect((await get('/notebooks?status=archived')).text).toContain('Old cabinet search');
    const archivedPage = await get(`/notebooks/${nb.id}`);
    expect(archivedPage.text).toContain('class="nb-archived"');
    expect(archivedPage.text).toContain('Restore');

    await post(`/notebooks/${nb.id}/archive`, { archived: '0' });
    expect((await get('/notebooks?status=all')).text).toContain('Old cabinet search');

    // Delete needs the confirm field naming it.
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/delete`)).headers.location)).toContain('Confirm the delete');
    expect(store.get(nb.id)).toBeDefined();
    const deleted = await post(`/notebooks/${nb.id}/delete`, { confirm: nb.id });
    expect(decodeURIComponent(deleted.headers.location)).toBe('/notebooks?flash=Deleted “Old cabinet search”.');
    expect(store.get(nb.id)).toBeUndefined();
    expect((await get(`/notebooks/${nb.id}/entries/${o.id}`)).status).toBe(404);
    expect(decodeURIComponent((await get(`/notebooks/${nb.id}`)).headers.location)).toContain('No such notebook');
    expect((await get('/notebooks?status=all')).text).toContain('Another notebook');
  });
});

describe("the keeper's numbers are checked against what the run said", () => {
  it('leaves out a number the output never states (the run note says so); trusted blocks and setup text are respected', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult, passNote } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Cabinet' }).id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'width', label: 'Width', type: 'number', unit: 'in', role: 'measure' },
      { key: 'link', label: 'Product', type: 'url', role: 'link' },
    ]);
    const block = (o: unknown) => `<notebook>${JSON.stringify(o)}</notebook>`;
    const output = 'Found: Example wall cabinet, 24" wide, one side hook. https://shop.example/c-1 (no price listed)';
    const cab = { kind: 'option', title: 'Example wall cabinet', body: 'Wall-mounted.', data: { price: 4023, width: 24, link: 'https://shop.example/c-1' } };

    const out = applyKeeperResult(store, nb, 'starter-research', 'run-1', block({ entries: [cab] }), { source: output });
    expect(out).toMatchObject({ added: 1, factsDropped: 1 });
    expect(store.findOption(nb.id, 'Example')!.data).toEqual({ width: 24, link: 'https://shop.example/c-1' });
    expect(passNote('starter-research', out)).toBe('starter-research: 1 new, 1 number not in its output left out');

    // A later run that states the price fills it in.
    const again = applyKeeperResult(store, store.get(nb.id)!, 'starter-research', 'run-2', block({ entries: [{ ...cab, data: { price: 136.64, link: 'https://shop.example/c-1' } }] }), { source: `${output} Now $136.64.` });
    expect(again.factsDropped).toBeUndefined();
    expect(store.findOption(nb.id, 'Example')!.data!.price).toBe(136.64);

    // An agent's own block (code, not a model) isn't second-guessed.
    const direct = applyKeeperResult(store, store.get(nb.id)!, 'account-research', 'run-3', block({ entries: [{ kind: 'option', title: 'Other cabinet', data: { price: 99, link: 'https://shop.example/c-2' } }] }), { trusted: true, source: 'x' });
    expect(direct.factsDropped).toBeUndefined();
    expect(store.findOption(nb.id, 'Other')!.data!.price).toBe(99);
  });
});
