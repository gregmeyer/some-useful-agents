/**
 * Tests for POST /pulse/layout-plan/commit — the "Apply" button on the
 * Improve-layout wizard. Two responsibilities now:
 *
 *  1. Flip pulseVisible on agents based on container membership (pre-existing).
 *  2. Persist the planner's per-agent layout hints (suggestedSize,
 *     suggestedTileFit, suggestedHeight) into LayoutHintsStore.
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
const PORT = 3998;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;
let layoutHintsStore: LayoutHintsStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-pulse-commit-'));
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

describe('POST /pulse/layout-plan/commit', () => {
  it('persists hints from topAgents to LayoutHintsStore', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/pulse/layout-plan/commit')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [{ label: 'Monitoring', tiles: ['api-monitor', 'hn-top-3'] }],
        topAgents: [
          { id: 'api-monitor', rationale: 'a', suggestedSize: '2x1' },
          { id: 'hn-top-3', rationale: 'b', suggestedSize: '2x2', suggestedTileFit: 'scroll', suggestedHeight: 320 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.hintsWritten).toEqual(expect.arrayContaining(['api-monitor', 'hn-top-3']));

    const apiHint = layoutHintsStore.getHint('api-monitor');
    expect(apiHint?.size).toBe('2x1');
    expect(apiHint?.tileFit).toBeUndefined();

    const hnHint = layoutHintsStore.getHint('hn-top-3');
    expect(hnHint?.size).toBe('2x2');
    expect(hnHint?.tileFit).toBe('scroll');
    expect(hnHint?.height).toBe(320);
  });

  it('skips unknown agent ids', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/pulse/layout-plan/commit')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [{ label: 'Group', tiles: ['api-monitor'] }],
        topAgents: [
          { id: 'phantom-agent', rationale: 'x', suggestedSize: '2x1' },
          { id: 'api-monitor', rationale: 'y', suggestedSize: '1x1' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.hintsWritten).toEqual(['api-monitor']);
    expect(layoutHintsStore.getHint('phantom-agent')).toBeNull();
  });

  it('skips system tiles and invalid field values', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/pulse/layout-plan/commit')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [{ label: 'Group', tiles: ['api-monitor'] }],
        topAgents: [
          { id: '_system-runs-today', rationale: 'x', suggestedSize: '1x1' },
          { id: 'api-monitor', rationale: 'y', suggestedSize: '5x5', suggestedTileFit: 'shrink', suggestedHeight: 40 },
        ],
      });
    expect(res.status).toBe(200);
    // All three fields on api-monitor failed validation; the entry produces no hint.
    expect(layoutHintsStore.getHint('api-monitor')).toBeNull();
    expect(layoutHintsStore.getHint('_system-runs-today')).toBeNull();
  });

  it('still flips pulseVisible when topAgents is omitted', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/pulse/layout-plan/commit')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [{ label: 'Group', tiles: ['api-monitor'] }],
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // api-monitor was already default-visible (pulseVisible undefined),
    // so the commit leaves it alone — no unhide is needed.
    expect(agentStore.getAgent('api-monitor')!.pulseVisible).toBeUndefined();
    // weather wasn't surfaced — flipped to hidden.
    expect(agentStore.getAgent('weather')!.pulseVisible).toBe(false);
    expect(res.body.hintsWritten).toEqual([]);
  });

  it('patches existing hints without clearing other fields', async () => {
    const app = await makeApp();
    layoutHintsStore.setHint('api-monitor', { size: '2x1', tileFit: 'scroll', height: 300 });

    await request(app)
      .post('/pulse/layout-plan/commit')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .send({
        containers: [{ label: 'Group', tiles: ['api-monitor'] }],
        topAgents: [{ id: 'api-monitor', rationale: 'z', suggestedSize: '1x1' }],
      });

    const hint = layoutHintsStore.getHint('api-monitor');
    expect(hint?.size).toBe('1x1');
    expect(hint?.tileFit).toBe('scroll');
    expect(hint?.height).toBe(300);
  });
});
