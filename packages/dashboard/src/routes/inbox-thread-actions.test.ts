/**
 * Inbox thread-usability routes (control-plane Phase 2): reopen, summarize,
 * fork (new thread + provenance), retarget (rewrite this thread's agent link).
 * Each route runs in dual 204/303 mode; these assert the store side effects
 * via the AJAX (X-Requested-With) path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  InboxStore,
  LocalProvider,
  MemorySecretsStore,
  RunStore,
  buildLoopbackAllowlist,
  loadAgents,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3992;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
const AJAX = { Cookie: COOKIE, Host: `127.0.0.1:${PORT}`, 'X-Requested-With': 'fetch' };

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let inboxStore: InboxStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-inbox-thread-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  inboxStore = new InboxStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  // A real, non-system agent to fork/retarget onto.
  agentStore.createAgent({
    id: 'target-agent', name: 'Target', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
  }, 'cli');

  const ctx: DashboardContext = {
    token: TOKEN, allowlist: buildLoopbackAllowlist(PORT), port: PORT, provider,
    runStore, agentStore, loadAgents: () => loadAgents({ directories: [agentsDir] }),
    secretsStore, secretsSession: new MemorySecretsSession({ backing: secretsStore }),
    tokenPath: join(dir, 'mcp-token'), retentionDays: 30, dbPath,
    secretsPath: join(dir, 'secrets.enc'), rotateToken: () => 'r'.repeat(64), inboxStore,
    allowUntrustedShell: new Set(), activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(), inboxTriagePendingRefires: new Set(),
    dataDir: dir, dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  };
  return buildDashboardApp(ctx);
}

afterEach(async () => {
  if (provider) await provider.shutdown();
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { inboxStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function newThread() {
  return inboxStore.add({ priority: 'medium', source: 'manual', title: 'My thread', body: 'b', agentId: 'old-agent' });
}

describe('POST /inbox/:id/reopen', () => {
  it('flips a resolved thread back to open and posts a note', async () => {
    const app = await makeApp();
    const m = newThread();
    inboxStore.updateStatus(m.id, 'resolved');
    const res = await request(app).post(`/inbox/${m.id}/reopen`).set(AJAX);
    expect(res.status).toBe(204);
    expect(inboxStore.get(m.id)!.status).toBe('open');
    expect(inboxStore.listResponses(m.id).some((r) => r.role === 'system' && /reopened/i.test(r.body))).toBe(true);
  });
});

describe('POST /inbox/:id/summarize', () => {
  it('posts a derived summary as a system note', async () => {
    const app = await makeApp();
    const m = newThread();
    inboxStore.addResponse(m.id, 'user', 'Please show me a random comic');
    const res = await request(app).post(`/inbox/${m.id}/summarize`).set(AJAX);
    expect(res.status).toBe(204);
    const sys = inboxStore.listResponses(m.id).find((r) => r.role === 'system');
    expect(sys?.body).toMatch(/Thread summary/);
    expect(sys?.body).toMatch(/Goal: Please show me a random comic/);
  });
});

describe('POST /inbox/:id/fork', () => {
  it('creates a child thread targeting the agent with provenance', async () => {
    const app = await makeApp();
    const m = newThread();
    const res = await request(app).post(`/inbox/${m.id}/fork`).set(AJAX).send('agentId=target-agent');
    expect(res.status).toBe(204);
    const forkedId = res.headers['x-inbox-id'];
    expect(forkedId).toBeTruthy();
    const forked = inboxStore.get(forkedId)!;
    expect(forked.agentId).toBe('target-agent');
    expect(forked.title).toContain('→ target-agent');
    expect(JSON.parse(forked.contextJson!).forkedFromThreadId).toBe(m.id);
    // Both threads get a cross-link system note.
    expect(inboxStore.listResponses(m.id).some((r) => r.role === 'system' && /Forked this thread/.test(r.body))).toBe(true);
  });

  it('rejects an unknown agent', async () => {
    const app = await makeApp();
    const m = newThread();
    const res = await request(app).post(`/inbox/${m.id}/fork`).set(AJAX).send('agentId=ghost');
    expect(res.status).toBe(400);
  });
});

describe('POST /inbox/:id/retarget', () => {
  it('rewrites the thread agent link and posts a note', async () => {
    const app = await makeApp();
    const m = newThread();
    const res = await request(app).post(`/inbox/${m.id}/retarget`).set(AJAX).send('agentId=target-agent');
    expect(res.status).toBe(204);
    const got = inboxStore.get(m.id)!;
    expect(got.agentId).toBe('target-agent');
    expect(JSON.parse(got.contextJson!).linkedAgentId).toBe('target-agent');
    expect(inboxStore.listResponses(m.id).some((r) => r.role === 'system' && /Retargeted/.test(r.body))).toBe(true);
  });

  it('rejects an unknown agent', async () => {
    const app = await makeApp();
    const m = newThread();
    const res = await request(app).post(`/inbox/${m.id}/retarget`).set(AJAX).send('agentId=ghost');
    expect(res.status).toBe(400);
    expect(inboxStore.get(m.id)!.agentId).toBe('old-agent');
  });
});
