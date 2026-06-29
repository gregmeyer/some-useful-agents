/**
 * Mission Control home (`/`) + the global inbox badge count endpoint.
 * Verifies the unified front door composes the three zones (Needs you / live
 * Pulse board / collapsed activity) and that /inbox/needs-you-count drives the
 * nav badge.
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
  it('renders the live Pulse board, the Needs-you strip, and collapsed activity', async () => {
    const app = await makeApp();
    // The board only renders when at least one agent is installed (zero agents
    // shows the Build-from-goal empty state by design).
    agentStore.createAgent({
      id: 'hello', name: 'hello', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    // Seed an awaiting_user thread so the Needs-you zone shows a card.
    const m = inboxStore.add({ priority: 'high', source: 'run-failure', title: 'markets-today failed', body: 'fetch-quotes exit 1', agentId: 'markets-today' });
    inboxStore.updateStatus(m.id, 'awaiting_user');

    const res = await get(app, '/');
    expect(res.status).toBe(200);
    // Live Pulse board (system tiles render even with zero signal agents).
    expect(res.text).toContain('pulse-grid');
    expect(res.text).toContain('id="pulse-tile-data"');
    expect(res.text).toContain('_system-runs-today');
    // Needs you strip.
    expect(res.text).toContain('Needs you');
    expect(res.text).toContain('markets-today failed');
    expect(res.text).toContain('href="/inbox"');
    // Collapsed activity.
    expect(res.text).toContain('home-activity');
    expect(res.text).toContain('Recent activity');
    // The home is now the single dashboard surface — the board is editable here
    // (/pulse collapsed into /).
    expect(res.text).toContain('id="pulse-edit-toggle"');
    // Primary CTA is inbox-first ("Ask sua" → new thread), not the old
    // Build-from-goal / Browse-packs header buttons.
    expect(res.text).toContain('action="/inbox/new"');
    expect(res.text).toContain('Ask sua');
    expect(res.text).not.toContain('Browse packs');
    expect(res.text).not.toContain('id="build-from-goal-btn"');
  });

  it('GET /pulse redirects to / (the board lives at the root now)', async () => {
    const app = await makeApp();
    const res = await request(app).get('/pulse')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('shows the "all clear" state when nothing is awaiting reply', async () => {
    const app = await makeApp();
    const res = await get(app, '/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Inbox clear');
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
