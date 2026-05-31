import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  LocalProvider,
  MemorySecretsStore,
  PlannerTelemetryStore,
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
let plannerTelemetryStore: PlannerTelemetryStore;

async function makeApp(): Promise<ReturnType<typeof buildDashboardApp>> {
  dir = mkdtempSync(join(tmpdir(), 'sua-metrics-planner-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, 'hello.yaml'), 'name: hello\ntype: shell\ncommand: echo hi\n');

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  plannerTelemetryStore = new PlannerTelemetryStore(dbPath);
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
    plannerTelemetryStore,
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
  try { plannerTelemetryStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('GET /metrics/planner', () => {
  it('renders an empty-state page when no rows exist', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/metrics/planner')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Planner metrics');
    expect(res.text).toContain('No completed plan-extracts');
  });

  it('renders headline metrics + recent rows when telemetry has data', async () => {
    const app = await makeApp();
    plannerTelemetryStore.recordStart('run-a', 'build me a daily news digest');
    plannerTelemetryStore.recordExtract({
      runId: 'run-a',
      status: 'ok',
      autofixCount: 1,
      timeToPlanMs: 4500,
      intent: 'agent',
    });
    plannerTelemetryStore.recordCommit('run-a', 12000);

    plannerTelemetryStore.recordStart('run-b', 'fetch ashby jobs');
    plannerTelemetryStore.recordExtract({
      runId: 'run-b',
      status: 'schema-invalid',
      autofixCount: 0,
      validationErrors: 2,
      timeToPlanMs: 6000,
    });

    const res = await request(app)
      .get('/metrics/planner')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    // Headline metrics — 2 attempted, 1 committed = 50% commit rate.
    expect(res.text).toContain('50.0%');
    // First-attempt-clean rate = 1/2 = 50%.
    expect(res.text).toMatch(/extract=ok/);
    // Histogram surfaces both statuses.
    expect(res.text).toContain('schema-invalid');
    expect(res.text).toContain('ok');
    // Recent table renders truncated runId + intent + goal.
    expect(res.text).toContain('run-a'.slice(0, 8));
    expect(res.text).toContain('build me a daily news digest');
  });

  it('clamps the days query param to [1, 90]', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/metrics/planner?days=99999')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    // Clamp to 90.
    expect(res.text).toContain('the last 90 days');
  });
});
