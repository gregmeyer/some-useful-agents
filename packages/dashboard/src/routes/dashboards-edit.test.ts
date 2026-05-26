import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
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
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3996;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-dashboards-edit-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  packsStore = new PacksStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  // Two signal-bearing agents to test add-tile.
  for (const id of ['hello', 'world']) {
    agentStore.createAgent({
      id,
      name: id,
      status: 'active',
      source: 'local',
      mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo x', dependsOn: [] }],
      signal: { title: id, template: 'text-headline', mapping: { headline: 'h' } },
    }, 'cli');
  }

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
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Poll until the agent has at least `min` runs (courtesy run is fire-and-forget). */
async function waitForRunCount(agentId: string, min: number, timeoutMs = 3000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const n = runStore.listRuns({ agentName: agentId, limit: 10 }).length;
    if (n >= min) return n;
    await new Promise((r) => setTimeout(r, 20));
  }
  return runStore.listRuns({ agentName: agentId, limit: 10 }).length;
}

function seed(): { id: string } {
  const id = 'user:test';
  dashboardsStore.upsertDashboard({
    id, packId: null, name: 'Test',
    layout: { sections: [{ title: 'A', agentIds: ['hello'] }] },
  });
  return { id };
}

describe('dashboards editor', () => {
  it('GET /dashboards/:id/edit renders the editor with section + tile rows', async () => {
    const app = await makeApp();
    seed();
    const res = await request(app).get('/dashboards/user:test/edit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('value="A"');
    expect(res.text).toContain('hello');
    expect(res.text).toContain('action="/dashboards/user%3Atest/sections"');
  });

  it('edit page: user-created shows Delete; pack-owned explains uninstall + links to the pack', async () => {
    const app = await makeApp();
    seed(); // user:test, packId null
    dashboardsStore.upsertDashboard({
      id: 'starter:media', packId: 'starter', name: 'Media',
      layout: { sections: [{ title: 'A', agentIds: ['hello'] }] },
    });

    const user = await request(app).get('/dashboards/user:test/edit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(user.text).toContain('action="/dashboards/user%3Atest/delete"');
    expect(user.text).not.toContain('owned by the');

    const pack = await request(app).get('/dashboards/starter:media/edit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    // No direct delete for pack-owned; instead an explanation + a link to the pack.
    expect(pack.text).not.toContain('action="/dashboards/starter%3Amedia/delete"');
    expect(pack.text).toContain('owned by the');
    expect(pack.text).toContain('href="/packs/starter"');
  });

  it('POST /dashboards creates a user dashboard and redirects to edit', async () => {
    const app = await makeApp();
    const res = await request(app).post('/dashboards')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ name: 'My Dash' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/\/dashboards\/user%3Amy-dash\/edit/);
    expect(dashboardsStore.getDashboard('user:my-dash')?.name).toBe('My Dash');
  });

  it('POST /dashboards/:id/rename changes the name, preserving the layout', async () => {
    const app = await makeApp();
    const { id } = seed();
    const res = await request(app).post(`/dashboards/${id}/rename`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ name: 'Mornings' });
    expect(res.status).toBe(303);
    const after = dashboardsStore.getDashboard(id);
    expect(after?.name).toBe('Mornings');
    // The id is stable across rename — no new row, still findable for
    // delete/uninstall after the display name changes.
    expect(after?.id).toBe(id);
    expect(dashboardsStore.listDashboards().filter((d) => d.id === id)).toHaveLength(1);
    // Layout (sections + tiles) is untouched by the rename.
    expect(after?.layout.sections).toEqual([{ title: 'A', agentIds: ['hello'] }]);
  });

  it('POST /dashboards/:id/rename preserves packId so pack uninstall still matches', async () => {
    const app = await makeApp();
    const id = 'starter:media';
    dashboardsStore.upsertDashboard({
      id, packId: 'starter', name: 'Media',
      layout: { sections: [{ title: 'A', agentIds: ['hello'] }] },
    });
    await request(app).post(`/dashboards/${encodeURIComponent(id)}/rename`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ name: 'My Media' });
    const after = dashboardsStore.getDashboard(id);
    expect(after?.name).toBe('My Media');
    expect(after?.id).toBe(id);
    expect(after?.packId).toBe('starter');
  });

  it('POST /dashboards/:id/rename rejects an empty name', async () => {
    const app = await makeApp();
    const { id } = seed();
    const res = await request(app).post(`/dashboards/${id}/rename`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ name: '' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/error=/);
    expect(dashboardsStore.getDashboard(id)?.name).toBe('Test');
  });

  it('POST /sections appends a section', async () => {
    const app = await makeApp();
    const { id } = seed();
    const res = await request(app).post(`/dashboards/${id}/sections`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ title: 'B' });
    expect(res.status).toBe(303);
    expect(dashboardsStore.getDashboard(id)?.layout.sections.map((s) => s.title)).toEqual(['A', 'B']);
  });

  it('POST /sections/:idx/rename updates title', async () => {
    const app = await makeApp();
    const { id } = seed();
    await request(app).post(`/dashboards/${id}/sections/0/rename`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ title: 'Renamed' });
    expect(dashboardsStore.getDashboard(id)?.layout.sections[0].title).toBe('Renamed');
  });

  it('POST /sections/:idx/delete removes the section', async () => {
    const app = await makeApp();
    const { id } = seed();
    await request(app).post(`/dashboards/${id}/sections/0/delete`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(dashboardsStore.getDashboard(id)?.layout.sections).toEqual([]);
  });

  it('POST /sections/:idx/move?dir=down swaps with the next section', async () => {
    const app = await makeApp();
    const { id } = seed();
    dashboardsStore.upsertDashboard({
      id, packId: null, name: 'Test',
      layout: { sections: [{ title: 'A', agentIds: [] }, { title: 'B', agentIds: [] }] },
    });
    await request(app).post(`/dashboards/${id}/sections/0/move?dir=down`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(dashboardsStore.getDashboard(id)?.layout.sections.map((s) => s.title)).toEqual(['B', 'A']);
  });

  it('POST /sections/:idx/tiles adds an agent', async () => {
    const app = await makeApp();
    const { id } = seed();
    await request(app).post(`/dashboards/${id}/sections/0/tiles`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ agentId: 'world' });
    expect(dashboardsStore.getDashboard(id)?.layout.sections[0].agentIds).toEqual(['hello', 'world']);
  });

  it('adding a never-run agent fires a courtesy run so the tile renders in place', async () => {
    const app = await makeApp();
    const { id } = seed();
    expect(runStore.listRuns({ agentName: 'world', limit: 1 }).length).toBe(0);
    await request(app).post(`/dashboards/${id}/sections/0/tiles`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ agentId: 'world' });
    expect(await waitForRunCount('world', 1)).toBe(1);
  });

  it('does not re-run an agent that already has a run when added to another section', async () => {
    const app = await makeApp();
    const { id } = seed();
    dashboardsStore.upsertDashboard({
      id, packId: null, name: 'Test',
      layout: { sections: [{ title: 'A', agentIds: ['hello'] }, { title: 'B', agentIds: [] }] },
    });
    // First add fires the courtesy run.
    await request(app).post(`/dashboards/${id}/sections/0/tiles`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ agentId: 'world' });
    expect(await waitForRunCount('world', 1)).toBe(1);
    // Adding it elsewhere now that it has a run must NOT fire a second.
    await request(app).post(`/dashboards/${id}/sections/1/tiles`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ agentId: 'world' });
    await new Promise((r) => setTimeout(r, 250));
    expect(runStore.listRuns({ agentName: 'world', limit: 10 }).length).toBe(1);
  });

  it('POST /sections/:idx/tiles with returnTo=live redirects to the live view', async () => {
    const app = await makeApp();
    const { id } = seed();
    const res = await request(app).post(`/dashboards/${id}/sections/0/tiles`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ agentId: 'world', returnTo: 'live' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(new RegExp(`^/dashboards/${encodeURIComponent(id)}\\?ok=`));
    expect(res.headers.location).not.toContain('/edit');
  });

  it('POST /sections/:idx/tiles/:tileIdx/delete removes a tile', async () => {
    const app = await makeApp();
    const { id } = seed();
    await request(app).post(`/dashboards/${id}/sections/0/tiles/0/delete`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(dashboardsStore.getDashboard(id)?.layout.sections[0].agentIds).toEqual([]);
  });

  it('POST /sections/:idx/tiles/:tileIdx/move swaps adjacent tiles', async () => {
    const app = await makeApp();
    const { id } = seed();
    dashboardsStore.upsertDashboard({
      id, packId: null, name: 'Test',
      layout: { sections: [{ title: 'A', agentIds: ['hello', 'world'] }] },
    });
    await request(app).post(`/dashboards/${id}/sections/0/tiles/1/move?dir=up`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(dashboardsStore.getDashboard(id)?.layout.sections[0].agentIds).toEqual(['world', 'hello']);
  });

  it('POST /dashboards/:id/delete removes a user dashboard', async () => {
    const app = await makeApp();
    const { id } = seed();
    const res = await request(app).post(`/dashboards/${id}/delete`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(dashboardsStore.getDashboard(id)).toBeNull();
  });

  it('POST /dashboards/:id/delete refuses to delete a pack-owned dashboard', async () => {
    const app = await makeApp();
    dashboardsStore.upsertDashboard({
      id: 'starter:main', packId: 'starter', name: 'Main',
      layout: { sections: [] },
    });
    const res = await request(app).post('/dashboards/starter:main/delete')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/error=/);
    expect(dashboardsStore.getDashboard('starter:main')).not.toBeNull();
  });
});
