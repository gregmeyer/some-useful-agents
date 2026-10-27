import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { saveRunFile, runFilesDir } from '@some-useful-agents/core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  InboxStore,
  LocalProvider,
  MemorySecretsStore,
  RunStore,
  buildLoopbackAllowlist,
  executeAgentDag,
  loadAgents,
  type Agent,
  type SpawnNodeFn,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../session.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3993;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
let dir = '';
let ctx: DashboardContext;
let provider: LocalProvider;

const model: SpawnNodeFn = async () => ({ result: 'ok', exitCode: 0 });

async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-run-files-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  const secretsStore = new MemorySecretsStore();
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  ctx = {
    token: TOKEN, allowlist: buildLoopbackAllowlist(PORT), port: PORT, provider,
    runStore: new RunStore(dbPath), agentStore: new AgentStore(dbPath), inboxStore: new InboxStore(dbPath),
    loadAgents: () => loadAgents({ directories: [agentsDir] }), secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }), tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30, dbPath, secretsPath: join(dir, 'secrets.enc'), rotateToken: () => 'r'.repeat(64),
    allowUntrustedShell: new Set(), activeRuns: new Map(), inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(), dataDir: dir, dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  } as DashboardContext;
  ctx.agentStore.createAgent({ id: 'looker', name: 'Looker', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'look', type: 'llm-prompt', prompt: 'x' }] } as never, 'cli');
  const run = await executeAgentDag(ctx.agentStore.getAgent('looker') as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: model });
  return { app: buildDashboardApp(ctx), run };
}

afterEach(async () => {
  await provider?.shutdown();
  try { ctx.runStore.close(); ctx.agentStore.close(); ctx.inboxStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);

describe('files a run kept', () => {
  it('serves a run\'s screenshot by name, shows it on its node, and nothing outside the run', async () => {
    const { app, run } = await setup();
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const name = saveRunFile({ dir: runFilesDir(ctx.agentStore.dataRoot, run.id), nodeId: 'look' }, png);
    expect(name).toBe('look-1.png');

    const res = await get(app, `/runs/${run.id}/files/look-1.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-security-policy']).toContain('sandbox');

    expect((await get(app, `/runs/${run.id}`)).text).toContain(`href="/runs/${run.id}/files/look-1.png"`);

    expect((await get(app, `/runs/${run.id}/files/look-2.png`)).status).toBe(404);
    expect((await get(app, `/runs/${run.id}/files/..%2Fruns.db`)).status).toBe(404);
    expect((await get(app, `/runs/${run.id}/files/notes.txt`)).status).toBe(404);
    expect((await get(app, `/runs/..%2F..%2Fx/files/look-1.png`)).status).toBe(404);
    // Signed out: no file.
    expect((await request(app).get(`/runs/${run.id}/files/look-1.png`).set('Host', `127.0.0.1:${PORT}`)).status).not.toBe(200);
  });
});
