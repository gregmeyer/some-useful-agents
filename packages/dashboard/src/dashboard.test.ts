import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalProvider, RunStore, AgentStore, MemorySecretsStore, ToolStore, loadAgents } from '@some-useful-agents/core';
import { buildDashboardApp } from './index.js';
import type { DashboardContext } from './context.js';
import { SESSION_COOKIE } from './auth-middleware.js';
import { buildLoopbackAllowlist } from '@some-useful-agents/core';
import { MemorySecretsSession } from './secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3999;
const WRONG_TOKEN = 'b'.repeat(64);

let dir: string;
let dbPath: string;
let agentsDir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;

interface AppOverrides {
  secretsSession?: MemorySecretsSession;
  rotateToken?: () => string;
  retentionDays?: number;
  toolStore?: ToolStore;
}

async function makeAppWithCtx(overrides: AppOverrides = {}) {
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

  const secretsSession = overrides.secretsSession ?? new MemorySecretsSession({ backing: secretsStore });

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
    toolStore: overrides.toolStore,
    secretsSession,
    tokenPath: join(dir, 'mcp-token'),
    retentionDays: overrides.retentionDays ?? 30,
    dbPath,
    secretsPath: join(dir, 'secrets.enc'),
    rotateToken: overrides.rotateToken ?? (() => 'r'.repeat(64)),
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  };

  return { app: buildDashboardApp(ctx), ctx };
}

async function makeApp(overrides: AppOverrides = {}) {
  const { app } = await makeAppWithCtx(overrides);
  return app;
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

  it('POST /auth with wrong token returns 401', async () => {
    const app = await makeApp();
    const res = await request(app).post('/auth')
      .set('Host', `127.0.0.1:${PORT}`)
      .send({ token: WRONG_TOKEN });
    expect(res.status).toBe(401);
  });

  it('POST /auth with correct token sets cookie and redirects', async () => {
    const app = await makeApp();
    const res = await request(app).post('/auth')
      .set('Host', `127.0.0.1:${PORT}`)
      .send({ token: TOKEN });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('\n') : setCookie;
    expect(cookieStr).toMatch(new RegExp(`${SESSION_COOKIE}=${TOKEN}`));
    expect(cookieStr).toMatch(/HttpOnly/);
    expect(cookieStr).toMatch(/SameSite=Strict/);
  });

  it('GET /auth returns 200 with auth page (token read from fragment client-side)', async () => {
    const app = await makeApp();
    const res = await request(app).get('/auth').set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('auth-hint');
    expect(res.text).toContain('location.hash');
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
    // Dedicated "No runs yet" state (PR 5 polish) — was "No runs match"
    // which didn't read right for a fresh install with no filters set.
    expect(res.text).toContain('No runs yet');
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
    // Cards replaced the old table+header layout in v0.15 PR 1.5.
    // Check that v2 agents render as agent cards with the right content.
    expect(res.text).toContain('class="agent-card"');
    expect(res.text).toContain('news-digest');
    expect(res.text).toMatch(/<strong>2<\/strong>\s*nodes/);
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
    expect(res.text).toContain('Node execution');
    expect(res.text).toContain('first');
    expect(res.text).toContain('second');
    expect(res.text).toContain('Non-zero exit code');
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
    expect(res.text).not.toContain('Node execution');
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
    expect(res.text).toContain('of 7 steps complete');
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

describe('Dashboard tutorial scaffold endpoints (PR 1.6)', () => {
  it('POST /help/tutorial/scaffold-hello creates a hello agent in AgentStore', async () => {
    const app = await makeApp();
    // Sanity: hello doesn't yet exist in the v2 store.
    expect(agentStore.getAgent('hello')).toBeFalsy();

    const res = await request(app)
      .post('/help/tutorial/scaffold-hello')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    // Redirects to the agent detail page so the user sees the DAG +
    // composition immediately, not a flash on the tutorial page. The
    // ?from=tutorial query carries multi-hop origin context so the
    // eventual run detail's back link says "Back to tutorial".
    expect(res.headers.location).toMatch(/^\/agents\/hello\?from=tutorial&flash=/);

    const created = agentStore.getAgent('hello');
    expect(created).toBeDefined();
    expect(created!.nodes).toHaveLength(1);
    expect(created!.nodes[0].type).toBe('shell');
    expect(created!.source).toBe('local');
  });

  it('POST /help/tutorial/scaffold-demo-dag creates a 2-node DAG with fetch -> digest', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/help/tutorial/scaffold-demo-dag')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);

    const created = agentStore.getAgent('demo-digest');
    expect(created).toBeDefined();
    expect(created!.nodes).toHaveLength(2);
    expect(created!.nodes[0].id).toBe('fetch');
    expect(created!.nodes[1].id).toBe('digest');
    expect(created!.nodes[1].dependsOn).toEqual(['fetch']);
  });

  it('POST /help/tutorial/scaffold-hello is idempotent — second call surfaces a flash, no duplicate', async () => {
    const app = await makeApp();
    await request(app).post('/help/tutorial/scaffold-hello')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    const res2 = await request(app).post('/help/tutorial/scaffold-hello')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res2.status).toBe(303);
    expect(decodeURIComponent(res2.headers.location)).toMatch(/already exists/);
    // Still exactly one agent with that id.
    expect(agentStore.listAgents().filter((a) => a.id === 'hello')).toHaveLength(1);
  });

  it('GET /help/tutorial shows inline action buttons (not just navigation links)', async () => {
    const app = await makeApp();
    const res = await request(app).get('/help/tutorial')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // Step 2 when no runs: a real POST form to run the first agent.
    expect(res.text).toMatch(/action="\/agents\/hello\/run"/);
    // Step 4 when no DAG run: a scaffold-dag button.
    expect(res.text).toContain('/help/tutorial/scaffold-demo-dag');
  });
});

describe('Dashboard /agents/new create form (PR 1.6)', () => {
  it('GET /agents/new renders the form', async () => {
    const app = await makeApp();
    const res = await request(app).get('/agents/new')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('New agent');
    expect(res.text).toContain('name="id"');
    expect(res.text).toContain('name="command"');
    expect(res.text).toContain('name="prompt"');
  });

  it('POST /agents/new creates a single-node shell agent and redirects', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/agents/new')
      .type('form')
      .send({ id: 'test-echo', name: 'Test Echo', type: 'shell', command: 'echo hi' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    // After creation we land on the add-node form so the user can chain
    // a downstream node, with a fromCreate flag for the friendlier copy.
    expect(res.headers.location).toMatch(/^\/agents\/test-echo\/add-node\?fromCreate=1$/);

    const created = agentStore.getAgent('test-echo');
    expect(created).toBeDefined();
    expect(created!.name).toBe('Test Echo');
    expect(created!.nodes[0].type).toBe('shell');
    expect(created!.nodes[0].command).toBe('echo hi');
  });

  it('POST /agents/new rejects invalid id with 400 + re-rendered form', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/agents/new')
      .type('form')
      .send({ id: 'Invalid ID!', name: 'x', type: 'shell', command: 'echo' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Id must be lowercase/);
    // Form re-populates with user's attempt so they don't lose input.
    expect(res.text).toContain('Invalid ID!');
  });

  it('POST /agents/new rejects duplicate id', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'already-here', name: 'X', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo' }],
    }, 'cli');

    const res = await request(app)
      .post('/agents/new')
      .type('form')
      .send({ id: 'already-here', name: 'Y', type: 'shell', command: 'echo' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/already exists/);
  });

  it('POST /agents/new for claude-code type requires prompt', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/agents/new')
      .type('form')
      .send({ id: 'needs-prompt', name: 'x', type: 'claude-code', prompt: '' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Claude-Code agents need a prompt/);
  });
});

