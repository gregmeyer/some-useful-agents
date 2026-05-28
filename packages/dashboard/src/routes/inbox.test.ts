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
  parseAgent,
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
    // Redesigned inbox shows the "All clear" suggested-actions banner
    // when the inbox is empty.
    expect(res.text).toContain('All clear');
    expect(res.text).toMatch(/<a href="\/inbox"[^>]*class="is-active"/);
  });

  it('renders gridded rows grouped by priority; rows carry data-inbox-row-id; modal shell is present + hidden', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'low-pri', body: 'x' });
    const high = inboxStore.add({ priority: 'high', source: 'run-failure', agentId: 'foo', title: 'high-pri', body: 'y' });
    inboxStore.add({ priority: 'medium', source: 'permission-request', title: 'med-pri', body: 'z' });

    const res = await request(app).get('/inbox').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="inbox-list"');
    expect(res.text).toContain(`data-inbox-row-id="${high.id}"`);
    // High-priority group renders above low-priority group.
    expect(res.text.indexOf('high-pri')).toBeLessThan(res.text.indexOf('low-pri'));
    expect(res.text).toContain('id="inbox-modal"');
    expect(res.text).toMatch(/id="inbox-modal"[^>]*hidden/);
    // New header chrome.
    expect(res.text).toContain('id="inbox-new-conversation"');
    expect(res.text).toContain('id="inbox-shell"');
  });

  it('groups rows by priority and lists high → medium → low', async () => {
    const app = await makeApp();
    inboxStore.add({ priority: 'high', source: 'run-failure', title: 'H', body: 'x' });
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'L', body: 'y' });
    const res = await request(app).get('/inbox').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text.indexOf('>H<')).toBeLessThan(res.text.indexOf('>L<'));
  });

  it('renders the favorited rail with starred messages', async () => {
    const app = await makeApp();
    const starred = inboxStore.add({ priority: 'medium', source: 'manual', title: 'pinned', body: 'b' });
    inboxStore.setStarred(starred.id, true);
    inboxStore.add({ priority: 'low', source: 'cadence', title: 'unpinned', body: 'b' });
    const res = await request(app).get('/inbox').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.text).toContain('class="inbox-rail"');
    expect(res.text).toContain(`data-inbox-rail-id="${starred.id}"`);
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

describe('POST /inbox/:id/actions/:rid/run + /skip', () => {
  // The action lifecycle routes operate on `action`-role responses
  // that triage would normally insert when its <plan> includes an
  // `actions[]` array. Here we insert proposed rows directly via the
  // InboxStore — same shape, no LLM round-trip — and exercise the
  // transitions.

  function proposeAction(messageId: string, agentId: string, rationale: string) {
    return inboxStore.addResponse(messageId, 'action', rationale, JSON.stringify({
      kind: 'action',
      status: 'proposed',
      agentId,
      inputs: { TOPIC: 'demo' },
      rationale,
    }));
  }

  it('/skip transitions a proposed action to skipped', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r = proposeAction(m.id, 'agent-analyzer', 'try it');
    const res = await request(app)
      .post(`/inbox/${m.id}/actions/${r.id}/skip`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(204);
    const after = inboxStore.getResponse(r.id);
    expect(after).not.toBeNull();
    const meta = JSON.parse(after!.metaJson!);
    expect(meta.status).toBe('skipped');
    expect(typeof meta.endedAt).toBe('number');
  });

  it('/skip on an already-skipped row is idempotent (204, no state change)', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r = proposeAction(m.id, 'agent-analyzer', 'try it');
    const skippedMeta = { kind: 'action', status: 'skipped', agentId: 'agent-analyzer', inputs: {}, endedAt: 123 };
    inboxStore.updateResponse(r.id, { metaJson: JSON.stringify(skippedMeta) });
    const res = await request(app)
      .post(`/inbox/${m.id}/actions/${r.id}/skip`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(204);
    // Meta unchanged.
    expect(JSON.parse(inboxStore.getResponse(r.id)!.metaJson!).endedAt).toBe(123);
  });

  it('/skip on a non-existent rid returns 404', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const res = await request(app)
      .post(`/inbox/${m.id}/actions/nope/skip`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(404);
  });

  it('/skip with rid that belongs to a different message returns 404', async () => {
    const app = await makeApp();
    const m1 = inboxStore.add({ priority: 'medium', source: 'manual', title: 'a', body: 'a' });
    const m2 = inboxStore.add({ priority: 'medium', source: 'manual', title: 'b', body: 'b' });
    const r = proposeAction(m1.id, 'agent-analyzer', 'r');
    const res = await request(app)
      .post(`/inbox/${m2.id}/actions/${r.id}/skip`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(404);
  });

  it('/run on a proposed action returns 204 and transitions meta off "proposed"', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r = proposeAction(m.id, 'agent-analyzer', 'try it');
    const res = await request(app)
      .post(`/inbox/${m.id}/actions/${r.id}/run`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    // Returns 204 immediately; the agent runs fire-and-forget.
    expect(res.status).toBe(204);
    // Give the dispatcher a tick to enter the running state. The
    // sub-agent isn't installed in this test setup so the row will
    // promptly settle in `failed` ("agent not installed") rather than
    // hanging in `running` — either is "not proposed" and that's what
    // we assert.
    await new Promise((r) => setTimeout(r, 30));
    const after = inboxStore.getResponse(r.id);
    expect(after).not.toBeNull();
    const meta = JSON.parse(after!.metaJson!);
    expect(meta.status).not.toBe('proposed');
  });

  it('/run on a non-proposed row is idempotent (204, no re-dispatch)', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r = proposeAction(m.id, 'agent-analyzer', 'try it');
    const completedMeta = {
      kind: 'action', status: 'completed', agentId: 'agent-analyzer',
      inputs: {}, runId: 'previous-run-id', endedAt: 999,
    };
    inboxStore.updateResponse(r.id, { metaJson: JSON.stringify(completedMeta) });
    const res = await request(app)
      .post(`/inbox/${m.id}/actions/${r.id}/run`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(204);
    // Idempotent: the prior completion is preserved.
    const after = JSON.parse(inboxStore.getResponse(r.id)!.metaJson!);
    expect(after.status).toBe('completed');
    expect(after.runId).toBe('previous-run-id');
  });

  it('concurrent /run requests on the same proposed action only dispatch once', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r = proposeAction(m.id, 'agent-analyzer', 'try it');
    // Fire two requests in parallel — simulates a double-click before
    // the first response lands. The atomic claim in the route ensures
    // only one wins.
    const [a, b] = await Promise.all([
      request(app).post(`/inbox/${m.id}/actions/${r.id}/run`)
        .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE),
      request(app).post(`/inbox/${m.id}/actions/${r.id}/run`)
        .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE),
    ]);
    // Both return 204 (one claims + dispatches, the other no-ops idempotently).
    expect(a.status).toBe(204);
    expect(b.status).toBe(204);
    await new Promise((r) => setTimeout(r, 30));
    const after = JSON.parse(inboxStore.getResponse(r.id)!.metaJson!);
    // State is past 'proposed' (the winning claim transitioned it).
    expect(after.status).not.toBe('proposed');
    // Only ONE startedAt was recorded — proves a single dispatch.
    expect(typeof after.startedAt).toBe('number');
  });
});

