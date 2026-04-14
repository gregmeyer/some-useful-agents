import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalProvider, RunStore, MemorySecretsStore, loadAgents } from '@some-useful-agents/core';
import { buildDashboardApp } from './index.js';
import type { DashboardContext } from './context.js';
import { SESSION_COOKIE } from './auth-middleware.js';
import { buildLoopbackAllowlist } from '@some-useful-agents/core';

const TOKEN = 'a'.repeat(64);
const PORT = 3999;
const WRONG_TOKEN = 'b'.repeat(64);

let dir: string;
let dbPath: string;
let agentsDir: string;
let provider: LocalProvider;
let runStore: RunStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-dashboard-'));
  dbPath = join(dir, 'runs.db');
  agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  // One safe agent so /agents renders something.
  writeFileSync(join(agentsDir, 'hello.yaml'), `
name: hello
description: Safe shell echo
type: shell
command: echo hello
`.trimStart());
  writeFileSync(join(agentsDir, 'spooky.yaml'), `
name: spooky
description: Community shell (gated)
type: shell
command: echo from-the-internet
`.trimStart());
  // spooky is marked community by moving into community dir.
  mkdirSync(join(dir, 'agents', 'community'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'community', 'spooky.yaml'), `
name: spooky
description: Community shell (gated)
type: shell
command: echo from-the-internet
`.trimStart());
  // Remove the local spooky — community wins.
  rmSync(join(agentsDir, 'spooky.yaml'));

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  const ctx: DashboardContext = {
    token: TOKEN,
    allowlist: buildLoopbackAllowlist(PORT),
    port: PORT,
    provider,
    runStore,
    loadAgents: () => loadAgents({
      directories: [agentsDir, join(dir, 'agents', 'community')],
    }),
    secretsStore,
    allowUntrustedShell: new Set(),
  };

  return buildDashboardApp(ctx);
}

beforeEach(async () => {
  // Each test builds its own app so state is isolated.
});

afterEach(async () => {
  // Drain in-flight runs so the provider's async updateRun calls don't race
  // against store.close() and emit "database is not open" unhandled errors.
  if (provider) {
    const start = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    while ((provider as any).running?.size > 0 && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await provider.shutdown();
  }
  // provider.shutdown() already closed its own RunStore; we opened a
  // separate one for the dashboard context, so close it too.
  try { runStore?.close(); } catch { /* already closed via same DB file */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('Dashboard auth', () => {
  it('returns 200 on /health without a cookie', async () => {
    const app = await makeApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('redirects /agents to /auth without a cookie', async () => {
    const app = await makeApp();
    const res = await request(app).get('/agents').set('Accept', 'text/html').set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth');
  });

  it('401s for /agents when Origin is malicious', async () => {
    const app = await makeApp();
    const res = await request(app).get('/agents')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Origin', 'http://evil.example.com');
    expect(res.status).toBe(403);
  });

  it('403s for /agents with non-loopback Host', async () => {
    const app = await makeApp();
    const res = await request(app).get('/agents').set('Host', 'evil.example.com');
    expect(res.status).toBe(403);
  });

  it('/auth?token=<wrong> returns 401', async () => {
    const app = await makeApp();
    const res = await request(app).get(`/auth?token=${WRONG_TOKEN}`).set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(401);
  });

  it('/auth?token=<right> sets cookie and redirects', async () => {
    const app = await makeApp();
    const res = await request(app).get(`/auth?token=${TOKEN}`).set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('\n') : setCookie;
    expect(cookieStr).toMatch(new RegExp(`${SESSION_COOKIE}=${TOKEN}`));
    expect(cookieStr).toMatch(/HttpOnly/);
    expect(cookieStr).toMatch(/SameSite=Strict/);
  });

  it('cookie-authenticated request to /agents returns 200', async () => {
    const app = await makeApp();
    const res = await request(app).get('/agents')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('hello');
    expect(res.text).toContain('spooky');
  });
});

describe('Dashboard /runs + filters', () => {
  it('returns empty state when no runs exist', async () => {
    const app = await makeApp();
    const res = await request(app).get('/runs')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('No runs match');
  });

  it('filters by agent via query string', async () => {
    const app = await makeApp();
    // Seed directly via runStore for test isolation from provider timing.
    runStore.createRun({
      id: 'r1', agentName: 'hello', status: 'completed', startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });
    runStore.createRun({
      id: 'r2', agentName: 'spooky', status: 'failed', startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });

    const res = await request(app).get('/runs?agent=hello')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('hello');
    // "spooky" appears in the dropdown options; we confirm the filtered
    // table no longer contains the r2 run id.
    expect(res.text).not.toContain('>r2<');
  });

  it('filters by status (multi-status OR)', async () => {
    const app = await makeApp();
    runStore.createRun({ id: 's1', agentName: 'hello', status: 'completed', startedAt: new Date().toISOString(), triggeredBy: 'cli' });
    runStore.createRun({ id: 's2', agentName: 'hello', status: 'failed', startedAt: new Date().toISOString(), triggeredBy: 'cli' });
    runStore.createRun({ id: 's3', agentName: 'hello', status: 'cancelled', startedAt: new Date().toISOString(), triggeredBy: 'cli' });

    const res = await request(app).get('/runs?status=completed&status=failed')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.text).toMatch(/s1/);
    expect(res.text).toMatch(/s2/);
    // s3 is cancelled, should be excluded from the table body
    // (it still appears in the status dropdown though — check with a
    // word-boundary check against the run id)
    expect(res.text).not.toMatch(/>s3</);
  });

  it('ignores unknown status values (defensive)', async () => {
    const app = await makeApp();
    runStore.createRun({ id: 'only', agentName: 'hello', status: 'completed', startedAt: new Date().toISOString(), triggeredBy: 'cli' });

    const res = await request(app).get('/runs?status=bogus')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // With no valid statuses, filter is empty → all rows returned.
    expect(res.text).toContain('only');
  });

  it('preserves filter state in pagination links', async () => {
    const app = await makeApp();
    for (let i = 0; i < 5; i++) {
      runStore.createRun({
        id: `p${i}`, agentName: 'hello', status: 'completed',
        startedAt: new Date(Date.now() - i * 1000).toISOString(), triggeredBy: 'cli',
      });
    }
    const res = await request(app).get('/runs?agent=hello&limit=2')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // Next link should carry the agent filter and limit.
    expect(res.text).toMatch(/href="[^"]*agent=hello[^"]*offset=2/);
  });
});

describe('Dashboard run-now gate', () => {
  it('POST /agents/hello/run submits and redirects to /runs/:id', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/agents/hello/run')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/runs\/[0-9a-f-]+$/);
  });

  it('POST /agents/spooky/run without confirmation redirects back with flash', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/agents/spooky/run')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/agents\/spooky\?flash=/);
  });

  it('POST /agents/spooky/run with confirm= still refused by provider gate (allowUntrustedShell empty)', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/agents/spooky/run')
      .type('form')
      .send({ confirm_community_shell: 'yes' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    // Provider throws UntrustedCommunityShellError; caught by the route
    // and flashed back. Redirect back to the agent page with flash.
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/agents\/spooky\?flash=/);
  });
});
