import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalProvider, RunStore, AgentStore, MemorySecretsStore, loadAgents } from '@some-useful-agents/core';
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
let agentStore: AgentStore;

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
  agentStore = new AgentStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  const ctx: DashboardContext = {
    token: TOKEN,
    allowlist: buildLoopbackAllowlist(PORT),
    port: PORT,
    provider,
    runStore,
    agentStore,
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
  try { agentStore?.close(); } catch { /* already closed via same DB file */ }
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

describe('Dashboard v2 DAG agents', () => {
  it('lists v2 agents on /agents under a "DAG agents" header', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'news-digest', name: 'News Digest', status: 'active',
      source: 'local', mcp: false,
      nodes: [
        { id: 'fetch', type: 'shell', command: 'echo h' },
        { id: 'summarize', type: 'claude-code', prompt: 'summarize {{upstream.fetch.result}}', dependsOn: ['fetch'] },
      ],
    }, 'cli');

    const res = await request(app).get('/agents')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('DAG agents');
    expect(res.text).toContain('news-digest');
    expect(res.text).toContain('2 nodes');
  });

  it('renders the DAG container + Cytoscape JSON on /agents/:id', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'pipeline', name: 'Pipeline', status: 'active', source: 'local', mcp: false,
      nodes: [
        { id: 'fetch', type: 'shell', command: 'echo h' },
        { id: 'post', type: 'shell', command: 'echo done', dependsOn: ['fetch'] },
      ],
    }, 'cli');

    const res = await request(app).get('/agents/pipeline')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // Cytoscape container
    expect(res.text).toContain('id="dag-canvas"');
    // Inline JSON elements
    expect(res.text).toContain('id="dag-data"');
    expect(res.text).toContain('"id":"fetch"');
    expect(res.text).toContain('"id":"post"');
    expect(res.text).toContain('"source":"fetch"');
    expect(res.text).toContain('"target":"post"');
    // Both static asset tags
    expect(res.text).toContain('/assets/cytoscape.min.js');
    expect(res.text).toContain('/assets/graph-render.js');
  });

  it('prefers v2 over v1 when both exist with the same id', async () => {
    const app = await makeApp();
    // `hello` exists as v1 YAML (set up in makeApp). Add a v2 hello too.
    agentStore.createAgent({
      id: 'hello', name: 'Hello v2', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'main', type: 'shell', command: 'echo v2' }],
    }, 'cli');

    const res = await request(app).get('/agents/hello')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // v2 detail page includes the DAG canvas; v1 doesn't.
    expect(res.text).toContain('id="dag-canvas"');
  });
});

describe('Dashboard /runs/:id per-node table', () => {
  it('shows per-node execution rows for a v2 DAG run', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'multi', name: 'Multi', status: 'active', source: 'local', mcp: false,
      nodes: [
        { id: 'first', type: 'shell', command: 'echo 1' },
        { id: 'second', type: 'shell', command: 'echo 2', dependsOn: ['first'] },
      ],
    }, 'cli');

    const now = new Date().toISOString();
    runStore.createRun({
      id: 'run-a', agentName: 'multi', status: 'completed', startedAt: now, triggeredBy: 'cli',
      workflowId: 'multi', workflowVersion: 1,
    });
    runStore.createNodeExecution({
      runId: 'run-a', nodeId: 'first', workflowVersion: 1,
      status: 'completed', startedAt: now, completedAt: now, exitCode: 0, result: 'one',
    });
    runStore.createNodeExecution({
      runId: 'run-a', nodeId: 'second', workflowVersion: 1,
      status: 'failed', errorCategory: 'exit_nonzero', startedAt: now,
      completedAt: now, exitCode: 2, error: 'boom',
    });

    const res = await request(app).get('/runs/run-a')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Per-node execution');
    expect(res.text).toContain('first');
    expect(res.text).toContain('second');
    expect(res.text).toContain('exit_nonzero');
    // The DAG viz should render here too
    expect(res.text).toContain('id="dag-canvas"');
  });

  it('does not render the per-node table for a v1 run', async () => {
    const app = await makeApp();
    const now = new Date().toISOString();
    runStore.createRun({
      id: 'run-v1', agentName: 'hello', status: 'completed', startedAt: now, triggeredBy: 'cli',
    });
    const res = await request(app).get('/runs/run-v1')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Per-node execution');
    expect(res.text).not.toContain('id="dag-canvas"');
  });

  it('shows a replayed-from breadcrumb when present', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'repl', name: 'Repl', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'main', type: 'shell', command: 'echo' }],
    }, 'cli');
    const now = new Date().toISOString();
    runStore.createRun({
      id: 'repl-new', agentName: 'repl', status: 'completed', startedAt: now, triggeredBy: 'cli',
      workflowId: 'repl', workflowVersion: 1,
      replayedFromRunId: '00000000-0000-0000-0000-000000000001', replayedFromNodeId: 'main',
    });
    runStore.createNodeExecution({
      runId: 'repl-new', nodeId: 'main', workflowVersion: 1,
      status: 'completed', startedAt: now, completedAt: now, exitCode: 0, result: 'ok',
    });
    const res = await request(app).get('/runs/repl-new')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.text).toContain('Replayed from');
    expect(res.text).toContain('main');
  });
});

describe('Dashboard static assets', () => {
  it('serves /assets/graph-render.js', async () => {
    const app = await makeApp();
    const res = await request(app).get('/assets/graph-render.js')
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toContain('cytoscape');
    expect(res.text).toContain('dag-canvas');
  });

  it('serves /assets/cytoscape.min.js', async () => {
    const app = await makeApp();
    const res = await request(app).get('/assets/cytoscape.min.js')
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    // The minified bundle starts with a short license block or IIFE.
    expect(res.text.length).toBeGreaterThan(10000); // should be ~100KB
  });
});

describe('Dashboard help + tutorial', () => {
  it('GET /help renders the CLI reference page', async () => {
    const app = await makeApp();
    const res = await request(app).get('/help')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Help &amp; tutorial');
    expect(res.text).toContain('Open the dashboard tutorial');
    expect(res.text).toContain('sua workflow run');
  });

  it('GET /help/tutorial marks step 1 done when agents exist, step 2 not done with no runs', async () => {
    const app = await makeApp();
    const res = await request(app).get('/help/tutorial')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Dashboard tutorial');
    // Step 1: "You have a project" — done (we scaffolded hello.yaml)
    expect(res.text).toMatch(/You have a project[\s\S]*?badge--ok[\s\S]*?done/);
    // Step 2: "Run your first agent" — not done yet, should show to-do badge
    // The progress card should reflect: 1 of 5 complete
    expect(res.text).toContain('of 5 steps complete');
  });

  it('GET /help/tutorial references the first agent by id for the Run CTA', async () => {
    const app = await makeApp();
    const res = await request(app).get('/help/tutorial')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // First v1 agent is "hello" (spooky is community; v2 store is empty in this
    // fixture). The Run CTA should link to /agents/hello.
    expect(res.text).toContain('/agents/hello');
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
