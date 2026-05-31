/**
 * Regression test for the X-button on a pulse tile.
 *
 * The handler used to toggle the legacy `signal.hidden` field, but the
 * pulse-visibility filter has preferred `pulseVisible` since v0.19 —
 * once any agent had pulseVisible set (which the Config-tab visibility
 * toggle does on the first click), the X button posted successfully
 * but the tile stayed visible. This test locks in the new behaviour:
 * clicking X flips pulseVisible so the next render hides the tile.
 */

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
const PORT = 3997;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp(initial: { pulseVisible?: boolean }) {
  dir = mkdtempSync(join(tmpdir(), 'sua-pulse-toggle-'));
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

  agentStore.createAgent({
    id: 'tile-a',
    name: 'Tile A',
    status: 'active',
    source: 'local',
    mcp: false,
    pulseVisible: initial.pulseVisible,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    signal: { title: 'A', template: 'text-headline', mapping: { headline: 'result' } },
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
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
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

describe('POST /agents/:id/signal/toggle', () => {
  it('hides a tile whose pulseVisible was previously true', async () => {
    const app = await makeApp({ pulseVisible: true });
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(true);
    const res = await request(app).post('/agents/tile-a/signal/toggle')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(false);
  });

  it('hides a tile whose pulseVisible was undefined (default visible)', async () => {
    const app = await makeApp({});
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBeUndefined();
    const res = await request(app).post('/agents/tile-a/signal/toggle')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(false);
  });

  it('restores a tile whose pulseVisible was false', async () => {
    const app = await makeApp({ pulseVisible: false });
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(false);
    const res = await request(app).post('/agents/tile-a/signal/toggle')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(true);
  });
});
