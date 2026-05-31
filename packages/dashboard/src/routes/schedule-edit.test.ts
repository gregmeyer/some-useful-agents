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
const PORT = 3995;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp(opts: { schedule?: string; allowHighFrequency?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'sua-schedule-edit-'));
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

describe('POST /agents/:id/schedule', () => {
  it('sets a valid 5-field cron expression', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '0 8 * * *' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Schedule%20set');
    expect(agentStore.getAgent('sched-agent')!.schedule).toBe('0 8 * * *');
  });

  it('clears the schedule when given an empty string', async () => {
    const app = await makeApp({ schedule: '0 8 * * *' });
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Schedule%20cleared');
    expect(agentStore.getAgent('sched-agent')!.schedule).toBeUndefined();
  });

  it('reports unchanged when the same schedule is submitted', async () => {
    const app = await makeApp({ schedule: '0 8 * * *' });
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '0 8 * * *' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Schedule%20unchanged');
  });

  it('rejects invalid cron with a helpful message', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: 'totally bogus' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/not%20a%20valid%20cron/i);
    expect(agentStore.getAgent('sched-agent')!.schedule).toBeUndefined();
  });

  it('rejects sub-minute (6-field) schedules unless allowHighFrequency is set', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '*/30 * * * * *' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/sub-minute|allowHighFrequency/i);
    expect(agentStore.getAgent('sched-agent')!.schedule).toBeUndefined();
  });

  it('accepts sub-minute schedules when allowHighFrequency is true', async () => {
    const app = await makeApp({ allowHighFrequency: true });
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '*/30 * * * * *' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Schedule%20set');
    expect(agentStore.getAgent('sched-agent')!.schedule).toBe('*/30 * * * * *');
  });

  it('returns 404 for unknown agent ids', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/nope/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '0 8 * * *' });
    // 404 → redirect to /agents per the existing pattern.
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/agents');
  });
});

describe('POST /agents/:id/permissions', () => {
  it('accepts a newline-separated list of valid hosts and bumps the agent version', async () => {
    const app = await makeApp();
    const initial = agentStore.getAgent('sched-agent')!.version;
    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: 'images.unsplash.com\n*.unsplash.com' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('img-src%20updated');
    const after = agentStore.getAgent('sched-agent')!;
    expect(after.permissions?.imgSrc).toEqual(['images.unsplash.com', '*.unsplash.com']);
    expect(after.version).toBe(initial + 1);
  });

  it('strips https:// + paths + ports so users can paste full URLs', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: 'https://images.unsplash.com/foo/bar, http://other.example.com:8080/x' });
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('sched-agent')!.permissions?.imgSrc).toEqual([
      'images.unsplash.com',
      'other.example.com',
    ]);
  });

  it('rejects malformed hosts with a flash message and leaves the agent unchanged', async () => {
    const app = await makeApp();
    const before = agentStore.getAgent('sched-agent')!.version;
    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: 'bad_host_with_underscore' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/Invalid%20host/);
    expect(agentStore.getAgent('sched-agent')!.version).toBe(before);
  });

  it('clears imgSrc when given an empty list', async () => {
    const app = await makeApp();
    // Seed permissions first.
    await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: 'images.unsplash.com' });
    expect(agentStore.getAgent('sched-agent')!.permissions?.imgSrc).toEqual(['images.unsplash.com']);

    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: '' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('cleared');
    expect(agentStore.getAgent('sched-agent')!.permissions).toBeUndefined();
  });
});
