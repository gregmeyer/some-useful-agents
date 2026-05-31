import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  DashboardsStore,
  LayoutHintsStore,
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

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;
let layoutHintsStore: LayoutHintsStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-dashboards-routes-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  packsStore = new PacksStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
  layoutHintsStore = new LayoutHintsStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  // Install a tiny v2 agent with a signal so tile-building has something to do.
  agentStore.createAgent({
    id: 'hello',
    name: 'Hello',
    status: 'active',
    source: 'local',
    mcp: false,
    nodes: [{ id: 'greet', type: 'shell', command: 'echo hi', dependsOn: [] }],
    signal: { title: 'Hello', template: 'text-headline', mapping: { headline: 'greeting' } },
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
    layoutHintsStore,
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
  try { layoutHintsStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('dashboards routes', () => {
  it('GET /dashboards/:id renders sections + tiles', async () => {
    const app = await makeApp();
    dashboardsStore.upsertDashboard({
      id: 'starter:main',
      packId: 'starter',
      name: 'Main',
      layout: { sections: [{ title: 'Greetings', agentIds: ['hello'] }] },
    });
    const res = await request(app)
      .get('/dashboards/starter:main')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Main');
    expect(res.text).toContain('Greetings');
    expect(res.text).toContain('data-agent-id="hello"');
    expect(res.text).toContain('from pack: starter');
    // Pulse-parity tile chrome.
    expect(res.text).toContain('id="dashboard-containers"');
    expect(res.text).toContain('data-dashboard-id="starter:main"');
    expect(res.text).toContain('id="dashboard-edit-toggle"');
    expect(res.text).toContain('id="dashboard-tile-data"');
    expect(res.text).toContain('class="pulse-tile__resize-handle"');
    expect(res.text).toContain('class="pulse-tile__configure-btn"');
    expect(res.text).toContain('class="pulse-tile__palette-btn"');
    // × button removes from this dashboard, not from Pulse.
    expect(res.text).toContain('action="/dashboards/starter%3Amain/sections/0/tiles/0/delete"');
    expect(res.text).not.toContain('action="/agents/hello/signal/toggle"');
  });

  it('renders missing-agent placeholders for ids the agent store doesn\'t know', async () => {
    const app = await makeApp();
    dashboardsStore.upsertDashboard({
      id: 'd1',
      packId: null,
      name: 'D1',
      layout: { sections: [{ title: 'Mixed', agentIds: ['hello', 'ghost-agent'] }] },
    });
    const res = await request(app)
      .get('/dashboards/d1')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-agent-id="hello"');
    expect(res.text).toContain('ghost-agent');
    expect(res.text).toContain('not installed');
  });

  it('exposes the add-tile picker on /dashboards/:id', async () => {
    const app = await makeApp();
    dashboardsStore.upsertDashboard({
      id: 'user:in-place',
      packId: null,
      name: 'InPlace',
      layout: { sections: [{ title: 'Empty', agentIds: [] }] },
    });
    const res = await request(app)
      .get('/dashboards/user:in-place')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // Single + Add tile button lives in the top action bar, outside the
    // widget-layout host that gets client-side wiped on render.
    expect(res.text).toContain('add-tile-btn');
    expect(res.text).toContain('data-dashboard-id="user:in-place"');
    expect(res.text).toContain('data-section-idx="0"');
    // Available-agents JSON is embedded and includes the signal-bearing "hello".
    expect(res.text).toContain('id="dashboard-available-agents"');
    const m = res.text.match(/<script type="application\/json" id="dashboard-available-agents">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const agents = JSON.parse(m![1]);
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.find((a: { id: string }) => a.id === 'hello')).toBeDefined();
    expect(agents[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    expect(agents[0]).toHaveProperty('lastFiredAt');
  });

  it('GET /dashboards/unknown 404s', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/dashboards/nope')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('Pulse shows the dashboards dropdown when at least one dashboard is installed', async () => {
    const app = await makeApp();
    dashboardsStore.upsertDashboard({
      id: 'starter:main',
      packId: 'starter',
      name: 'Main',
      layout: { sections: [{ title: 'Greetings', agentIds: ['hello'] }] },
    });
    const res = await request(app)
      .get('/pulse')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="dashboards-dropdown"');
    expect(res.text).toContain('Default Dashboard');
    expect(res.text).toContain('href="/dashboards/starter%3Amain"');
  });

  it('Pulse renders the Install-from-Packs modal with available (uninstalled) packs', async () => {
    const app = await makeApp();
    // A dashboard so the dropdown (and thus the modal trigger) renders.
    dashboardsStore.upsertDashboard({
      id: 'starter:main', packId: 'starter', name: 'Main',
      layout: { sections: [{ title: 'G', agentIds: ['hello'] }] },
    });
    // An uninstalled pack should appear in the modal with an install form
    // that returns to Pulse.
    packsStore.upsertPack({ id: 'weather', name: 'Weather', version: '0.2.0', source: 'builtin', manifest: { id: 'weather', name: 'Weather', version: '0.2.0', dashboards: [], agents: [] } });

    const res = await request(app)
      .get('/pulse')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="install-packs-modal"');
    expect(res.text).toContain('data-install-packs-open');
    expect(res.text).toContain('action="/packs/weather/install"');
    expect(res.text).toMatch(/name="returnTo" value="\/pulse"/);
  });

  it('CSP img-src widens to include each active agent\'s permissions.imgSrc hosts', async () => {
    const app = await makeApp();
    // Add a second agent declaring an external image host.
    agentStore.createAgent({
      id: 'unsplash-tile',
      name: 'Unsplash Tile',
      status: 'active',
      source: 'local',
      mcp: false,
      nodes: [{ id: 'fetch', type: 'shell', command: 'echo done', dependsOn: [] }],
      signal: { title: 'Photo', template: 'image', mapping: { url: 'image_url' } },
      permissions: { imgSrc: ['images.unsplash.com', '*.unsplash.com'] },
    }, 'cli');
    // Cache is per-app and lazy — first request computes from scratch
    // and picks up the new agent, no TTL wait needed.
    const res = await request(app)
      .get('/pulse')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('https://images.unsplash.com');
    expect(csp).toContain('https://*.unsplash.com');
    // Baseline hosts still present.
    expect(csp).toContain('https://img.youtube.com');
  });

  it('Pulse hides the dropdown when no dashboards exist (only Default would show — noise)', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/pulse')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('class="dashboards-dropdown"');
  });

  it('per-section placement overrides the agent-global LayoutHintsStore entry', async () => {
    const app = await makeApp();
    // Agent-global hint: 1x1 / grow / no height (what Pulse would see).
    layoutHintsStore.setHint('hello', { size: '1x1', tileFit: 'grow' });
    // Dashboard places the same agent with 2x2 / scroll / pinned 240px.
    dashboardsStore.upsertDashboard({
      id: 'user:big-card',
      packId: null,
      name: 'Big Card',
      layout: {
        sections: [{
          title: 'Hero',
          agentIds: ['hello'],
          placements: { hello: { size: '2x2', tileFit: 'scroll', height: 240 } },
        }],
      },
    });

    const res = await request(app)
      .get('/dashboards/user%3Abig-card')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // Per-placement wins on every axis.
    expect(res.text).toMatch(/data-tile-size="2x2"/);
    expect(res.text).toMatch(/pulse-tile--fit-scroll/);
    expect(res.text).toMatch(/style="height: 240px"/);
  });

  it('falls through to agent-global hint when a placement field is undefined', async () => {
    const app = await makeApp();
    layoutHintsStore.setHint('hello', { size: '2x1', tileFit: 'scroll' });
    dashboardsStore.upsertDashboard({
      id: 'user:partial',
      packId: null,
      name: 'Partial',
      layout: {
        sections: [{
          title: 'Hero',
          agentIds: ['hello'],
          // Only override height; size + tileFit should fall through to the hint.
          placements: { hello: { height: 180 } },
        }],
      },
    });

    const res = await request(app)
      .get('/dashboards/user%3Apartial')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/data-tile-size="2x1"/);
    expect(res.text).toMatch(/pulse-tile--fit-scroll/);
    expect(res.text).toMatch(/style="height: 180px"/);
  });
});
