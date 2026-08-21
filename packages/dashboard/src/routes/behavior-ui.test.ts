/**
 * The two surfaces that make behavior conditioning visible.
 *
 * These exist because the capability shipped without them and was invisible:
 * every run recorded `behaviors_json` and nothing ever displayed it — the same
 * shape as `agent_memory`, which was written and never read for its whole life
 * because no read surface was built.
 *
 * The load-bearing test is the "unusable" one. A declared behavior that will not
 * resolve makes the agent UNRUNNABLE (conditioning fails the run before any node
 * executes), so the page has to say so at design time instead of leaving the
 * operator to discover it as a failed run later.
 */
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  LocalProvider,
  MemorySecretsStore,
  RunStore,
  buildLoopbackAllowlist,
  loadAgents,
  loadBehaviors,
  type Agent,
  type Run,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3996;
const HDRS = { Host: `127.0.0.1:${PORT}`, Cookie: `${SESSION_COOKIE}=${TOKEN}` };

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;

function writeSpec(root: string, name: string, scopeDir = '.agents/behaviors'): void {
  const d = join(root, scopeDir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'BEHAVIOR.md'),
    `---\nname: ${name}\ndescription: Spec for ${name}.\n---\n# ${name}\n\nbody`);
}

async function makeApp(opts: { userRoot?: string } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'sua-behavior-ui-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  const scopes = [
    { scope: 'project' as const, rootDir: dir, optional: true },
    ...(opts.userRoot ? [{ scope: 'user' as const, rootDir: opts.userRoot, optional: true }] : []),
  ];

  const ctx = {
    token: TOKEN,
    allowlist: buildLoopbackAllowlist(PORT),
    port: PORT,
    provider,
    runStore,
    agentStore,
    loadAgents: () => loadAgents({ directories: [agentsDir] }),
    loadBehaviors: () => loadBehaviors({ scopes }),
    secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }),
    tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30,
    dbPath,
    secretsPath: join(dir, 'secrets.enc'),
    rotateToken: () => 'r'.repeat(64),
    allowUntrustedShell: new Set<string>(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  } as unknown as DashboardContext;

  return buildDashboardApp(ctx);
}

function seedAgent(behaviors?: string[]): void {
  agentStore.upsertAgent({
    id: 'demo', name: 'Demo', status: 'active', source: 'local', mcp: false,
    ...(behaviors ? { behaviors } : {}),
    nodes: [{ id: 'work', type: 'claude-code', prompt: 'do it' }],
  } as unknown as Agent, 'import', 'test');
}

function seedRun(id: string, behaviors?: string[]): void {
  runStore.createRun({
    id, agentName: 'demo', status: 'completed',
    startedAt: '2026-08-21T00:00:00.000Z',
    completedAt: '2026-08-21T00:00:05.000Z',
    triggeredBy: 'dashboard',
  } as unknown as Run);
  if (behaviors) runStore.updateRun(id, { behaviors });
}

const get = (app: Awaited<ReturnType<typeof makeApp>>, url: string) =>
  request(app).get(url).set(HDRS);

afterEach(async () => {
  if (provider) await provider.shutdown();
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('agent detail — "Held to"', () => {
  it('lists declared behaviors, each linking to its spec', async () => {
    const app = await makeApp();
    writeSpec(dir, 'declare-blind-spots');
    seedAgent(['declare-blind-spots']);

    const res = await get(app, '/agents/demo');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Held to');
    expect(res.text).toContain('/behaviors/declare-blind-spots');
  });

  it('omits the row entirely when the agent declares none', async () => {
    // Most agents declare none; an empty row on every one would be noise.
    const app = await makeApp();
    seedAgent();
    const res = await get(app, '/agents/demo');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Held to');
  });

  it('flags a behavior that does not exist as unusable', async () => {
    // This agent cannot run at all. Saying so here beats letting the operator
    // find out from a failed run.
    const app = await makeApp();
    seedAgent(['nope']);
    const res = await get(app, '/agents/demo');
    expect(res.status).toBe(200);
    expect(res.text).toContain('unusable');
    expect(res.text).toContain('will fail to run');
  });

  it('flags a user-scope behavior as unusable, since it cannot condition a run', async () => {
    // The subtle case: `sua behaviors list` and /behaviors both SHOW it, so
    // without this the declaration looks perfectly fine.
    const userRoot = mkdtempSync(join(tmpdir(), 'sua-behavior-home-'));
    try {
      const app = await makeApp({ userRoot });
      writeSpec(userRoot, 'ambient');
      seedAgent(['ambient']);
      const res = await get(app, '/agents/demo');
      expect(res.status).toBe(200);
      expect(res.text).toContain('unusable');
    } finally {
      rmSync(userRoot, { recursive: true, force: true });
    }
  });

  it('does not flag a usable project-scope behavior', async () => {
    const app = await makeApp();
    writeSpec(dir, 'fine');
    seedAgent(['fine']);
    const res = await get(app, '/agents/demo');
    expect(res.text).not.toContain('unusable');
  });
});

describe('run detail — "Conditioned by"', () => {
  const RUN_ID = '11111111-2222-3333-4444-555555555555';

  it('shows which behaviors conditioned the run, linked', async () => {
    const app = await makeApp();
    seedAgent(['declare-blind-spots']);
    seedRun(RUN_ID, ['declare-blind-spots']);

    const res = await get(app, `/runs/${RUN_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Conditioned by');
    expect(res.text).toContain('/behaviors/declare-blind-spots');
  });

  it('omits the row for a run that was not conditioned', async () => {
    const app = await makeApp();
    seedAgent();
    seedRun(RUN_ID);
    const res = await get(app, `/runs/${RUN_ID}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Conditioned by');
  });

  it('round-trips the recorded names through the store', async () => {
    // Guards the storage half: behaviors_json is written and read back intact.
    const app = await makeApp();
    seedAgent(['a-one', 'b-two']);
    seedRun(RUN_ID, ['a-one', 'b-two']);
    expect(runStore.getRun(RUN_ID)?.behaviors).toEqual(['a-one', 'b-two']);

    const res = await get(app, `/runs/${RUN_ID}`);
    expect(res.text).toContain('a-one');
    expect(res.text).toContain('b-two');
  });
});
