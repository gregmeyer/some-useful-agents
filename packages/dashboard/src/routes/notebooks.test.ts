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
    expect((await get(app, '/notebooks')).text).toContain('Buy the RAV4');
    expect((await get(app, '/notebooks/nope')).status).toBe(303);
  });

  it('Home\'s Notebooks line', async () => {
    await makeApp();
    const { renderHomeNotebooksLine } = await import('../views/notebooks.js');
    const { render } = await import('../views/html.js');
    expect(render(renderHomeNotebooksLine(0, 0))).toContain('>Notebooks</a>');
    expect(render(renderHomeNotebooksLine(2, 3))).toContain('>2 active notebooks</a>');
    expect(render(renderHomeNotebooksLine(1, 1))).toContain('href="/notebooks?new=1">New notebook');
  });
});

describe('notebook pipeline (G2–G3)', () => {
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
