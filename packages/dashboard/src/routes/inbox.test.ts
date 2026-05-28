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

  it('renders one sortable table with priority + source badges, high first by default', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'low-pri item', body: 'x' });
    inboxStore.add({ priority: 'high', source: 'run-failure', agentId: 'foo', title: 'high-pri item', body: 'y' });
    inboxStore.add({ priority: 'medium', source: 'permission-request', title: 'med-pri item', body: 'z' });

    const res = await request(app)
      .get('/inbox')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    // Single table, not three sections.
    expect(res.text).toContain('<th>');
    expect((res.text.match(/<table class="table">/g) ?? []).length).toBe(1);
    // Source labels rendered as badges with the right palette.
    expect(res.text).toMatch(/badge badge--warn">Run failure/);
    expect(res.text).toMatch(/badge badge--info">Permission/);
    expect(res.text).toMatch(/badge badge--muted">Cadence/);
    // Default order is priority ASC (high first) by createdAt tiebreaker.
    const hi = res.text.indexOf('high-pri item');
    const med = res.text.indexOf('med-pri item');
    const lo = res.text.indexOf('low-pri item');
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(med);
    expect(med).toBeLessThan(lo);
  });

  it('honours ?sort=source&dir=asc by reordering rows alphabetically', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'low', source: 'run-failure', agentId: 'a', title: 'A1', body: 'x' });
    inboxStore.add({ priority: 'low', source: 'cadence', agentId: 'b', title: 'B1', body: 'y' });
    inboxStore.add({ priority: 'low', source: 'manual', agentId: 'c', title: 'C1', body: 'z' });

    const res = await request(app)
      .get('/inbox?sort=source&dir=asc')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    const cadenceAt = res.text.indexOf('B1');
    const manualAt = res.text.indexOf('C1');
    const runFailureAt = res.text.indexOf('A1');
    // alphabetical by source: cadence, manual, run-failure
    expect(cadenceAt).toBeLessThan(manualAt);
    expect(manualAt).toBeLessThan(runFailureAt);
    // Active column shows ↑ indicator.
    expect(res.text).toMatch(/Source ↑/);
  });

  it('falls back to defaults for unknown sort / dir values', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'high', source: 'run-failure', title: 'high-pri', body: 'x' });
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'low-pri', body: 'y' });
    const res = await request(app)
      .get('/inbox?sort=nope&dir=sideways')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text.indexOf('high-pri')).toBeLessThan(res.text.indexOf('low-pri'));
  });
});

describe('POST /inbox/:id/dismiss', () => {
  it('sets status=dismissed and redirects with an ok flash', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const res = await request(app)
      .post(`/inbox/${m.id}/dismiss`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/inbox\?ok=/);
    expect(inboxStore.get(m.id)!.status).toBe('dismissed');
  });

  it('redirects with an error flash for unknown ids', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/inbox/nope/dismiss')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/inbox\?error=/);
  });
});

describe('POST /inbox/:id/respond', () => {
  it('appends a user response and redirects to the detail page', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const res = await request(app)
      .post(`/inbox/${m.id}/respond`)
      .type('form')
      .send({ body: 'I tried X, still failing.' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(new RegExp(`^/inbox/${m.id}\\?ok=`));
    const responses = inboxStore.listResponses(m.id);
    expect(responses).toHaveLength(1);
    expect(responses[0].role).toBe('user');
    expect(responses[0].body).toBe('I tried X, still failing.');
  });

  it('rejects empty body with an error flash; nothing is stored', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const res = await request(app)
      .post(`/inbox/${m.id}/respond`)
      .type('form')
      .send({ body: '   ' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/error=/);
    expect(inboxStore.listResponses(m.id)).toEqual([]);
  });

  it('rejects oversize body with an error flash', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const oversize = 'x'.repeat(9000);
    const res = await request(app)
      .post(`/inbox/${m.id}/respond`)
      .type('form')
      .send({ body: oversize })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/error=/);
    expect(inboxStore.listResponses(m.id)).toEqual([]);
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
