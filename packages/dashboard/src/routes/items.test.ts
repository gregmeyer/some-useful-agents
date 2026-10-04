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
const PORT = 3997;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp(opts: { schedule?: string; allowHighFrequency?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'sua-items-route-'));
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


describe('GET /api/items', () => {
  it('returns the item index, filtered by kind and agent', async () => {
    const app = await makeApp();
    agentStore.createAgent({ id: 'sketch', name: 'Sketch', status: 'draft', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }] }, 'cli');
    const get = (q = '') => request(app).get(`/api/items${q}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const all = await get();
    expect(all.status).toBe(200);
    expect(all.body.items.map((i: { id: string }) => i.id)).toEqual(expect.arrayContaining(['agent:sketch:draft', 'system:scheduler']));
    const decisions = await get('?kind=decision&agent=sketch');
    expect(decisions.body.items.map((i: { id: string }) => i.id)).toEqual(['agent:sketch:draft']);
    const noOk = await get('?ok=0');
    expect(noOk.body.items.some((i: { state: string }) => i.state === 'ok')).toBe(false);
    const anon = await request(app).get('/api/items').set('Host', `127.0.0.1:${PORT}`);
    expect(anon.status).toBe(401);
  });
});

describe('Home\'s surface, drawn (S3)', () => {
  const node = [{ id: 'n', type: 'shell' as const, command: 'echo hi', dependsOn: [] }];

  it('an item pane: what it is, evidence, actions in place, and why it is on Home', async () => {
    const app = await makeApp();
    agentStore.createAgent({ id: 'flaky', name: 'Flaky', status: 'active', source: 'local', mcp: false, nodes: node }, 'cli');
    for (const id of ['r1', 'r2']) runStore.createRun({ id: `${id}-0000-aaaa`, agentName: 'flaky', status: 'failed', startedAt: `2026-10-03T0${id.slice(1)}:00:00Z`, triggeredBy: 'schedule', error: 'exit 1' });
    const get = (id: string) => request(app).get(`/items/${encodeURIComponent(id)}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const pane = await get('agent:flaky:failing');
    expect(pane.status).toBe(200);
    expect(pane.text).toContain('Flaky is failing');
    expect(pane.text).toContain('2 runs in a row failed: exit 1');
    expect(pane.text).toContain('action="/agents/flaky/run" data-item-act');
    expect(pane.text).toContain('action="/agents/flaky/ask-fix" data-ask-fix');
    expect(pane.text).toContain('href="/runs/r2-0000-aaaa"');
    expect(pane.text).toContain('In Needs you: normal urgency, waiting on you');
    expect((await get('agent:nope:failing')).text).toContain("This isn't on Home any more");
  });

  it('Today: regions as rows, drafts folded into one line, All good as a quiet line', async () => {
    await makeApp(); // the shared afterEach closes what makeApp opens
    const { renderToday, rowTarget } = await import('../views/home-surface.js');
    const { render } = await import('../views/html.js');
    const { compileSurface, DEFAULT_HOME_SURFACE } = await import('@some-useful-agents/core');
    const base = { subject: {}, actions: [], evidence: [], href: '/', provenance: { source: 'agents' as const, producedBy: 'system', at: '2026-10-03T00:00:00Z' } };
    const items = [
      { ...base, id: 'thread:t1', kind: 'question' as const, title: 'A question', urgency: 'normal' as const, state: 'open' as const, subject: { threadId: 't1' } },
      { ...base, id: 'agent:a:draft', kind: 'decision' as const, title: 'A is a draft', urgency: 'low' as const, state: 'open' as const },
      { ...base, id: 'agent:b:draft', kind: 'decision' as const, title: 'B is a draft', urgency: 'low' as const, state: 'open' as const },
      { ...base, id: 'system:scheduler', kind: 'status' as const, title: 'The scheduler', summary: 'Running 2 scheduled agents', urgency: 'low' as const, state: 'ok' as const },
    ];
    const out = render(renderToday({ compiled: compileSurface(DEFAULT_HOME_SURFACE, items), version: 0, goal: 'g', needsCount: 1, doc: DEFAULT_HOME_SURFACE, items }, true));
    expect(out).toContain('data-panel-thread-id="t1"');
    expect(out).toContain('2 draft agents waiting to be made active');
    expect(out).toContain('data-panel-thread-id="item:agent:a:draft"');
    expect(out).toMatch(/All good:<\/span> Running 2 scheduled agents/);
    expect(rowTarget({ ...items[0], id: 'question:q1', subject: { threadId: 't9' } })).toBe('t9');
  });
});