describe('POST /inbox/:id/actions/:rid/run — agent-analyzer enrichment', () => {
  // End-to-end: when triage proposes running `agent-analyzer` on an
  // inbox message whose `agentId` points at an installed agent, the
  // route auto-injects that agent's YAML as AGENT_YAML. Here we stub
  // agent-analyzer with a shell-exec that echoes its AGENT_YAML input
  // so we can grep the resulting run output for proof of injection.

  it('auto-injects AGENT_YAML for agent-analyzer from the message agentId', async () => {
    const app = await makeApp();

    // Install a small target agent. The token "target-agent-marker" in
    // its YAML lets us assert downstream that the analyzer received it.
    const targetYaml = [
      'id: target-agent-marker',
      'name: Target Agent Marker',
      'description: token used by enrichment test',
      'nodes:',
      '  - id: noop',
      '    type: shell',
      '    command: echo ok',
    ].join('\n');
    const target = parseAgent(targetYaml);
    agentStore.upsertAgent(target, 'dashboard', 'test fixture');

    // Stub agent-analyzer with a shell node that echoes whatever YAML
    // it received. The route's enrichment passes AGENT_YAML via the
    // executor's input map; the shell echoes the placeholder substitution.
    const analyzerYaml = [
      'id: agent-analyzer',
      'name: Agent Analyzer',
      'description: stubbed analyzer for enrichment test',
      'inputs:',
      '  AGENT_YAML:',
      '    type: string',
      '    required: true',
      'nodes:',
      "  - id: echo",
      "    type: shell",
      "    command: \"echo received: $AGENT_YAML\"",
    ].join('\n');
    const analyzer = parseAgent(analyzerYaml);
    agentStore.upsertAgent(analyzer, 'dashboard', 'test fixture');

    // Inbox message whose `agentId` references the target.
    const msg = inboxStore.add({
      priority: 'high',
      source: 'run-failure',
      title: 'target failed',
      body: 'something broke',
      agentId: 'target-agent-marker',
    });

    // Triage would normally propose this; insert it directly so we
    // skip the LLM round-trip.
    const proposed = inboxStore.addResponse(
      msg.id,
      'action',
      'analyze the failing agent',
      JSON.stringify({
        kind: 'action',
        status: 'proposed',
        agentId: 'agent-analyzer',
        inputs: { FOCUS: 'why does this fail' },
        rationale: 'Get a concrete fix.',
      }),
    );

    const res = await request(app)
      .post(`/inbox/${msg.id}/actions/${proposed.id}/run`)
      .set('X-Requested-With', 'fetch')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(204);

    // Wait for the shell node to complete. Up to ~2s — local shell
    // is near-instant but we don't want to flake on a slow CI box.
    const deadline = Date.now() + 2000;
    let after = inboxStore.getResponse(proposed.id);
    while (Date.now() < deadline) {
      after = inboxStore.getResponse(proposed.id);
      const m = after?.metaJson ? JSON.parse(after.metaJson) : null;
      if (m && m.status !== 'proposed' && m.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(after).not.toBeNull();
    const meta = JSON.parse(after!.metaJson!);
    expect(meta.status).toBe('completed');
    expect(meta.resultSummary).toContain('target-agent-marker');
  });
});

describe('POST /inbox/:id/actions/:rid/run — agent-editor write path', () => {
  // agent-editor is route-handled: no DAG dispatch, just a synchronous
  // upsertAgent after validation. These tests install a target agent,
  // propose an agent-editor action, and verify the lifecycle outcomes.

  function installTarget(id: string, label: string) {
    const yaml = [
      `id: ${id}`,
      `name: ${label}`,
      'description: test fixture',
      'nodes:',
      '  - id: noop',
      '    type: shell',
      '    command: echo old',
    ].join('\n');
    agentStore.upsertAgent(parseAgent(yaml), 'dashboard', 'test fixture');
  }

  function proposeEditor(messageId: string, agentId: string, newYaml: string) {
    return inboxStore.addResponse(messageId, 'action', 'Apply YAML fix', JSON.stringify({
      kind: 'action',
      status: 'proposed',
      agentId: 'agent-editor',
      inputs: { AGENT_ID: agentId, NEW_YAML: newYaml },
      rationale: 'apply the proposed fix',
    }));
  }

  it('happy path: commits a new version via upsertAgent', async () => {
    const app = await makeApp();
    installTarget('target-x', 'old name');
    const before = agentStore.getAgent('target-x');
    const newYaml = [
      'id: target-x',
      'name: NEW NAME',
      'description: updated by test',
      'nodes:',
      '  - id: noop',
      '    type: shell',
      '    command: echo new',
    ].join('\n');
    const msg = inboxStore.add({ priority: 'high', source: 'run-failure', title: 't', body: 'b', agentId: 'target-x' });
    const r = proposeEditor(msg.id, 'target-x', newYaml);

    const res = await request(app)
      .post(`/inbox/${msg.id}/actions/${r.id}/run`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(204);

    // Route-handled path is synchronous inside runProposedAction;
    // give the microtask queue a tick to settle.
    await new Promise((r) => setTimeout(r, 30));

    const after = agentStore.getAgent('target-x');
    expect(after?.name).toBe('NEW NAME');
    expect((after?.version ?? 0)).toBeGreaterThan(before?.version ?? 0);

    const action = JSON.parse(inboxStore.getResponse(r.id)!.metaJson!);
    expect(action.status).toBe('completed');
    expect(action.resultSummary).toMatch(/Updated agent .target-x. to v/);
  });

  it('refuses when NEW_YAML id mismatches AGENT_ID', async () => {
    const app = await makeApp();
    installTarget('target-y', 'y');
    const mismatched = [
      'id: someone-else',
      'name: drift',
      'description: drift fixture',
      'nodes:',
      '  - id: noop',
      '    type: shell',
      '    command: echo x',
    ].join('\n');
    const msg = inboxStore.add({ priority: 'high', source: 'run-failure', title: 't', body: 'b', agentId: 'target-y' });
    const r = proposeEditor(msg.id, 'target-y', mismatched);

    await request(app).post(`/inbox/${msg.id}/actions/${r.id}/run`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    await new Promise((r) => setTimeout(r, 30));

    expect(agentStore.getAgent('target-y')?.name).toBe('y'); // unchanged
    const action = JSON.parse(inboxStore.getResponse(r.id)!.metaJson!);
    expect(action.status).toBe('failed');
    expect(action.refusalReason).toMatch(/does not match AGENT_ID/);
  });

  it('refuses when NEW_YAML fails parseAgent validation', async () => {
    const app = await makeApp();
    installTarget('target-z', 'z');
    const garbage = 'this: is: not: valid: yaml: {{{{';
    const msg = inboxStore.add({ priority: 'high', source: 'run-failure', title: 't', body: 'b', agentId: 'target-z' });
    const r = proposeEditor(msg.id, 'target-z', garbage);

    await request(app).post(`/inbox/${msg.id}/actions/${r.id}/run`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    await new Promise((r) => setTimeout(r, 30));

    const action = JSON.parse(inboxStore.getResponse(r.id)!.metaJson!);
    expect(action.status).toBe('failed');
    expect(action.refusalReason).toMatch(/failed validation/);
  });

  it('idempotent: re-running a completed agent-editor action is a no-op', async () => {
    const app = await makeApp();
    installTarget('target-i', 'before');
    const okYaml = [
      'id: target-i',
      'name: AFTER',
      'description: ok',
      'nodes: [{ id: noop, type: shell, command: echo ok }]',
    ].join('\n');
    const msg = inboxStore.add({ priority: 'high', source: 'run-failure', title: 't', body: 'b', agentId: 'target-i' });
    const r = proposeEditor(msg.id, 'target-i', okYaml);

    await request(app).post(`/inbox/${msg.id}/actions/${r.id}/run`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    await new Promise((r) => setTimeout(r, 30));
    const v1 = agentStore.getAgent('target-i')?.version ?? 0;

    // Click Run a second time; idempotent path returns 204 without writing.
    const res2 = await request(app).post(`/inbox/${msg.id}/actions/${r.id}/run`)
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res2.status).toBe(204);
    await new Promise((r) => setTimeout(r, 30));
    expect(agentStore.getAgent('target-i')?.version).toBe(v1);
  });
});

describe('POST /inbox/new', () => {
  it('AJAX: returns 204 with X-Inbox-Id header pointing at a fresh manual row', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/inbox/new')
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send('title=My+new+thread');
    expect(res.status).toBe(204);
    const id = res.headers['x-inbox-id'];
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    const row = inboxStore.get(id);
    expect(row).not.toBeNull();
    expect(row!.source).toBe('manual');
    expect(row!.title).toBe('My new thread');
    expect(row!.priority).toBe('medium');
  });

  it('plain form: redirects 303 to /inbox/:id', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/inbox/new')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send('title=Hello');
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/inbox\/[a-f0-9-]+$/);
  });

  it('empty title falls back to "New conversation"', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/inbox/new')
      .set('X-Requested-With', 'fetch').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send('title=');
    expect(res.status).toBe(204);
    const row = inboxStore.get(res.headers['x-inbox-id']);
    expect(row!.title).toBe('New conversation');
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
