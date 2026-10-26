/**
 * Inbox thread-usability routes (control-plane Phase 2): reopen and summarize.
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
