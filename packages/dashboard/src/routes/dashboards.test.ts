import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import {
  AgentStore,
  DashboardsStore,
  LayoutHintsStore,
  LocalProvider,
  PacksStore,
  RunStore,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3997;

let t: TestContext | undefined;
let provider: LocalProvider | undefined;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;
let layoutHintsStore: LayoutHintsStore;

async function makeApp() {
  t = await createTestContext({ port: PORT, prefix: 'sua-dashboards-routes-', extra: ({ dbPath }) => ({
    packsStore: new PacksStore(dbPath),
    dashboardsStore: new DashboardsStore(dbPath),
    layoutHintsStore: new LayoutHintsStore(dbPath),
  }) });
  const { ctx } = t;
  provider = t.provider;
  runStore = ctx.runStore;
  agentStore = ctx.agentStore;
  packsStore = ctx.packsStore!;
  dashboardsStore = ctx.dashboardsStore!;
  layoutHintsStore = ctx.layoutHintsStore!;

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

  const app = buildDashboardApp(ctx);
  return app;
}

afterEach(async () => {
  if (provider) {
    const start = Date.now();
    while ((provider as unknown as { running?: { size: number } }).running?.size && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  await closeTestContext(t);
  t = undefined;
  provider = undefined;
});

describe('dashboards routes', () => {
  it('GET /dashboards/:id renders the dashboard as a board', async () => {
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
    expect(res.text).toContain('data-board-canvas="starter:main"');
    expect(res.text).toContain('Greetings');
    expect(res.text).toContain('hello');
    // The previous layout is gone.
    expect(res.text).not.toContain('id="dashboard-containers"');
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
      .get('/pulse/agents')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="dashboards-dropdown"');
    expect(res.text).toContain('<span title="Pulse"');
    expect(res.text).not.toContain('pulseVisible');
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
      .get('/pulse/agents')
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
      .get('/')
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
      .get('/')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('class="dashboards-dropdown"');
  });
});