describe('Dashboard /agents/:id/add-node chain flow (PR 1.6)', () => {
  it('GET /agents/:id/add-node renders the form with current nodes listed', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'chain-base', name: 'X', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'first', type: 'shell', command: 'echo hi' }],
    }, 'cli');

    const res = await request(app).get('/agents/chain-base/add-node')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Add node to chain-base');
    expect(res.text).toContain('first');
    // The dependsOn checkbox for the existing node should be present.
    expect(res.text).toMatch(/name="dependsOn" value="first"/);
  });

  it('POST /agents/:id/add-node appends a downstream node and bumps version', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'chain', name: 'X', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo a' }],
    }, 'cli');

    const res = await request(app)
      .post('/agents/chain/add-node')
      .type('form')
      .send({ id: 'b', type: 'shell', command: 'echo b', dependsOn: 'a' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/agents\/chain\/add-node\?flash=/);

    const updated = agentStore.getAgent('chain');
    expect(updated).toBeDefined();
    expect(updated!.nodes).toHaveLength(2);
    expect(updated!.nodes[1].id).toBe('b');
    expect(updated!.nodes[1].dependsOn).toEqual(['a']);
    // upsertAgent created a new version when the DAG changed.
    expect(updated!.version).toBe(2);
  });

  it('POST /agents/:id/add-node rejects unknown upstream node', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'chain2', name: 'X', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');

    const res = await request(app)
      .post('/agents/chain2/add-node')
      .type('form')
      .send({ id: 'b', type: 'shell', command: 'echo', dependsOn: 'nonexistent' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Unknown upstream node/);
  });

  it('POST /agents/:id/add-node rejects duplicate node id within the agent', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'chain3', name: 'X', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');

    const res = await request(app)
      .post('/agents/chain3/add-node')
      .type('form')
      .send({ id: 'a', type: 'shell', command: 'echo' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/already exists/);
  });
});

