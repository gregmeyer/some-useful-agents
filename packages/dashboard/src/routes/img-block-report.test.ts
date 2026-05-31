/**
 * Tests for the img-block-report endpoints. The store unit-tests live in
 * core; this verifies the routing + validation + integration with the
 * existing allow-host handler clears the matching entry.
 */

import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  BlockedImgHostsStore,
  LocalProvider,
  MemorySecretsStore,
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
let blockedImgHostsStore: BlockedImgHostsStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-img-block-report-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  blockedImgHostsStore = new BlockedImgHostsStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  agentStore.createAgent({
    id: 'astro',
    name: 'Astro',
    status: 'active',
    source: 'local',
    mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    signal: { title: 'Astro', template: 'text-headline', mapping: { headline: 'result' } },
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
    blockedImgHostsStore,
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
  try { blockedImgHostsStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/img-block-report', () => {
  it('records a valid agent/host pair', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/img-block-report')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({ agentId: 'astro', host: 'apod.nasa.gov' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, recorded: true });
    const stored = blockedImgHostsStore.listForAgent('astro');
    expect(stored).toHaveLength(1);
    expect(stored[0].host).toBe('apod.nasa.gov');
  });

  it('400s when fields are missing', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/img-block-report')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({});
    expect(res.status).toBe(400);
  });

  it('accepts an invalid host but does not record', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/img-block-report')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({ agentId: 'astro', host: 'not-a-host' });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(false);
    expect(blockedImgHostsStore.listForAgent('astro')).toHaveLength(0);
  });

  it('rejects malformed agentId via the route validator', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/api/img-block-report')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({ agentId: '../etc/passwd', host: 'apod.nasa.gov' });
    expect(res.status).toBe(400);
    expect(blockedImgHostsStore.listForAgent('../etc/passwd')).toHaveLength(0);
  });
});

describe('GET /api/img-blocks/:agentId', () => {
  it('returns recent blocks for an agent', async () => {
    const app = await makeApp();
    blockedImgHostsStore.record('astro', 'a.example.com');
    blockedImgHostsStore.record('astro', 'b.example.com');
    const res = await request(app)
      .get('/api/img-blocks/astro')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.blocks.map((b: { host: string }) => b.host).sort()).toEqual(['a.example.com', 'b.example.com']);
  });

  it('returns empty list when no blocks recorded', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/api/img-blocks/astro')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body.blocks).toEqual([]);
  });
});

describe('POST /api/img-blocks/:agentId/dismiss', () => {
  it('clears all blocks for an agent', async () => {
    const app = await makeApp();
    blockedImgHostsStore.record('astro', 'a.example.com');
    blockedImgHostsStore.record('astro', 'b.example.com');
    const res = await request(app)
      .post('/api/img-blocks/astro/dismiss')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(blockedImgHostsStore.listForAgent('astro')).toEqual([]);
  });
});

describe('allow-host integration', () => {
  it('clears the matching blocked-host entry when the host is allowed', async () => {
    const app = await makeApp();
    blockedImgHostsStore.record('astro', 'apod.nasa.gov');
    expect(blockedImgHostsStore.listForAgent('astro')).toHaveLength(1);

    const res = await request(app)
      .post('/agents/astro/permissions/allow-host')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({ host: 'apod.nasa.gov' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.imgSrc).toContain('apod.nasa.gov');
    // Cleanup hook removed the suggestion now that the host is allowed.
    expect(blockedImgHostsStore.listForAgent('astro')).toEqual([]);
  });
});
