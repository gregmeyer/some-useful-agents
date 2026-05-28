/**
 * Inbox routes — covers the sortable grid, fragment renderer, modal
 * mutation routes (dual 204/303 mode), and the pending-state
 * derivation that drives the modal's polling loop.
 *
 * Triage agent end-to-end requires an LLM provider; the route is
 * verified to kick off (and to add a synthetic user marker when
 * invoked explicitly) but the agent's run isn't asserted here.
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
  it('renders empty state when no messages exist', async () => {
    const app = await makeApp();
    const res = await request(app).get('/inbox').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Inbox zero');
    expect(res.text).toMatch(/<a href="\/inbox"[^>]*class="is-active"/);
  });

  it('renders one sortable table; rows carry data-inbox-row-id; modal shell is present + hidden', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'low-pri', body: 'x' });
    const high = inboxStore.add({ priority: 'high', source: 'run-failure', agentId: 'foo', title: 'high-pri', body: 'y' });
    inboxStore.add({ priority: 'medium', source: 'permission-request', title: 'med-pri', body: 'z' });

    const res = await request(app).get('/inbox').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect((res.text.match(/<table class="table inbox-table">/g) ?? []).length).toBe(1);
    expect(res.text).toContain(`data-inbox-row-id="${high.id}"`);
    expect(res.text.indexOf('high-pri')).toBeLessThan(res.text.indexOf('low-pri'));
    expect(res.text).toContain('id="inbox-modal"');
    expect(res.text).toMatch(/id="inbox-modal"[^>]*hidden/);
  });

  it('honours ?sort=source&dir=asc and shows the ↑ indicator on the active column', async () => {
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
    expect(res.text.indexOf('>H<')).toBeLessThan(res.text.indexOf('>L<'));
  });
});

describe('GET /inbox/:id and /:id/fragment', () => {
  it('full-page render includes badges, body, and the action forms', async () => {
    const app = await makeApp();
    const m = inboxStore.add({
      priority: 'high', source: 'run-failure', agentId: 'astro', runId: 'run-xyz',
      title: 'Detail title', body: 'Detail body.', contextJson: JSON.stringify({ exit: 1 }),
    });
    const res = await request(app).get(`/inbox/${m.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Detail title');
    expect(res.text).toContain(`action="/inbox/${m.id}/respond"`);
    expect(res.text).toContain(`action="/inbox/${m.id}/dismiss"`);
    expect(res.text).toContain(`action="/inbox/${m.id}/triage"`);
  });

  it('fragment is inner HTML only (no <html>, no top-nav)', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 'Frag', body: 'fb' });
    const res = await request(app).get(`/inbox/${m.id}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Frag');
    expect(res.text).not.toContain('<html');
    expect(res.text).not.toContain('topbar__nav');
    expect(res.text).toContain('id="inbox-modal-title"');
  });

  it('renders conversation entries with data-msg-id + role avatars', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r1 = inboxStore.addResponse(m.id, 'user', 'first reply');
    const res = await request(app).get(`/inbox/${m.id}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).toContain(`data-msg-id="${r1.id}"`);
    expect(res.text).toContain('inbox-msg__avatar--user');
    expect(res.text).toContain('first reply');
  });

  it('renders the thinking indicator when the most recent response is a recent user reply', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    inboxStore.addResponse(m.id, 'user', 'just posted');
    const res = await request(app).get(`/inbox/${m.id}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).toContain('data-triage-pending="1"');
    expect(res.text).toContain('inbox-thinking');
  });

  it('does NOT render the thinking indicator when the most recent response is from triage', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    inboxStore.addResponse(m.id, 'user', 'q');
    inboxStore.addResponse(m.id, 'triage', 'here is what to do');
    const res = await request(app).get(`/inbox/${m.id}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).not.toContain('data-triage-pending="1"');
  });

  it('returns 404 fragments without layout chrome', async () => {
    const app = await makeApp();
    const res = await request(app).get('/inbox/nope/fragment').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<html');
  });
});

describe('POST /inbox/:id/dismiss', () => {
  it('303 for plain form, 204 for fetch', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const form = await request(app).post(`/inbox/${m.id}/dismiss`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(form.status).toBe(303);
    expect(form.headers.location).toMatch(/^\/inbox\?ok=/);
    expect(inboxStore.get(m.id)!.status).toBe('dismissed');

    const m2 = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const ajax = await request(app).post(`/inbox/${m2.id}/dismiss`).set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(ajax.status).toBe(204);
    expect(inboxStore.get(m2.id)!.status).toBe('dismissed');
  });

  it('404 (AJAX) / 303 with error (form) for unknown ids', async () => {
    const app = await makeApp();
    const r1 = await request(app).post('/inbox/nope/dismiss').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r1.status).toBe(303);
    const r2 = await request(app).post('/inbox/nope/dismiss').set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r2.status).toBe(404);
  });
});

describe('POST /inbox/:id/respond', () => {
  it('appends a user response; 303 for form, 204 for AJAX', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const form = await request(app)
      .post(`/inbox/${m.id}/respond`).type('form').send({ body: 'tried X' })
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(form.status).toBe(303);
    expect(form.headers.location).toMatch(new RegExp(`^/inbox/${m.id}\\?ok=`));

    const ajax = await request(app)
      .post(`/inbox/${m.id}/respond`).type('form').send({ body: 'second' })
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(ajax.status).toBe(204);

    const responses = inboxStore.listResponses(m.id);
    expect(responses.length).toBeGreaterThanOrEqual(2);
    const userReplies = responses.filter((r) => r.role === 'user');
    expect(userReplies.map((r) => r.body)).toEqual(['tried X', 'second']);
  });

  it('rejects empty and oversize bodies', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const empty = await request(app)
      .post(`/inbox/${m.id}/respond`).type('form').send({ body: '   ' })
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(empty.status).toBe(400);
    const big = await request(app)
      .post(`/inbox/${m.id}/respond`).type('form').send({ body: 'x'.repeat(9000) })
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(big.status).toBe(400);
    expect(inboxStore.listResponses(m.id)).toEqual([]);
  });
});

describe('GET /inbox with filters', () => {
  it('filters by ?starred=1', async () => {
    const app = await makeApp();
    const a = inboxStore.add({ priority: 'medium', source: 'manual', title: 'starred-msg', body: 'x' });
    inboxStore.add({ priority: 'medium', source: 'manual', title: 'plain-msg', body: 'y' });
    inboxStore.setStarred(a.id, true);
    const res = await request(app).get('/inbox?starred=1').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('starred-msg');
    expect(res.text).not.toContain('plain-msg');
  });

  it('filters by ?tag=auth (exact match, not substring)', async () => {
    const app = await makeApp();
    const a = inboxStore.add({ priority: 'medium', source: 'manual', title: 'auth-msg', body: 'x' });
    const b = inboxStore.add({ priority: 'medium', source: 'manual', title: 'authentication-msg', body: 'y' });
    inboxStore.setTags(a.id, ['auth']);
    inboxStore.setTags(b.id, ['authentication']);
    const res = await request(app).get('/inbox?tag=auth').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).toContain('auth-msg');
    expect(res.text).not.toContain('authentication-msg');
  });

  it('filters by ?q across title/body/agent/conversation', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'medium', source: 'manual', title: 'apple-fruit', body: 'fruit' });
    const c = inboxStore.add({ priority: 'medium', source: 'manual', title: 'cherry-fruit', body: 'red' });
    inboxStore.addResponse(c.id, 'triage', 'mentions apple in the thread');
    const res = await request(app).get('/inbox?q=apple').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).toContain('apple-fruit');
    expect(res.text).toContain('cherry-fruit');
  });

  it('renders the filter bar with current values and a Clear link', async () => {
    const app = await makeApp();
    const res = await request(app).get('/inbox?q=hello').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).toContain('class="inbox-filter"');
    expect(res.text).toContain('value="hello"');
    expect(res.text).toMatch(/href="\/inbox"[^>]*>Clear</);
  });
});

describe('POST /inbox/:id/star', () => {
  it('toggles + persists; 204 (AJAX) / 303 (form)', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r1 = await request(app)
      .post(`/inbox/${m.id}/star`).type('form').send({ starred: '1' })
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r1.status).toBe(204);
    expect(inboxStore.get(m.id)!.starred).toBe(true);
    const r2 = await request(app)
      .post(`/inbox/${m.id}/star`).type('form').send({ starred: '0' })
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r2.status).toBe(303);
    expect(inboxStore.get(m.id)!.starred).toBe(false);
  });

  it('omitting starred flips current value', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    inboxStore.setStarred(m.id, true);
    await request(app).post(`/inbox/${m.id}/star`).set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(inboxStore.get(m.id)!.starred).toBe(false);
  });
});

describe('POST /inbox/:id/tags', () => {
  it('comma-separated input is normalized (lowercase, dedupe, drop invalid)', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    await request(app)
      .post(`/inbox/${m.id}/tags`).type('form').send({ tags: 'Auth, NETWORK, invalid tag, auth' })
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(inboxStore.get(m.id)!.tags).toEqual(['auth', 'network']);
  });

  it('empty input clears all tags', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    inboxStore.setTags(m.id, ['auth']);
    await request(app)
      .post(`/inbox/${m.id}/tags`).type('form').send({ tags: '' })
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(inboxStore.get(m.id)!.tags).toEqual([]);
  });
});

describe('Row + fragment rendering for star + tags', () => {
  it('list row renders the star button + tag chips', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', agentId: 'foo', title: 't', body: 'b' });
    inboxStore.setStarred(m.id, true);
    inboxStore.setTags(m.id, ['auth', 'network']);
    const res = await request(app).get('/inbox').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).toContain('inbox-star inbox-star--on');
    expect(res.text).toContain('inbox-tag-chip');
  });

  it('modal fragment renders sticky header, star button, and tag editor input', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 'frag', body: 'b' });
    inboxStore.setTags(m.id, ['auth']);
    const res = await request(app).get(`/inbox/${m.id}/fragment`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).toContain('inbox-detail__header');
    expect(res.text).toContain('inbox-detail__thread');
    expect(res.text).toContain(`action="/inbox/${m.id}/star"`);
    expect(res.text).toContain(`action="/inbox/${m.id}/tags"`);
    expect(res.text).toContain('value="auth"');
  });
});

describe('POST /inbox/:id/triage', () => {
  it('returns 204 (AJAX) and inserts a synthetic "Asked triage" user marker', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const res = await request(app).post(`/inbox/${m.id}/triage`).set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(204);
    const responses = inboxStore.listResponses(m.id);
    expect(responses.length).toBeGreaterThanOrEqual(1);
    expect(responses[0].role).toBe('user');
    expect(responses[0].body).toContain('Asked triage');
  });

  it('404 (AJAX) / 303 (form) for unknown ids', async () => {
    const app = await makeApp();
    const r1 = await request(app).post('/inbox/nope/triage').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r1.status).toBe(303);
    const r2 = await request(app).post('/inbox/nope/triage').set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(r2.status).toBe(404);
  });
});