describe('Dashboard contextual back link (PR 1.6)', () => {
  it('renders a "Back to runs" link on /runs/:id when Referer is /runs', async () => {
    const app = await makeApp();
    runStore.createRun({
      id: 'back-test', agentName: 'hello', status: 'completed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });

    const res = await request(app).get('/runs/back-test')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Referer', `http://127.0.0.1:${PORT}/runs?status=completed`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('page-header__back');
    expect(res.text).toContain('Back to runs');
  });

  it('omits the back link when the Referer is off-host', async () => {
    const app = await makeApp();
    runStore.createRun({
      id: 'back-test-2', agentName: 'hello', status: 'completed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });

    const res = await request(app).get('/runs/back-test-2')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Referer', 'http://evil.example.com/some-page')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('page-header__back');
  });
});

describe('Dashboard version history + status toggle (PR 2)', () => {
  async function seedTwoVersionAgent(id = 'ver-test') {
    agentStore.createAgent({
      id, name: 'Ver Test', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo v1' }],
    }, 'cli', 'initial import');
    agentStore.createNewVersion(id, {
      id, name: 'Ver Test', status: 'active', source: 'local', mcp: false,
      nodes: [
        { id: 'a', type: 'shell', command: 'echo v1' },
        { id: 'b', type: 'shell', command: 'echo v2', dependsOn: ['a'] },
      ],
    }, 'dashboard', 'added node b');
  }

  it('GET /agents/:id/versions lists all versions with current marked', async () => {
    const app = await makeApp();
    await seedTwoVersionAgent();
    const res = await request(app).get('/agents/ver-test/versions')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('ver-test');
    expect(res.text).toContain('v1');
    expect(res.text).toContain('v2');
    expect(res.text).toContain('initial import');
    expect(res.text).toContain('added node b');
    // v2 is current (most recent), so current badge shows there.
    expect(res.text).toMatch(/v2[\s\S]*?badge--ok[\s\S]*?current/);
  });

  it('GET /agents/:id/versions/:version renders the DAG as it was', async () => {
    const app = await makeApp();
    await seedTwoVersionAgent();
    const res = await request(app).get('/agents/ver-test/versions/1')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // v1 only had node "a", not "b".
    expect(res.text).toMatch(/<td class="mono">a<\/td>/);
    expect(res.text).not.toMatch(/<td class="mono">b<\/td>/);
  });

  it('POST /agents/:id/rollback creates a new version matching the target DAG', async () => {
    const app = await makeApp();
    await seedTwoVersionAgent();
    const res = await request(app)
      .post('/agents/ver-test/rollback')
      .type('form')
      .send({ targetVersion: '1' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/agents\/ver-test\/versions\?flash=/);

    // A v3 should now exist, identical to v1's DAG (single node "a").
    const updated = agentStore.getAgent('ver-test');
    expect(updated!.version).toBe(3);
    expect(updated!.nodes).toHaveLength(1);
    expect(updated!.nodes[0].id).toBe('a');
    const v3 = agentStore.getVersion('ver-test', 3);
    expect(v3!.commitMessage).toBe('Rollback to v1');
  });

  it('POST /agents/:id/rollback rejects an invalid target', async () => {
    const app = await makeApp();
    await seedTwoVersionAgent();
    const res = await request(app)
      .post('/agents/ver-test/rollback')
      .type('form')
      .send({ targetVersion: '99' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.location)).toMatch(/v99 not found/);
    // No new version was created.
    expect(agentStore.getAgent('ver-test')!.version).toBe(2);
  });

  it('POST /agents/:id/status toggles agent status', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'status-test', name: 'X', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo' }],
    }, 'cli');

    const res = await request(app)
      .post('/agents/status-test/status')
      .type('form')
      .send({ newStatus: 'paused' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('status-test')!.status).toBe('paused');
  });

  it('POST /agents/:id/status rejects an invalid status enum', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'status-test-2', name: 'X', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo' }],
    }, 'cli');

    const res = await request(app)
      .post('/agents/status-test-2/status')
      .type('form')
      .send({ newStatus: 'banana' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.location)).toMatch(/Invalid status/);
    // Status unchanged.
    expect(agentStore.getAgent('status-test-2')!.status).toBe('active');
  });

  it('agent detail renders the status dropdown + version history link', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'detail-ver', name: 'X', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo' }],
    }, 'cli');
    // Status dropdown is now on the Config tab.
    const res = await request(app).get('/agents/detail-ver/config')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/agents/detail-ver/status"');
    // Version history link is on the Overview tab.
    const overviewRes = await request(app).get('/agents/detail-ver')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(overviewRes.text).toContain('/agents/detail-ver/versions');
  });
});

describe('Dashboard node edit + delete (PR 3a)', () => {
  async function seedChainAgent(id = 'chain-edit') {
    agentStore.createAgent({
      id, name: 'Chain', status: 'active', source: 'local', mcp: false,
      nodes: [
        { id: 'a', type: 'shell', command: 'echo a' },
        { id: 'b', type: 'shell', command: 'echo b', dependsOn: ['a'] },
      ],
    }, 'cli');
  }

  it('GET /agents/:id/nodes/:nodeId/edit pre-fills the form with node state', async () => {
    const app = await makeApp();
    await seedChainAgent();
    const res = await request(app).get('/agents/chain-edit/nodes/a/edit')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Edit a');
    expect(res.text).toContain('echo a');
    // Id input is read-only.
    expect(res.text).toMatch(/readonly[^>]*value="a"/);
  });

  it('POST edit updates the node and bumps the version', async () => {
    const app = await makeApp();
    await seedChainAgent();
    const res = await request(app)
      .post('/agents/chain-edit/nodes/a/edit')
      .type('form')
      .send({ type: 'shell', command: 'echo CHANGED' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/agents\/chain-edit\?flash=/);

    const updated = agentStore.getAgent('chain-edit')!;
    expect(updated.version).toBe(2);
    const a = updated.nodes.find((n) => n.id === 'a')!;
    expect(a.command).toBe('echo CHANGED');
    // Downstream node b left alone.
    const b = updated.nodes.find((n) => n.id === 'b')!;
    expect(b.command).toBe('echo b');
    expect(b.dependsOn).toEqual(['a']);
  });

  it('POST edit refuses a cycle-producing dependsOn', async () => {
    const app = await makeApp();
    await seedChainAgent();
    // Try to make "a" depend on "b" (which already depends on "a").
    const res = await request(app)
      .post('/agents/chain-edit/nodes/a/edit')
      .type('form')
      .send({ type: 'shell', command: 'echo a', dependsOn: 'b' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/cycle/i);
    expect(agentStore.getAgent('chain-edit')!.version).toBe(1);
  });

  it('POST delete refuses when a downstream depends on the node', async () => {
    const app = await makeApp();
    await seedChainAgent();
    const res = await request(app)
      .post('/agents/chain-edit/nodes/a/delete')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.location)).toMatch(/"b" depends on it/);
    // Nothing removed.
    expect(agentStore.getAgent('chain-edit')!.nodes).toHaveLength(2);
  });

  it('POST delete removes the node when nobody depends on it', async () => {
    const app = await makeApp();
    await seedChainAgent();
    const res = await request(app)
      .post('/agents/chain-edit/nodes/b/delete')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.location)).toMatch(/Deleted "b"/);
    const updated = agentStore.getAgent('chain-edit')!;
    expect(updated.nodes).toHaveLength(1);
    expect(updated.nodes[0].id).toBe('a');
    expect(updated.version).toBe(2);
  });

  it('POST delete refuses to remove the last node', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'solo', name: 'Solo', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'only', type: 'shell', command: 'echo' }],
    }, 'cli');
    const res = await request(app)
      .post('/agents/solo/nodes/only/delete')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.location)).toMatch(/last node/);
  });

  it('agent detail renders Edit + Delete buttons on every node row', async () => {
    const app = await makeApp();
    await seedChainAgent();
    // Node edit buttons are now on the Nodes tab.
    const res = await request(app).get('/agents/chain-edit/nodes')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('/agents/chain-edit/nodes/a/edit');
    expect(res.text).toContain('/agents/chain-edit/nodes/b/edit');
    expect(res.text).toContain('action="/agents/chain-edit/nodes/a/delete"');
  });
});

