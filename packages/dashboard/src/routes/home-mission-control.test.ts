/**
 * Mission Control home (`/`) + the global inbox badge count endpoint.
 * Verifies the unified front door (editable board + collapsed activity + the
 * inbox-first Ask-sua CTA) and that /inbox/needs-you-count drives the global
 * top-bar needs-you toast.
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
const PORT = 3994;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let inboxStore: InboxStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-home-mc-'));
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
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    inboxTriageStopped: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  };
  return buildDashboardApp(ctx);
}

afterEach(() => {
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { inboxStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const get = (app: ReturnType<typeof buildDashboardApp>, path: string) =>
  request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);

describe('GET / — Mission Control home', () => {
  it('renders the editable board, the Ask-sua CTA, and collapsed activity', async () => {
    const app = await makeApp();
    // The board only renders when at least one agent is installed (zero agents
    // shows the Build-from-goal empty state by design).
    agentStore.createAgent({
      id: 'hello', name: 'hello', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    const res = await get(app, '/');
    expect(res.status).toBe(200);
    // The inbox cadence feed IS the home body now; its live-swap container mounts
    // (empty here — no threads seeded — but present so the client has a target).
    expect(res.text).toContain('data-home-inbox');
    // The `sua ›` ask prompt is global chrome (the band), so it's present on
    // every page including home — inbox-first CTA → new thread.
    expect(res.text).toContain('data-home-ask');
    expect(res.text).toContain('action="/inbox/new"');
    expect(res.text).toContain('Ask sua');
    // Signals moved to the dedicated /pulse page; recent activity lives at /runs.
    // Neither renders on home anymore.
    expect(res.text).not.toContain('home-secondary');
    expect(res.text).not.toContain('pulse-grid');
    expect(res.text).not.toContain('Recent activity');
    expect(res.text).not.toContain('Browse packs');
    // The global top-bar toast remains the always-visible cross-page cue.
    expect(res.text).toContain('data-inbox-toast');
  });

  it('renders the needs-you group (amber accent) and the closed ticker, no emoji', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'hello', name: 'hello', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    // A thread awaiting the operator → needs-you group (accent row, not a box).
    const a = inboxStore.add({ priority: 'high', source: 'run-failure', title: 'needs-me-thread', body: 'x' });
    inboxStore.updateStatus(a.id, 'awaiting_user');
    // A thread sua resolved autonomously → closed ticker.
    const b = inboxStore.add({ priority: 'medium', source: 'run-failure', title: 'sua-fixed-thread', body: 'y' });
    inboxStore.updateStatus(b.id, 'resolved', { autoResolved: true });
    // A thread the OPERATOR resolved → must NOT appear in the ticker.
    const c = inboxStore.add({ priority: 'low', source: 'manual', title: 'i-fixed-thread', body: 'z' });
    inboxStore.updateStatus(c.id, 'resolved');

    const res = await get(app, '/');
    expect(res.status).toBe(200);
    // Dense grid feed — no filled boxes; needs-you is an accent row.
    expect(res.text).toContain('feed-group--needs');
    expect(res.text).toContain('feed-row--needs');
    expect(res.text).toContain('needs-me-thread');
    expect(res.text).not.toContain('home-needs__item'); // old boxy markup gone
    // Closed ticker renders the auto-resolved thread but not the operator one.
    expect(res.text).toContain('feed-group--closed');
    expect(res.text).toContain('sua-fixed-thread');
    expect(res.text).not.toContain('i-fixed-thread');
    // Rows open the modal (rail-id) with a thread-page href fallback.
    expect(res.text).toContain(`data-inbox-rail-id="${a.id}"`);
    expect(res.text).toContain(`href="/inbox/${b.id}"`);
    // The toy emoji nature chips are gone.
    expect(res.text).not.toContain('🧠');
    expect(res.text).not.toContain('home-nature');
  });

  it('renders the quiet mono nature meta for a scheduled deterministic agent', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'etl', name: 'etl', status: 'active', source: 'local', mcp: false, schedule: '0 3 * * *',
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    inboxStore.add({ priority: 'medium', source: 'run-failure', title: 'etl-thread', body: 'b', agentId: 'etl' });
    const res = await get(app, '/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('etl-thread');
    expect(res.text).toContain('sched·shell'); // scheduled + all-shell agent
  });

  it('shows a one-line preview snippet from the latest reply', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'hello', name: 'hello', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    const m = inboxStore.add({ priority: 'medium', source: 'run-failure', title: 'preview-thread', body: 'b' });
    inboxStore.addResponse(m.id, 'triage', 'Found three mismatches to review');
    const res = await get(app, '/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('feed-row__preview');
    expect(res.text).toContain('Found three mismatches to review');
  });

  it('suppresses an empty "New conversation" stub from the feed', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'hello', name: 'hello', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    // The exact shape POST /inbox/new creates before any first message.
    inboxStore.add({ priority: 'medium', source: 'manual', title: 'New conversation', body: '(empty)' });
    inboxStore.add({ priority: 'medium', source: 'manual', title: 'real-thread', body: 'has content' });
    const res = await get(app, '/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('real-thread');
    // Row-specific (the string "New conversation" also appears in bundled JS).
    expect(res.text).not.toContain('>New conversation<');
  });

  it('buckets an active thread with recent activity into the Today section', async () => {
    const app = await makeApp();
    // An agent must exist or the home shows the onboarding empty state (no feed).
    agentStore.createAgent({
      id: 'hello', name: 'hello', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    inboxStore.add({ priority: 'medium', source: 'manual', title: 'todays-thread', body: 'b' });
    const res = await get(app, '/');
    expect(res.status).toBe(200);
    // A just-created thread lands under the "Today" cadence group label.
    expect(res.text).toMatch(/section-label">Today/);
    expect(res.text).toContain('todays-thread');
  });

  it('GET /inbox/home-strips returns the cadence feed fragment without page chrome', async () => {
    const app = await makeApp();
    const a = inboxStore.add({ priority: 'high', source: 'run-failure', title: 'frag-needs', body: 'x' });
    inboxStore.updateStatus(a.id, 'awaiting_user');
    const res = await get(app, '/inbox/home-strips');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('data-home-inbox');
    expect(res.text).toContain('frag-needs');
    // Fragment only — no layout chrome.
    expect(res.text).not.toContain('<html');
    expect(res.text).not.toContain('id="pulse-tile-data"');
  });

  it('GET /pulse renders the board as a first-class page (moved off home)', async () => {
    const app = await makeApp();
    const res = await request(app).get('/pulse')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).redirects(0);
    expect(res.status).toBe(200);
    expect(res.text).toContain('pulse-grid');
    expect(res.text).toContain('id="pulse-tile-data"');
  });

  it('renders the global top-bar needs-you toast (hidden until JS fills the count)', async () => {
    const app = await makeApp();
    const res = await get(app, '/');
    expect(res.status).toBe(200);
    // Toast element present on every page; server renders it hidden, the
    // inbox-badge JS reveals it from /inbox/needs-you-count.
    expect(res.text).toMatch(/class="topbar__needs"[^>]*data-inbox-toast[^>]*hidden/);
    expect(res.text).toContain('data-inbox-count');
  });
});

describe('GET /inbox/needs-you-count', () => {
  it('returns 0 when nothing awaits, and the count once threads are awaiting_user', async () => {
    const app = await makeApp();
    const zero = await get(app, '/inbox/needs-you-count');
    expect(zero.status).toBe(200);
    expect(zero.body).toEqual({ count: 0 });

    const a = inboxStore.add({ priority: 'medium', source: 'manual', title: 'a', body: 'x' });
    const b = inboxStore.add({ priority: 'medium', source: 'manual', title: 'b', body: 'y' });
    inboxStore.add({ priority: 'low', source: 'manual', title: 'open one', body: 'z' }); // stays open
    inboxStore.updateStatus(a.id, 'awaiting_user');
    inboxStore.updateStatus(b.id, 'awaiting_user');

    const two = await get(app, '/inbox/needs-you-count');
    expect(two.body).toEqual({ count: 2 });
  });

  it('is not shadowed by the inbox /:id route', async () => {
    const app = await makeApp();
    const res = await get(app, '/inbox/needs-you-count');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/json/);
  });
});
