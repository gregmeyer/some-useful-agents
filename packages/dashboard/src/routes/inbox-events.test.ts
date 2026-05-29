/**
 * Smoke tests for the SSE endpoint at GET /inbox/:id/events.
 *
 * Supertest doesn't fully stream open connections, but we can drive
 * the route, read the initial frames, and verify wire format +
 * auth + 404 handling. Full end-to-end (with multiple events
 * flowing) is exercised by live dogfood — see PR #403 description.
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
import { InboxEventBus } from '../lib/inbox-event-bus.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3994;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let inboxEventBus: InboxEventBus;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-sse-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  inboxStore = new InboxStore(dbPath);
  inboxEventBus = new InboxEventBus({ idleGcMs: 60_000 });
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
    inboxStore,
    inboxEventBus,
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
  if (inboxEventBus) inboxEventBus.dropAll();
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { inboxStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('GET /inbox/:id/events (SSE)', () => {
  it('returns 404 when the inbox message does not exist', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/inbox/ghost/events')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(404);
  });

  it('requires auth (no cookie → 401)', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/inbox/anything/events')
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(401);
  });

  it('opens with the SSE content-type and an initial open frame', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // Pre-publish a single event so the response body has something
    // to flush. Supertest's response object closes once the body is
    // received, which on a real stream would be open-ended — but our
    // initial padding + the buffered event get flushed together.
    inboxEventBus.publish(m.id, { type: 'state', data: { phase: 'idle' } });

    // Use a short timeout so the test doesn't hang on the keep-alive
    // stream. We're only here to verify wire format. Last-Event-ID
    // of `:0` forces the route to replay every buffered event — a
    // fresh client wouldn't see the pre-published event otherwise
    // (which is correct production behavior — they'd hit /fragment
    // for the snapshot, then subscribe for new events).
    const req = request(app)
      .get(`/inbox/${m.id}/events`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .set('Last-Event-ID', `${m.id}:0`)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf-8');
          // Once we've seen our pre-published event, close the
          // connection so the test doesn't hang.
          if (data.includes('event: state')) res.destroy();
        });
        res.on('close', () => cb(null, data));
        res.on('error', () => cb(null, data));
      });
    const res = await req;
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-cache');
    const body = res.body as string;
    expect(body).toContain(': open');
    expect(body).toContain(`id: ${m.id}:1`);
    expect(body).toContain('event: state');
    expect(body).toContain('"phase":"idle"');
  });

  it('replays buffered events newer than Last-Event-ID', async () => {
    const app = await makeApp();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // Publish 3 events; client claims to have seen up to id 1.
    inboxEventBus.publish(m.id, { type: 'a', data: {} });
    inboxEventBus.publish(m.id, { type: 'b', data: {} });
    inboxEventBus.publish(m.id, { type: 'c', data: {} });

    const req = request(app)
      .get(`/inbox/${m.id}/events`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE)
      .set('Last-Event-ID', `${m.id}:1`)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf-8');
          if (data.includes('event: c')) res.destroy();
        });
        res.on('close', () => cb(null, data));
        res.on('error', () => cb(null, data));
      });
    const res = await req;
    const body = res.body as string;
    // Replays b (id 2) and c (id 3) only — a (id 1) is gone.
    expect(body).not.toContain('event: a');
    expect(body).toContain('event: b');
    expect(body).toContain('event: c');
    expect(body).toContain(`id: ${m.id}:2`);
    expect(body).toContain(`id: ${m.id}:3`);
  });
});
