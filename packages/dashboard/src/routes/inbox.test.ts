/**
 * Smoke + integration tests for the Inbox routes. Covers:
 *   - GET /inbox (single sortable table with default + custom sort)
 *   - GET /inbox/:id (full page)
 *   - GET /inbox/:id/fragment (modal-only inner HTML)
 *   - POST /inbox/:id/dismiss + /respond + /triage (both 303 redirect
 *     and 204 AJAX response modes)
 *   - empty-body / oversize-body rejection on /respond
 *
 * The triage agent run path itself is not exercised end-to-end here
 * (it requires the LLM provider). The route's plan-parsing helpers
 * are covered by unit tests on extractPlanJson upstream.
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
    const res = await request(app).get('/inbox').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Inbox zero');
    expect(res.text).toMatch(/<a href="\/inbox"[^>]*class="is-active"/);
  });

  it('renders one sortable table; rows carry data-inbox-row-id for modal hookup', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'low-pri', body: 'x' });
    const high = inboxStore.add({ priority: 'high', source: 'run-failure', agentId: 'foo', title: 'high-pri', body: 'y' });
    inboxStore.add({ priority: 'medium', source: 'permission-request', title: 'med-pri', body: 'z' });

    const res = await request(app).get('/inbox').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect((res.text.match(/<table class="table inbox-table">/g) ?? []).length).toBe(1);
    expect(res.text).toContain(`data-inbox-row-id="${high.id}"`);
    // Default sort: high first, low last.
    const hi = res.text.indexOf('high-pri');
    const lo = res.text.indexOf('low-pri');
    expect(hi).toBeLessThan(lo);
    // Modal shell present + hidden by default.
    expect(res.text).toContain('id="inbox-modal"');
    expect(res.text).toMatch(/id="inbox-modal"[^>]*hidden/);
  });

  it('honours ?sort=source&dir=asc', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'low', source: 'run-failure', title: 'R', body: 'x' });
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'C', body: 'y' });
    const res = await request(app).get('/inbox?sort=source&dir=asc').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text.indexOf('>C<')).toBeLessThan(res.text.indexOf('>R<'));
    expect(res.text).toMatch(/Source ↑/);
  });

  it('falls back to defaults for unknown sort / dir', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'high', source: 'run-failure', title: 'H', body: 'x' });
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'L', body: 'y' });
    const res = await request(app).get('/inbox?sort=nope&dir=sideways').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text.indexOf('>H<')).toBeLessThan(res.text.indexOf('>L<'));
  });
});

describe('GET /inbox/:id and /:id/fragment', () => {
  it('full page renders the detail with badge + body + actions', async () => {
    const app = await makeApp();
    const m = inboxStore.add({
      priority: 'high', source: 'run-failure', agentId: 'astro', runId: 'run-xyz',
      title: 'Detail title', body: 'Detail body markdown.', contextJson: JSON.stringify({ exit: 1 }),
    });
    const res = await request(app).get(`/inbox/${m.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Detail title');
    expect(res.text).toContain('Detail body markdown.');
    expect(res.text).toContain('Context payload');
    expect(res.text).toContain('/agents/astro');
    expect(res.text).toContain('/runs/run-xyz');
    // Action affordances + form attributes for the modal JS.
    expect(res.text).toContain('data-inbox-modal-form');
    expect(res.text).toContain(`action="/inbox/${m.id}/respond"`);
    expect(res.text).toContain(`action="/inbox/${m.id}/dismiss"`);
    expect(res.text).toContain(`action="/inbox/${m.id}/triage"`);
  });

  it('fragment renders just the inner HTML (no layout / no <html>)', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 'Frag', body: 'fb' });
    const res = await request(app).get(`/inbox/${m.id}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Frag');
    expect(res.text).not.toContain('<html');
    expect(res.text).not.toContain('topbar__nav');
    expect(res.text).toContain('id="inbox-modal-title"');
  });

  it('renders 404 fragments without layout chrome for unknown ids', async () => {
    const app = await makeApp();
    const res = await request(app).get('/inbox/nope/fragment').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<html');
  });
});

describe('POST /inbox/:id/dismiss', () => {
  it('303 redirects for plain form posts', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const res = await request(app).post(`/inbox/${m.id}/dismiss`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/inbox\?ok=/);
    expect(inboxStore.get(m.id)!.status).toBe('dismissed');
  });

  it('204 with no body for fetch-style AJAX (X-Requested-With: fetch)', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const res = await request(app)
      .post(`/inbox/${m.id}/dismiss`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .set('X-Requested-With', 'fetch');
    expect(res.status).toBe(204);
    expect(inboxStore.get(m.id)!.status).toBe('dismissed');
  });

  it('404 (AJAX) / 303 with error (form) for unknown ids', async () => {
    const app = await makeApp();
    const r1 = await request(app).post('/inbox/nope/dismiss').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r1.status).toBe(303);
    expect(r1.headers.location).toMatch(/error=/);
    const r2 = await request(app).post('/inbox/nope/dismiss').set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r2.status).toBe(404);
  });
});

describe('POST /inbox/:id/respond', () => {
  it('appends a user response; 303 for form, 204 for AJAX', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const form = await request(app)
      .post(`/inbox/${m.id}/respond`)
      .type('form').send({ body: 'tried X' })
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(form.status).toBe(303);
    expect(form.headers.location).toMatch(new RegExp(`^/inbox/${m.id}\\?ok=`));

    const ajax = await request(app)
      .post(`/inbox/${m.id}/respond`)
      .type('form').send({ body: 'second reply' })
      .set('X-Requested-With', 'fetch')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(ajax.status).toBe(204);

    const responses = inboxStore.listResponses(m.id);
    expect(responses.map((r) => r.body)).toEqual(['tried X', 'second reply']);
    expect(responses.every((r) => r.role === 'user')).toBe(true);
  });

  it('rejects empty body (303 with error / 400 for AJAX); nothing stored', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const form = await request(app)
      .post(`/inbox/${m.id}/respond`).type('form').send({ body: '   ' })
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(form.status).toBe(303);
    expect(form.headers.location).toMatch(/error=/);
    const ajax = await request(app)
      .post(`/inbox/${m.id}/respond`).type('form').send({ body: '' })
      .set('X-Requested-With', 'fetch')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(ajax.status).toBe(400);
    expect(inboxStore.listResponses(m.id)).toEqual([]);
  });

  it('rejects oversize body', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const big = 'x'.repeat(9000);
    const res = await request(app)
      .post(`/inbox/${m.id}/respond`).type('form').send({ body: big })
      .set('X-Requested-With', 'fetch')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(400);
    expect(inboxStore.listResponses(m.id)).toEqual([]);
  });
});

describe('POST /inbox/:id/triage', () => {
  it('returns 204 (AJAX) for known ids — fire-and-forget; agent run kicked off in background', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const res = await request(app)
      .post(`/inbox/${m.id}/triage`)
      .set('X-Requested-With', 'fetch')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(204);
  });

  it('404 (AJAX) / 303 (form) for unknown ids', async () => {
    const app = await makeApp();
    const r1 = await request(app).post('/inbox/nope/triage').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r1.status).toBe(303);
    const r2 = await request(app).post('/inbox/nope/triage').set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r2.status).toBe(404);
  });
});