describe('changing Home by hand (S4)', () => {
  const node = [{ id: 'n', type: 'shell' as const, command: 'echo hi', dependsOn: [] }];
  const post = (app: Awaited<ReturnType<typeof makeApp>>, path: string, body: unknown) => request(app).post(path)
    .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE)
    .set('X-Requested-With', 'fetch').send(body as object);

  it('pins as you, offers the rule for everything like it, refuses stale or bad ops, and undoes', async () => {
    const app = await makeApp();
    agentStore.createAgent({ id: 'flaky', name: 'Flaky', status: 'active', source: 'local', mcp: false, nodes: node }, 'cli');
    agentStore.createAgent({ id: 'sketch', name: 'Sketch', status: 'draft', source: 'local', mcp: false, nodes: node }, 'cli');
    runStore.createRun({ id: 'r1-0000', agentName: 'flaky', status: 'failed', startedAt: '2026-10-03T01:00:00Z', triggeredBy: 'schedule', error: 'exit 1' });

    const pinned = await post(app, '/surfaces/home/ops', { ops: [{ op: 'pin', itemId: 'agent:flaky:failing' }], reason: 'Pinned Flaky', expectedVersion: 0, itemId: 'agent:flaky:failing', gesture: 'pin' });
    expect(pinned.status).toBe(200);
    expect(pinned.body).toMatchObject({ version: 1, undoTo: 0, suggestion: { question: 'Always put failing agents first?', op: { op: 'addRule', rule: { id: 'failing-first', type: 'promote' } } } });
    const pane = await request(app).get(`/items/${encodeURIComponent('agent:flaky:failing')}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(pane.text).toMatch(/Pinned by you, \w{3} \d+/);

    expect((await post(app, '/surfaces/home/ops', { ops: [{ op: 'hide', itemId: 'x' }], expectedVersion: 0 })).status).toBe(409);
    expect((await post(app, '/surfaces/home/ops', { ops: [{ op: 'explode' }] })).status).toBe(400);
    expect((await post(app, '/surfaces/home/ops', { ops: 'pin' })).status).toBe(400);

    // Hiding a draft offers "hide draft agents"; hiding is never generalized from a conversation (see surface-suggest).
    const hid = await post(app, '/surfaces/home/ops', { ops: [{ op: 'hide', itemId: 'agent:sketch:draft' }], itemId: 'agent:sketch:draft', gesture: 'hide' });
    expect(hid.body.suggestion?.question).toBe('Always hide draft agents?');

    const undone = await post(app, '/surfaces/home/restore', { toVersion: 0 });
    expect(undone.status).toBe(200);
    expect(undone.body.version).toBe(3);
    const after = await request(app).get(`/items/${encodeURIComponent('agent:flaky:failing')}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(after.text).not.toContain('Pinned by you');
    expect((await post(app, '/surfaces/home/restore', { toVersion: 99 })).status).toBe(404);
  });
});

describe('Home\'s history and reasons (S6)', () => {
  it('lists versions newest first with who, why, what, and the way back; reasons show once per run', async () => {
    const app = await makeApp();
    const get = () => request(app).get('/surfaces/home/history').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await get()).text).toContain('Home is arranged by the defaults; nothing has changed yet.');
    const { SurfaceStore, compileSurface, DEFAULT_HOME_SURFACE, applySurfaceOps } = await import('@some-useful-agents/core');
    const store = SurfaceStore.fromHandle(runStore.databaseHandle());
    store.apply('home', [{ op: 'pin', itemId: 'system:scheduler' }], 'user', 'Pinned the scheduler');
    store.apply('home', [{ op: 'setGoal', goal: 'Only failures' }], 'user-conversation', 'You asked sua to focus on failures');
    const out = (await get()).text;
    expect(out.indexOf('v2')).toBeLessThan(out.indexOf('v1'));
    expect(out).toContain('data-surface-restore="1">Undo');
    expect(out).toContain('data-surface-restore="1">Go back to this');
    expect(out).toContain('data-surface-restore="0">Go back to the defaults');
    expect(out).toContain('You, through sua');
    expect(out).toContain('Goal: Only failures');
    expect(out).toContain('Pin: “The scheduler”');

    const { renderToday } = await import('../views/home-surface.js');
    const { render } = await import('../views/html.js');
    const base = { kind: 'alert' as const, urgency: 'high' as const, state: 'open' as const, subject: {}, actions: [], evidence: [], href: '/', provenance: { source: 'runs' as const, producedBy: 'system', at: '2026-10-03T00:00:00Z' } };
    const items = ['a', 'b', 'c'].map((id) => ({ ...base, id: `agent:${id}:failing`, title: id }));
    const doc = applySurfaceOps({ ...DEFAULT_HOME_SURFACE, rules: [] }, [{ op: 'addRule', rule: { id: 'f', type: 'promote', match: { kinds: ['alert'] }, label: 'failures first' } }], 'user');
    const html = render(renderToday({ compiled: compileSurface(doc, items), version: 1, goal: 'g', needsCount: 3, doc, items }, true));
    expect(html.match(/panel-row__why/g)?.length).toBe(1);
  });
});