describe('Dashboard hard-delete (POST /agents/:name/delete)', () => {
  function seedDoomed() {
    agentStore.createAgent({
      id: 'doomed',
      name: 'Doomed',
      status: 'active',
      source: 'local',
      mcp: false,
      nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
    }, 'cli');
  }

  it('overview renders the danger zone with a delete form for the agent id', async () => {
    const app = await makeApp();
    seedDoomed();
    const res = await request(app).get('/agents/doomed')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Danger zone');
    expect(res.text).toContain('action="/agents/doomed/delete"');
    expect(res.text).toContain('name="confirm"');
  });

  it('refuses when the confirm token does not match the agent id', async () => {
    const app = await makeApp();
    seedDoomed();
    const res = await request(app)
      .post('/agents/doomed/delete')
      .type('form').send({ confirm: 'wrong' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.location)).toMatch(/Confirmation mismatch/);
    expect(agentStore.getAgent('doomed')).not.toBeNull();
  });

  it('deletes the agent and redirects with a flash when confirm matches', async () => {
    const app = await makeApp();
    seedDoomed();
    const res = await request(app)
      .post('/agents/doomed/delete')
      .type('form').send({ confirm: 'doomed' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/agents?flash=${encodeURIComponent('Deleted "doomed".')}`);
    expect(agentStore.getAgent('doomed')).toBeNull();
  });

  it('returns 303 to /agents when the agent does not exist', async () => {
    const app = await makeApp();
    const res = await request(app)
      .post('/agents/no-such/delete')
      .type('form').send({ confirm: 'no-such' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.location)).toMatch(/not found/);
  });

  it('GET /agents renders the flash banner when ?flash= is present', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/agents?flash=Deleted%20%22something%22.')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('flash--ok');
    expect(res.text).toContain('Deleted &quot;something&quot;.');
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

describe('Dashboard /settings/secrets CRUD', () => {
  function absentStatus() {
    return { exists: false, obfuscatedFallback: false, mode: 'absent' as const };
  }
  function passphraseStatus() {
    return { exists: true, version: 2 as const, obfuscatedFallback: false, mode: 'passphrase' as const };
  }

  it('GET /settings redirects to /settings/secrets', async () => {
    const app = await makeApp();
    const res = await request(app).get('/settings')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/settings/secrets');
  });

  it('GET /settings/secrets shows unlock form when passphrase-protected and locked', async () => {
    const session = new MemorySecretsSession({
      status: passphraseStatus(),
      correctPassphrase: 'correct horse',
    });
    const app = await makeApp({ secretsSession: session });
    const res = await request(app).get('/settings/secrets')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Secrets (locked)');
    expect(res.text).toMatch(/action="\/settings\/secrets\/unlock"/);
    // The list and set-secret form MUST NOT render while locked.
    expect(res.text).not.toContain('action="/settings/secrets/set"');
  });

  it('POST /settings/secrets/unlock rejects wrong passphrase', async () => {
    const session = new MemorySecretsSession({
      status: passphraseStatus(),
      correctPassphrase: 'correct horse',
    });
    const app = await makeApp({ secretsSession: session });
    const res = await request(app).post('/settings/secrets/unlock')
      .type('form')
      .send({ passphrase: 'wrong' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/settings\/secrets\?unlockError=/);
    expect(session.isUnlocked()).toBe(false);
  });

  it('POST /settings/secrets/unlock with the right passphrase unlocks the session', async () => {
    const session = new MemorySecretsSession({
      status: passphraseStatus(),
      correctPassphrase: 'correct horse',
    });
    const app = await makeApp({ secretsSession: session });
    const res = await request(app).post('/settings/secrets/unlock')
      .type('form')
      .send({ passphrase: 'correct horse' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/settings\/secrets\?flash=/);
    expect(session.isUnlocked()).toBe(true);
  });

  it('POST /settings/secrets/set rejects invalid names', async () => {
    const session = new MemorySecretsSession({ status: absentStatus() });
    const app = await makeApp({ secretsSession: session });
    const res = await request(app).post('/settings/secrets/set')
      .type('form')
      .send({ name: 'lower_case', value: 'v' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/settings\/secrets\?setError=/);
    expect(await session.listNames()).toEqual([]);
  });

  it('POST /settings/secrets/set rejects writes to a locked store', async () => {
    const session = new MemorySecretsSession({
      status: passphraseStatus(),
      correctPassphrase: 'x',
    });
    const app = await makeApp({ secretsSession: session });
    const res = await request(app).post('/settings/secrets/set')
      .type('form')
      .send({ name: 'GOOD_NAME', value: 'v' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/setError=/);
    expect(await session.listNames()).toEqual([]);
  });

  it('POST /settings/secrets/set stores a secret when unlocked', async () => {
    const session = new MemorySecretsSession({ status: absentStatus() });
    const app = await makeApp({ secretsSession: session });
    const res = await request(app).post('/settings/secrets/set')
      .type('form')
      .send({ name: 'MY_API_KEY', value: 'sk-123' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/settings\/secrets\?flash=/);
    expect(await session.listNames()).toEqual(['MY_API_KEY']);
  });

  it('POST /settings/secrets/delete removes a secret', async () => {
    const session = new MemorySecretsSession({ status: absentStatus() });
    await session.setSecret('DOOMED', 'v');
    const app = await makeApp({ secretsSession: session });
    const res = await request(app).post('/settings/secrets/delete')
      .type('form')
      .send({ name: 'DOOMED' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(await session.listNames()).toEqual([]);
  });

  it('POST /settings/secrets/lock clears the session passphrase', async () => {
    const session = new MemorySecretsSession({
      status: passphraseStatus(),
      correctPassphrase: 'ok',
    });
    await session.unlock('ok');
    expect(session.isUnlocked()).toBe(true);
    const app = await makeApp({ secretsSession: session });
    await request(app).post('/settings/secrets/lock')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(session.isUnlocked()).toBe(false);
  });

  it('rejects a cross-origin POST to /settings/secrets/set (CSRF defense)', async () => {
    const session = new MemorySecretsSession({ status: absentStatus() });
    const app = await makeApp({ secretsSession: session });
    const res = await request(app).post('/settings/secrets/set')
      .type('form')
      .send({ name: 'X', value: 'v' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Origin', 'http://evil.example.com')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(403);
    expect(await session.listNames()).toEqual([]);
  });
});

describe('Dashboard /settings/general', () => {
  it('renders MCP token fingerprint, retention, and paths', async () => {
    const app = await makeApp({ retentionDays: 7 });
    const res = await request(app).get('/settings/general')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // First 8 chars of TOKEN (32 'a's); full token never rendered.
    expect(res.text).toContain('aaaaaaaa');
    expect(res.text).not.toContain(TOKEN);
    expect(res.text).toContain('<strong>7</strong> days');
    expect(res.text).toContain('/settings/general/rotate-mcp-token');
  });

  it('POST rotate-mcp-token rotates, updates session cookie, reveals new token once', async () => {
    const newToken = 'c'.repeat(64);
    const { app, ctx } = await makeAppWithCtx({ rotateToken: () => newToken });
    const res = await request(app).post('/settings/general/rotate-mcp-token')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(new RegExp(`rotated=${newToken}`));
    // Cookie was re-minted so the current browser stays signed in.
    const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('\n') : setCookie;
    expect(cookieStr).toMatch(new RegExp(`${SESSION_COOKIE}=${newToken}`));
    // ctx.token must point at the new value — otherwise subsequent
    // middleware calls would 401 and force a re-auth.
    expect(ctx.token).toBe(newToken);
  });

  it('after rotation, the old cookie is rejected and the new one works', async () => {
    const newToken = 'c'.repeat(64);
    const { app } = await makeAppWithCtx({ rotateToken: () => newToken });
    await request(app).post('/settings/general/rotate-mcp-token')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);

    const oldCookieRes = await request(app).get('/agents')
      .set('Accept', 'text/html')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(oldCookieRes.status).toBe(302);
    expect(oldCookieRes.headers.location).toBe('/auth');

    const newCookieRes = await request(app).get('/agents')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${newToken}`);
    expect(newCookieRes.status).toBe(200);
  });
});

describe('Dashboard /settings/integrations', () => {
  it('renders placeholder copy', async () => {
    const app = await makeApp();
    const res = await request(app).get('/settings/integrations')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Integrations');
    expect(res.text).toContain('coming in a later release');
  });
});

describe('Dashboard /runs/:id/replay (PR 5)', () => {
  async function seedTwoNodeAgentWithRun(agentId = 'replay-test') {
    agentStore.createAgent({
      id: agentId, name: 'Replay Test', status: 'active', source: 'local', mcp: false,
      nodes: [
        { id: 'fetch', type: 'shell', command: 'echo fetched' },
        { id: 'summarize', type: 'shell', command: 'echo summary', dependsOn: ['fetch'] },
      ],
    }, 'cli', 'seed');

    const priorRunId = 'prior-run-1';
    runStore.createRun({
      id: priorRunId, agentName: agentId, status: 'completed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      triggeredBy: 'cli',
      workflowId: agentId,
      workflowVersion: 1,
    });
    runStore.createNodeExecution({
      runId: priorRunId, nodeId: 'fetch', workflowVersion: 1,
      status: 'completed', startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), exitCode: 0, result: 'fetched',
    });
    runStore.createNodeExecution({
      runId: priorRunId, nodeId: 'summarize', workflowVersion: 1,
      status: 'completed', startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), exitCode: 0, result: 'summary',
    });
    return { agentId, priorRunId };
  }

  it('wires the DAG for replay on a completed v2 run', async () => {
    const app = await makeApp();
    const { priorRunId } = await seedTwoNodeAgentWithRun();
    const res = await request(app).get(`/runs/${priorRunId}`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // The DAG canvas carries the replay run id so the client-side
    // dialog can POST /runs/:id/replay when the user clicks a node.
    expect(res.text).toContain(`data-replay-run-id="${priorRunId}"`);
    // The <dialog> shell the client populates on node-tap.
    expect(res.text).toContain('id="dag-node-dialog"');
    // The click hint tells the user the interaction is available.
    expect(res.text).toContain('Click a node to see its actions');
    // No-JS fallback form is wrapped in <noscript>.
    expect(res.text).toMatch(/<noscript>[\s\S]*action="\/runs\/[^"]+\/replay"/);
  });

  it('omits replay wiring on in-progress runs', async () => {
    const app = await makeApp();
    const { agentId } = await seedTwoNodeAgentWithRun('replay-running');
    const runningId = 'running-run';
    runStore.createRun({
      id: runningId, agentName: agentId, status: 'running',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
      workflowId: agentId, workflowVersion: 1,
    });
    const res = await request(app).get(`/runs/${runningId}`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // No replay wiring while a run is still running — neither the
    // canvas attribute nor the fallback form.
    expect(res.text).not.toContain('data-replay-run-id');
    expect(res.text).not.toMatch(/action="[^"]*\/replay"/);
  });

  it('agent detail wires the DAG for edit + replay-latest', async () => {
    const app = await makeApp();
    const { agentId } = await seedTwoNodeAgentWithRun('replay-agent-detail');
    const res = await request(app).get(`/agents/${agentId}`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // Edit-from-DAG and replay-latest-from-DAG both present.
    expect(res.text).toContain(`data-edit-base="/agents/${agentId}/nodes"`);
    expect(res.text).toMatch(/data-replay-run-id="prior-run-1"/);
    // Stale "Click a node to inspect it" + "Click a DAG node for its
    // actions" copy is gone. Only the DAG's own hint survives — the
    // Overview sidebar doesn't pretend to respond to node clicks.
    expect(res.text).not.toContain('Click a node to inspect it');
    expect(res.text).not.toContain('Click a DAG node for its actions');
    expect(res.text).toContain('Click a node to see its actions');
  });

  it('POST /runs/:id/replay with a missing fromNodeId flashes an error', async () => {
    const app = await makeApp();
    const { priorRunId } = await seedTwoNodeAgentWithRun();
    const res = await request(app).post(`/runs/${priorRunId}/replay`)
      .type('form')
      .send({})
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/runs/${priorRunId}?flash=${encodeURIComponent('Pick a node to replay from.')}`);
  });

  it('POST /runs/:id/replay with an unknown node flashes an error', async () => {
    const app = await makeApp();
    const { priorRunId } = await seedTwoNodeAgentWithRun();
    const res = await request(app).post(`/runs/${priorRunId}/replay`)
      .type('form')
      .send({ fromNodeId: 'ghost-node' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(new RegExp(`^/runs/${priorRunId}\\?flash=`));
    expect(decodeURIComponent(res.headers.location)).toContain('not in agent');
  });

  it('POST /runs/:id/replay dispatches + redirects to the new run', async () => {
    const app = await makeApp();
    const { priorRunId } = await seedTwoNodeAgentWithRun();
    const res = await request(app).post(`/runs/${priorRunId}/replay`)
      .type('form')
      .send({ fromNodeId: 'summarize' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    // Replay redirects to the NEW run id — not the prior one.
    expect(res.headers.location).toMatch(/^\/runs\/[^/?]+\?flash=/);
    expect(res.headers.location).not.toContain(priorRunId);
    expect(decodeURIComponent(res.headers.location)).toContain('Replayed from "summarize"');
  });

  it('POST /runs/:id/replay rejects cross-origin POSTs (CSRF defense)', async () => {
    const app = await makeApp();
    const { priorRunId } = await seedTwoNodeAgentWithRun();
    const res = await request(app).post(`/runs/${priorRunId}/replay`)
      .type('form')
      .send({ fromNodeId: 'summarize' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Origin', 'http://evil.example.com')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(403);
  });

  it('GET /runs/<missing> redirects to /runs with a flash', async () => {
    const app = await makeApp();
    const res = await request(app).get('/runs/does-not-exist')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/runs\?flash=/);
    expect(decodeURIComponent(res.headers.location)).toContain('not found');
  });

  it('empty /runs renders the "No runs yet" state when nothing exists', async () => {
    const app = await makeApp();
    const res = await request(app).get('/runs')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('No runs yet');
  });

  it('filtered /runs with no matches renders "No runs match"', async () => {
    const app = await makeApp();
    const res = await request(app).get('/runs?agent=ghost')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('No runs match');
    expect(res.text).toContain('Reset filters');
  });
});

describe('Dashboard /tools (v0.16 PR 3)', () => {
  it('GET /tools lists built-in tools', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools?tab=builtin')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('shell-exec');
    expect(res.text).toContain('http-get');
    expect(res.text).toContain('json-parse');
    expect(res.text).toContain('Built-in');
  });

  it('GET /tools/:id renders a built-in tool detail page', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools/http-get')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('http-get');
    expect(res.text).toContain('builtin');
    expect(res.text).toContain('Inputs');
    expect(res.text).toContain('url');
    expect(res.text).toContain('Outputs');
    expect(res.text).toContain('status');
  });

  it('GET /tools/:unknown redirects to /tools', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools/nonexistent')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/tools');
  });

  it('agent detail sidebar shows tool badges', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'tool-vis-test', name: 'Tool Vis', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
    }, 'cli', 'seed');
    const res = await request(app).get('/agents/tool-vis-test')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // v0.15 shell node → implicit tool badge "shell-exec" in the sidebar.
    expect(res.text).toContain('shell-exec');
    expect(res.text).toContain('/tools/shell-exec');
  });
});

describe('Dashboard template palette (PR 5)', () => {
  async function seedTwoNodeAgent(id = 'palette-test') {
    agentStore.createAgent({
      id, name: 'Palette Test', status: 'active', source: 'local', mcp: false,
      nodes: [
        { id: 'fetch', type: 'shell', command: 'echo hi' },
        { id: 'summarize', type: 'shell', command: 'echo bye', dependsOn: ['fetch'] },
      ],
    }, 'cli', 'seed');
    return id;
  }

  it('add-node form embeds the palette suggestions payload', async () => {
    const app = await makeApp();
    const id = await seedTwoNodeAgent();
    const res = await request(app).get(`/agents/${id}/add-node`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // Both textareas are marked with their palette mode.
    expect(res.text).toContain('data-template-palette="shell"');
    expect(res.text).toContain('data-template-palette="claude"');
    // The JSON payload carries every node id as a candidate upstream.
    expect(res.text).toContain('<script id="palette-add-node" type="application/json">');
    expect(res.text).toMatch(/"upstreams":\s*\["fetch","summarize"\]/);
    // Friendly affordance hint is visible to the user.
    expect(res.text).toContain('Type <code>$</code>');
    expect(res.text).toContain('Type <code>{{</code>');
  });

  it('edit-node palette excludes the node itself from upstream suggestions', async () => {
    const app = await makeApp();
    const id = await seedTwoNodeAgent('palette-edit-test');
    const res = await request(app).get(`/agents/${id}/nodes/fetch/edit`)
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // Fetching the "fetch" node's edit form — the palette payload must
    // not offer "fetch" as a self-reference candidate.
    expect(res.text).toContain('<script id="palette-edit-node" type="application/json">');
    expect(res.text).toMatch(/"upstreams":\s*\["summarize"\]/);
  });
});

describe('Dashboard /settings/mcp-servers', () => {
  function withServer(): ToolStore {
    const toolStore = new ToolStore(':memory:');
    toolStore.createMcpServer({
      id: 'graphics', name: 'graphics', transport: 'stdio',
      command: 'docker', args: ['run', '--rm'], enabled: true,
    });
    toolStore.createTool({
      id: 'graphics-do', name: 'do', source: 'local', inputs: {}, outputs: {},
      implementation: { type: 'mcp', mcpTransport: 'stdio', mcpCommand: 'docker', mcpToolName: 'do' },
    }, undefined, 'graphics');
    return toolStore;
  }

  it('GET lists imported servers with tool counts', async () => {
    const toolStore = withServer();
    const app = await makeApp({ toolStore });
    const res = await request(app).get('/settings/mcp-servers')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('graphics');
    expect(res.text).toContain('enabled');
    // Tool count column shows "1"
    expect(res.text).toMatch(/<td>1<\/td>/);
  });

  it('POST /toggle flips the enabled flag', async () => {
    const toolStore = withServer();
    const app = await makeApp({ toolStore });
    const res = await request(app).post('/settings/mcp-servers/toggle')
      .type('form').send({ id: 'graphics', action: 'disable' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(toolStore.getMcpServer('graphics')!.enabled).toBe(false);
  });

  it('POST /delete cascades to tools', async () => {
    const toolStore = withServer();
    const app = await makeApp({ toolStore });
    const res = await request(app).post('/settings/mcp-servers/delete')
      .type('form').send({ id: 'graphics' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(toolStore.getMcpServer('graphics')).toBeUndefined();
    expect(toolStore.getTool('graphics-do')).toBeUndefined();
  });

  it('POST /toggle on unknown server returns setError', async () => {
    const toolStore = withServer();
    const app = await makeApp({ toolStore });
    const res = await request(app).post('/settings/mcp-servers/toggle')
      .type('form').send({ id: 'ghost', action: 'enable' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/setError=/);
  });
});

describe('Dashboard /tools/mcp/import form validation', () => {
  it('GET renders the paste form', async () => {
    const toolStore = new ToolStore(':memory:');
    const app = await makeApp({ toolStore });
    const res = await request(app).get('/tools/mcp/import')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="configBlob"');
  });

  it('POST with empty blob shows an error', async () => {
    const toolStore = new ToolStore(':memory:');
    const app = await makeApp({ toolStore });
    const res = await request(app).post('/tools/mcp/import')
      .type('form').send({ step: 'discover', configBlob: '' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain('Enter a URL for quick-add');
  });

  it('POST with quick-add URL synthesises a config and attempts discovery', async () => {
    const toolStore = new ToolStore(':memory:');
    const app = await makeApp({ toolStore });
    const res = await request(app).post('/tools/mcp/import')
      .type('form').send({ step: 'discover', quickUrl: 'http://127.0.0.1:1/mcp' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    // Discovery itself will fail (nothing listening on port 1) — but the
    // route should render the server section with a per-server error,
    // not return a 400 parse failure.
    expect(res.status).toBe(200);
    expect(res.text).toContain('connect failed');
  });

  it('POST with unparseable blob reports parse error without crashing', async () => {
    const toolStore = new ToolStore(':memory:');
    const app = await makeApp({ toolStore });
    const res = await request(app).post('/tools/mcp/import')
      .type('form').send({ step: 'discover', configBlob: '{not json' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain('No valid MCP servers');
  });
});

describe('Output widget editor UI', () => {
  it('renders all 4 widget-type cards on the config page', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'ow-cards', name: 'ow-cards', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');
    const res = await request(app).get('/agents/ow-cards/config')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    for (const t of ['raw', 'key-value', 'diff-apply', 'dashboard']) {
      expect(res.text).toContain(`data-widget-type="${t}"`);
    }
    // Helper copy for the default (raw) should be present.
    expect(res.text).toContain('titled section');
    // Load-example dropdown + preview container.
    expect(res.text).toContain('id="ow-example"');
    expect(res.text).toContain('id="ow-preview"');
  });

  it('POST /output-widget/preview renders HTML for a valid body', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'ow-preview-ok', name: 'ow-preview-ok', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');
    const res = await request(app).post('/agents/ow-preview-ok/output-widget/preview')
      .type('form').send({
        widgetType: 'key-value',
        fieldName_0: 'total', fieldType_0: 'text',
        fieldName_1: 'status', fieldType_1: 'badge',
      })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    // key-value renders a definition list; at minimum our sample values land in the HTML.
    expect(res.text.toLowerCase()).toMatch(/total|sample|ready/);
  });

  it('renders the 5th ai-template card and the AI panel when selected', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'ow-ai-cards', name: 'ow-ai-cards', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');
    const res = await request(app).get('/agents/ow-ai-cards/config')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-widget-type="ai-template"');
    expect(res.text).toContain('id="ow-ai-prompt"');
    expect(res.text).toContain('id="ow-ai-generate"');
    expect(res.text).toContain('id="ow-ai-template"');
  });

  it('POST /output-widget/preview renders sanitized ai-template HTML', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'ow-ai-preview', name: 'ow-ai-preview', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');
    const res = await request(app).post('/agents/ow-ai-preview/output-widget/preview')
      .type('form').send({
        widgetType: 'ai-template',
        template: '<div class="card"><h3>{{outputs.headline}}</h3><script>x</script></div>',
      })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('sample headline');
    expect(res.text).not.toContain('<script');
  });

  it('POST /output-widget/update saves an ai-template widget', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'ow-ai-save', name: 'ow-ai-save', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');
    const res = await request(app).post('/agents/ow-ai-save/output-widget/update')
      .type('form').send({
        action: 'save',
        widgetType: 'ai-template',
        prompt: 'show the headline',
        template: '<div><strong>{{outputs.headline}}</strong></div>',
      })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(303);
    const saved = agentStore.getAgent('ow-ai-save');
    expect(saved?.outputWidget?.type).toBe('ai-template');
    expect(saved?.outputWidget?.template).toContain('<strong>');
    expect(saved?.outputWidget?.prompt).toBe('show the headline');
  });

  it('POST /output-widget/generate returns 400 with no prompt', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'ow-ai-gen-bad', name: 'ow-ai-gen-bad', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');
    const res = await request(app).post('/agents/ow-ai-gen-bad/output-widget/generate')
      .type('form').send({})
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain('Prompt is required');
  });

  it('POST /output-widget/preview returns 400 for missing widgetType', async () => {
    const app = await makeApp();
    agentStore.createAgent({
      id: 'ow-preview-bad', name: 'ow-preview-bad', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
    }, 'cli');
    const res = await request(app).post('/agents/ow-preview-bad/output-widget/preview')
      .type('form').send({ fieldName_0: 'x', fieldType_0: 'text' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain('Pick a widget type');
  });
});

describe('Dashboard /agents/install', () => {
  const SAMPLE_YAML = `id: dash-installed
name: dash-installed
status: active
source: community
mcp: false
nodes:
  - id: hello
    type: shell
    command: echo hi
`;

  it('GET renders the paste form', async () => {
    const app = await makeApp();
    const res = await request(app).get('/agents/install')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="url"');
    expect(res.text).toContain('Install agent');
  });

  it('POST step=preview validates the URL and parses the YAML', async () => {
    const app = await makeApp();
    // Stub global fetch so the route doesn't hit the network.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(SAMPLE_YAML, { status: 200 })) as typeof fetch;
    try {
      const res = await request(app).post('/agents/install')
        .type('form').send({ step: 'preview', url: 'https://example.com/dash-installed.yaml' })
        .set('Host', `127.0.0.1:${PORT}`)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('dash-installed');
      expect(res.text).toContain('Confirm install');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('POST step=confirm upserts the agent (source overridden to local) and the agent shows in /agents', async () => {
    const app = await makeApp();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(SAMPLE_YAML, { status: 200 })) as typeof fetch;
    try {
      const installRes = await request(app).post('/agents/install')
        .type('form').send({ step: 'confirm', url: 'https://example.com/dash-installed.yaml' })
        .set('Host', `127.0.0.1:${PORT}`)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
      expect(installRes.status).toBe(200);
      expect(installRes.text).toMatch(/Installed|installed/);

      // Confirm the agent now appears on /agents.
      const listRes = await request(app).get('/agents')
        .set('Host', `127.0.0.1:${PORT}`)
        .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
      expect(listRes.status).toBe(200);
      expect(listRes.text).toContain('dash-installed');

      // And source was overridden to 'local'.
      const stored = agentStore.getAgent('dash-installed');
      expect(stored?.source).toBe('local');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('POST with empty URL returns 400 with an error banner', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/install')
      .type('form').send({ step: 'preview', url: '' })
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain('Enter a URL');
  });
});
