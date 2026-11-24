/**
 * One way for a test to build a dashboard and take it down again.
 *
 * `createTestContext` makes a temp dir, the stores every route needs and a
 * LocalProvider, and returns a context with `live` unset (no queue watchers,
 * no system-agent model runs). `closeTestContext` stops what the test's
 * routes started (Run now, triage, everything launched through
 * `inBackground`) and waits for it, THEN closes the stores and removes the dir.
 * Work that won't stop fails the test that started it, by label, instead of
 * writing to a closed database during some later test.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Application } from 'express';
import request from 'supertest';
import {
  AgentStore, LocalProvider, MemorySecretsStore, RunStore, buildLoopbackAllowlist, loadAgents,
} from '@some-useful-agents/core';
import type { DashboardContext } from './context.js';
import { SESSION_COOKIE } from './session.js';
import { MemorySecretsSession } from './secrets-session.js';

export const TEST_TOKEN = 'a'.repeat(64);
export const TEST_COOKIE = `${SESSION_COOKIE}=${TEST_TOKEN}`;

export interface TestContextOptions {
  /** Port the allowlist and base URL name (requests set a matching Host). Default 3999. */
  port?: number;
  /** Temp dir prefix, for telling leftovers apart. */
  prefix?: string;
  /** Extra or replacement context fields; a function gets the dir and db path to build stores on. */
  extra?: Partial<DashboardContext> | ((paths: { dir: string; dbPath: string; agentsDir: string }) => Partial<DashboardContext>);
}

export interface TestContext {
  ctx: DashboardContext;
  dir: string;
  dbPath: string;
  agentsDir: string;
  provider: LocalProvider;
}

export async function createTestContext(opts: TestContextOptions = {}): Promise<TestContext> {
  const port = opts.port ?? 3999;
  const dir = mkdtempSync(join(tmpdir(), opts.prefix ?? 'sua-test-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  const secretsStore = new MemorySecretsStore();
  const provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  const extra = typeof opts.extra === 'function' ? opts.extra({ dir, dbPath, agentsDir }) : opts.extra ?? {};
  const ctx: DashboardContext = {
    token: TEST_TOKEN,
    allowlist: buildLoopbackAllowlist(port),
    port,
    provider,
    runStore: new RunStore(dbPath),
    agentStore: new AgentStore(dbPath),
    loadAgents: () => loadAgents({ directories: [agentsDir] }),
    secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }),
    tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30,
    dbPath,
    secretsPath: join(dir, 'secrets.enc'),
    rotateToken: () => 'r'.repeat(64),
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${port}`,
    ...extra,
  };
  return { ctx, dir, dbPath, agentsDir, provider };
}

/**
 * Stop and wait out the test's in-flight work, then close every store on the
 * context and remove the dir. Throws, naming the work, if it didn't finish
 * within `timeoutMs`.
 */
export async function closeTestContext(t: TestContext | undefined, timeoutMs = 3000): Promise<void> {
  if (!t) return;
  const { ctx } = t;
  const start = Date.now();
  for (const c of ctx.activeRuns.values()) c.abort();
  for (const tr of ctx.inboxTriageAbortControllers.values()) tr.controller.abort();
  while ((ctx.activeRuns.size > 0 || ctx.inboxTriageAbortControllers.size > 0) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const runs = [...ctx.activeRuns.keys()].map((id) => `run ${id}`);
  const left = [...runs, ...(await ctx.background?.drain(Math.max(0, timeoutMs - (Date.now() - start))) ?? [])];
  try { await t.provider.shutdown(); } catch { /* closing anyway */ }
  if (ctx.provider !== t.provider) { try { await ctx.provider.shutdown(); } catch { /* closing anyway */ } }
  // Every store on the context with a close(): RunStore, AgentStore, InboxStore, BoardsStore, ...
  for (const value of Object.values(ctx)) {
    if (value && typeof value === 'object' && 'close' in value && typeof (value as { close: unknown }).close === 'function'
      && value !== ctx.provider && !(value instanceof Map) && !(value instanceof Set)) {
      try { (value as { close: () => void }).close(); } catch { /* already closed */ }
    }
  }
  rmSync(t.dir, { recursive: true, force: true });
  if (left.length) throw new Error(`Work this test started was still running at teardown: ${left.join(', ')}`);
}

/** supertest GET/POST with the Host, Origin and session cookie the auth middleware wants. */
export function testClient(app: Application, port = 3999) {
  const host = `127.0.0.1:${port}`;
  return {
    get: (path: string) => request(app).get(path).set('Host', host).set('Cookie', TEST_COOKIE),
    post: (path: string, body?: object) => {
      const r = request(app).post(path).set('Host', host).set('Origin', `http://${host}`).set('Cookie', TEST_COOKIE);
      return body === undefined ? r : r.send(body);
    },
  };
}
