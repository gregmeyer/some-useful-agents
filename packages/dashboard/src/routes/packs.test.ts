import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  DashboardsStore,
  LocalProvider,
  MemorySecretsStore,
  PacksStore,
  RunStore,
  buildLoopbackAllowlist,
  loadAgents,
  type PackManifest,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3998;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-packs-routes-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, 'hello.yaml'), 'name: hello\ntype: shell\ncommand: echo hi\n');

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  packsStore = new PacksStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
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
    packsStore,
    dashboardsStore,
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  };

  return buildDashboardApp(ctx);
}

function manifest(): PackManifest {
  return {
    id: 'test-pack',
    name: 'Test Pack',
    version: '0.1.0',
    description: 'A pack for testing.',
    dashboards: [
      { id: 'main', name: 'Main', sections: [{ title: 'Greetings', agentIds: ['hello'] }] },
    ],
  };
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
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('packs routes', () => {
  it('GET /packs lists registered packs', async () => {
    const app = await makeApp();
    packsStore.upsertPack({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', source: 'builtin', manifest: manifest() });
    const res = await request(app).get('/packs').set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Test Pack');
    expect(res.text).toContain('Available');
    expect(res.text).toContain('href="/packs/test-pack"');
  });

  it('GET /packs/:id renders detail with Install button', async () => {
    const app = await makeApp();
    packsStore.upsertPack({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', source: 'builtin', manifest: manifest() });
    const res = await request(app).get('/packs/test-pack').set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/packs/test-pack/install"');
    expect(res.text).not.toContain('action="/packs/test-pack/uninstall"');
    expect(res.text).toContain('Main'); // dashboard name visible
  });

  it('POST /packs/:id/install creates dashboards and flips Install → Uninstall', async () => {
    const app = await makeApp();
    packsStore.upsertPack({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', source: 'builtin', manifest: manifest() });

    const installRes = await request(app)
      .post('/packs/test-pack/install')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(installRes.status).toBe(303);
    expect(installRes.headers.location).toMatch(/\/packs\/test-pack\?ok=/);

    expect(dashboardsStore.getDashboard('test-pack:main')).not.toBeNull();
    expect(packsStore.getPack('test-pack')?.installedAt).not.toBeNull();

    const detail = await request(app).get('/packs/test-pack').set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(detail.text).toContain('action="/packs/test-pack/uninstall"');
    expect(detail.text).not.toContain('action="/packs/test-pack/install"');
  });

  it('POST /packs/:id/install honors returnTo (install-from-Pulse modal)', async () => {
    const app = await makeApp();
    packsStore.upsertPack({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', source: 'builtin', manifest: manifest() });

    const res = await request(app)
      .post('/packs/test-pack/install')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .type('form').send({ returnTo: '/' });
    expect(res.status).toBe(303);
    // Comes back to the home board with a flash, not the pack detail page.
    expect(res.headers.location).toMatch(/^\/\?ok=/);
    expect(packsStore.getPack('test-pack')?.installedAt).not.toBeNull();
  });

  it('POST /packs/:id/install ignores an off-site returnTo', async () => {
    const app = await makeApp();
    packsStore.upsertPack({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', source: 'builtin', manifest: manifest() });

    const res = await request(app)
      .post('/packs/test-pack/install')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .type('form').send({ returnTo: 'https://evil.example.com' });
    expect(res.status).toBe(303);
    // Falls back to the pack detail page rather than redirecting off-site.
    expect(res.headers.location).toMatch(/^\/packs\/test-pack\?ok=/);
  });

  it('POST /packs/:id/uninstall removes dashboards but keeps agents', async () => {
    const app = await makeApp();
    packsStore.upsertPack({ id: 'test-pack', name: 'Test Pack', version: '0.1.0', source: 'builtin', manifest: manifest() });
    await request(app).post('/packs/test-pack/install').set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

    const uninstallRes = await request(app)
      .post('/packs/test-pack/uninstall')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(uninstallRes.status).toBe(303);
    expect(uninstallRes.headers.location).toMatch(/\/packs\/test-pack\?ok=/);

    expect(dashboardsStore.getDashboard('test-pack:main')).toBeNull();
    expect(packsStore.getPack('test-pack')?.installedAt).toBeNull();
  });

  it('GET /packs/unknown 303s back to /packs', async () => {
    const app = await makeApp();
    const res = await request(app).get('/packs/nope').set('Host', `127.0.0.1:${PORT}`).set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/packs');
  });
});
