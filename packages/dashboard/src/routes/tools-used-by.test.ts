/**
 * Smoke test for the "Used by" surface on `/tools/:id`. Doesn't poke the
 * exact HTML — that's brittle — just asserts each agent's id appears in
 * the rendered body when it references the tool, and is absent otherwise.
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
  ToolStore,
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
let toolStore: ToolStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-tools-usedby-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  packsStore = new PacksStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
  toolStore = new ToolStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  // Two agents that use http-get; one that doesn't.
  agentStore.createAgent({
    id: 'fetch-a', name: 'Fetch A', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'go', type: 'shell', tool: 'http-get', toolInputs: { url: 'https://example.com/a' }, dependsOn: [] }],
  }, 'cli');
  agentStore.createAgent({
    id: 'fetch-b', name: 'Fetch B', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'go', type: 'shell', tool: 'http-get', toolInputs: { url: 'https://example.com/b' }, dependsOn: [] }],
  }, 'cli');
  agentStore.createAgent({
    id: 'shell-only', name: 'Shell Only', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'echo', type: 'shell', command: 'echo hi', dependsOn: [] }],
  }, 'cli');

  const ctx: DashboardContext = {
    token: TOKEN,
    allowlist: buildLoopbackAllowlist(PORT),
    port: PORT,
    provider,
    runStore,
    agentStore,
    toolStore,
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
  try { toolStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('GET /tools/:id "Used by" section', () => {
  it('lists agents that reference http-get and excludes those that do not', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools/http-get')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Used by');
    expect(res.text).toMatch(/href="\/agents\/fetch-a"/);
    expect(res.text).toMatch(/href="\/agents\/fetch-b"/);
    expect(res.text).not.toMatch(/href="\/agents\/shell-only"/);
  });

  it('lists shell-only agent under the shell-exec tool', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools/shell-exec')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/href="\/agents\/shell-only"/);
  });

  it('renders an empty-state message when no agents reference the tool', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools/file-write')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/No agents reference this tool yet/);
  });
});
