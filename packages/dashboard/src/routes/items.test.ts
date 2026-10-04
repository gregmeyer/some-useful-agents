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
    const out = render(renderToday({ compiled: compileSurface(DEFAULT_HOME_SURFACE, items), version: 0, goal: 'g', needsCount: 1 }, true));
    expect(out).toContain('data-panel-thread-id="t1"');
    expect(out).toContain('2 draft agents waiting to be made active');
    expect(out).toContain('data-panel-thread-id="item:agent:a:draft"');
    expect(out).toMatch(/All good:<\/span> Running 2 scheduled agents/);
    expect(rowTarget({ ...items[0], id: 'question:q1', subject: { threadId: 't9' } })).toBe('t9');
  });
});
