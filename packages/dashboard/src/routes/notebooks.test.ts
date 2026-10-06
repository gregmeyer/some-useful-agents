import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
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
    expect(empty.text).toMatch(/<details class="nb-card nb-card--new" id="new" open>/);

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
    expect(render(renderHomeNotebooksLine(1, 1))).toContain('href="/notebooks?new=1" class="home-notebooks__new" aria-label="New notebook">+ New');
  });
});

describe('notebook pipeline (G2–G3)', () => {
  it('the keeper sets fields once, records option facts, and refreshes an option found again', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = store.create({ title: 'Buy a used car for Nadia' });
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
    const base = { id: 'car', title: 'Buy a used car for Nadia', statement: '', params: [] as string[], criteria: [{ text: 'clean title', met: false }], pipeline: [] as string[], fields: [], stages: [] as string[], checks: [] as string[], cadence: '', status: 'active' as const, createdAt: '', updatedAt: '' };
    const opt = { id: 'e1', notebookId: 'car', kind: 'option' as const, title: '2011 Subaru Forester, 150k, $7,200', body: '', by: 'sua', createdAt: '' };
    expect(nextStep(base, []).placeholder).toContain('what "Buy a used car for Nadia" is for');
    const withWhy = { ...base, statement: 'Find a reliable car for a new driver.' };
    expect(nextStep(withWhy, []).hint).toBe('Next: the limits sua should hold to.');
    expect(nextStep(withWhy, []).placeholder).toContain('"Find a reliable car for a new driver"');
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
    const listing = add('2009 Subaru Forester 2.5X', { url: 'https://www.autotrader.com/cars-for-sale/inventory/767954639' });
    const results = add('2007 Subaru Forester', { url: 'https://www.cargurus.com/Cars/l-Used-Subaru-Forester-Seattle-c8308' });
    const wrongCar = add('2006 Subaru Forester 2.5X', { url: 'https://www.autotrader.com/cars-for-sale/inventory/772291286' });
    const fetched: string[] = [];
    const deps = {
      fetchImage: async (u: string) => { fetched.push(u); if (u.includes('broken')) throw new Error('HTTP 404'); return { bytes: JPEG, contentType: 'image/jpeg' }; },
      pagePreview: async (u: string) => (u.endsWith('767954639')
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
    expect(carCard.text).toContain('1 option · 1 in the running · best $4,023 · 0 of 1 done');
    expect(carCard.text).toContain(`src="/notebooks/buy-a-used-car/entries/${rav.id}/photo"`);
    expect(carCard.text).toContain('lead: 2010 Toyota RAV4');
    expect((await get('/notebooks?q=nothing-like-this')).text).toContain('No active notebooks matching');
  });
});
