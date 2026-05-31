/**
 * Tests for POST /dashboards/:id/layout-plan/commit — the dashboard-side
 * Improve-layout apply. Two responsibilities:
 *
 *  1. Replace section membership from the plan's containers (pre-existing).
 *  2. Persist per-placement size/tileFit/height overrides on each section
 *     from the planner's topAgents entries.
 */

import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
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
const PORT = 3996;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
const DASHBOARD_ID = 'user:test-dash';

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;
let layoutHintsStore: LayoutHintsStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-dash-commit-'));
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

  for (const id of ['api-monitor', 'hn-top-3', 'weather']) {
    agentStore.createAgent({
      id,
      name: id,
      status: 'active',
      source: 'local',
      mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
      signal: { title: id, template: 'text-headline', mapping: { headline: 'result' } },
    }, 'cli');
  }

  dashboardsStore.upsertDashboard({
    id: DASHBOARD_ID,
    packId: null,
    name: 'Test',
    layout: { sections: [{ title: 'Misc', agentIds: ['weather'] }] },
  });

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

describe('POST /dashboards/:id/layout-plan/commit', () => {
  it('writes per-placement overrides on the new section from topAgents', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/dashboards/${encodeURIComponent(DASHBOARD_ID)}/layout-plan/commit`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [{ label: 'Monitoring', tiles: ['api-monitor', 'hn-top-3'] }],
        topAgents: [
          { id: 'api-monitor', rationale: 'a', suggestedSize: '2x1' },
          { id: 'hn-top-3', rationale: 'b', suggestedTileFit: 'scroll', suggestedHeight: 320 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.placementsWritten).toBe(2);

    const after = dashboardsStore.getDashboard(DASHBOARD_ID)!;
    expect(after.layout.sections).toHaveLength(1);
    const section = after.layout.sections[0];
    expect(section.placements).toBeDefined();
    expect(section.placements!['api-monitor'].size).toBe('2x1');
    expect(section.placements!['hn-top-3'].tileFit).toBe('scroll');
    expect(section.placements!['hn-top-3'].height).toBe(320);
  });

  it('omits placements when no topAgents are provided', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/dashboards/${encodeURIComponent(DASHBOARD_ID)}/layout-plan/commit`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({ containers: [{ label: 'Monitoring', tiles: ['api-monitor'] }] });
    expect(res.status).toBe(200);
    expect(res.body.placementsWritten).toBe(0);
    const after = dashboardsStore.getDashboard(DASHBOARD_ID)!;
    expect(after.layout.sections[0].placements).toBeUndefined();
  });

  it('skips invalid field values silently', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/dashboards/${encodeURIComponent(DASHBOARD_ID)}/layout-plan/commit`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [{ label: 'Group', tiles: ['api-monitor'] }],
        topAgents: [
          { id: 'api-monitor', rationale: 'x', suggestedSize: '5x5', suggestedTileFit: 'shrink', suggestedHeight: 50 },
        ],
      });
    expect(res.status).toBe(200);
    // All fields invalid → no placement entry created at all.
    expect(res.body.placementsWritten).toBe(0);
    const after = dashboardsStore.getDashboard(DASHBOARD_ID)!;
    expect(after.layout.sections[0].placements).toBeUndefined();
  });

  it('groups placements per section by container membership', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/dashboards/${encodeURIComponent(DASHBOARD_ID)}/layout-plan/commit`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [
          { label: 'Monitoring', tiles: ['api-monitor'] },
          { label: 'News', tiles: ['hn-top-3'] },
        ],
        topAgents: [
          { id: 'api-monitor', rationale: 'a', suggestedSize: '2x1' },
          { id: 'hn-top-3', rationale: 'b', suggestedTileFit: 'scroll' },
        ],
      });
    expect(res.status).toBe(200);
    const after = dashboardsStore.getDashboard(DASHBOARD_ID)!;
    const [monitoring, news] = after.layout.sections;
    expect(monitoring.title).toBe('Monitoring');
    expect(monitoring.placements!['api-monitor'].size).toBe('2x1');
    expect(monitoring.placements!['hn-top-3']).toBeUndefined();
    expect(news.title).toBe('News');
    expect(news.placements!['hn-top-3'].tileFit).toBe('scroll');
  });

  it('skips an agent placement that ended up not assigned to any section', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/dashboards/${encodeURIComponent(DASHBOARD_ID)}/layout-plan/commit`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [{ label: 'Group', tiles: ['api-monitor'] }],
        topAgents: [
          { id: 'api-monitor', rationale: 'a', suggestedSize: '2x1' },
          { id: 'hn-top-3', rationale: 'b', suggestedSize: '2x2' }, // not placed
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.placementsWritten).toBe(1);
    const after = dashboardsStore.getDashboard(DASHBOARD_ID)!;
    expect(after.layout.sections[0].placements!['api-monitor']).toBeDefined();
    expect(after.layout.sections[0].placements!['hn-top-3']).toBeUndefined();
  });
});
