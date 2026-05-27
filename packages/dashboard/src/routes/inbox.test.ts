/**
 * Smoke tests for the Inbox routes (PR 2 of the Inbox MVP). The store
 * itself is unit-tested in core; these check that the routes wire the
 * store + views correctly and that the top nav highlights the page.
 */

import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  InboxStore,
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
const PORT = 3993;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let inboxStore: InboxStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-inbox-routes-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  inboxStore = new InboxStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

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
    inboxStore,
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
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
  try { inboxStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('GET /inbox', () => {
  it('renders an empty state when no messages exist', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/inbox')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Inbox');
    expect(res.text).toContain('Inbox zero');
    // Top nav highlights /inbox.
    expect(res.text).toMatch(/<a href="\/inbox"[^>]*class="is-active"/);
  });

  it('groups messages by priority newest-first', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'low-pri item', body: 'x' });
    inboxStore.add({ priority: 'high', source: 'run-failure', agentId: 'foo', title: 'high-pri item', body: 'y' });
    inboxStore.add({ priority: 'medium', source: 'permission-request', title: 'med-pri item', body: 'z' });

    const res = await request(app)
      .get('/inbox')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('High');
    expect(res.text).toContain('Medium');
    expect(res.text).toContain('Low');
    // High section must appear before Medium and Low in the HTML stream.
    const hi = res.text.indexOf('high-pri item');
    const med = res.text.indexOf('med-pri item');
    const lo = res.text.indexOf('low-pri item');
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(med);
    expect(med).toBeLessThan(lo);
  });
});

describe('GET /inbox/:id', () => {
  it('renders the message detail page', async () => {
    const app = await makeApp();
    const m = inboxStore.add({
      priority: 'high',
      source: 'run-failure',
      agentId: 'astro',
      runId: 'run-abc',
      title: 'Detail title',
      body: 'Detail body markdown.',
      contextJson: JSON.stringify({ exit: 1 }),
    });
    const res = await request(app)
      .get(`/inbox/${m.id}`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Detail title');
    expect(res.text).toContain('Detail body markdown.');
    expect(res.text).toContain('Context payload');
    expect(res.text).toContain('/agents/astro');
    expect(res.text).toContain('/runs/run-abc');
    expect(res.text).toMatch(/<a href="\/inbox"[^>]*class="is-active"/);
  });

  it('renders 404 for an unknown message id', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/inbox/no-such-id')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(404);
  });
});
