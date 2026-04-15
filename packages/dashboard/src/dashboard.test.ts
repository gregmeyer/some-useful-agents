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
    const res = await request(app).get('/agents/detail-ver')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/agents/detail-ver/status"');
    expect(res.text).toContain('/agents/detail-ver/versions');
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
    const res = await request(app).get('/agents/chain-edit')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('/agents/chain-edit/nodes/a/edit');
    expect(res.text).toContain('/agents/chain-edit/nodes/b/edit');
    expect(res.text).toContain('action="/agents/chain-edit/nodes/a/delete"');
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
