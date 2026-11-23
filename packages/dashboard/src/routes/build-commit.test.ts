import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import {
  AgentStore,
  DashboardsStore,
  LocalProvider,
  PacksStore,
  RunStore,
  type BuildPlan,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3994;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let t: TestContext | undefined;
let provider: LocalProvider | undefined;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp() {
  t = await createTestContext({ port: PORT, prefix: 'sua-build-commit-', extra: ({ dbPath }) => ({
    packsStore: new PacksStore(dbPath),
    dashboardsStore: new DashboardsStore(dbPath),
  }) });
  const { ctx } = t;
  provider = t.provider;
  runStore = ctx.runStore;
  agentStore = ctx.agentStore;
  packsStore = ctx.packsStore!;
  dashboardsStore = ctx.dashboardsStore!;

  // Pre-install one signal-bearing agent ("hn-top-stories") so the
  // dashboard-existing flavor has something to point at.
  agentStore.createAgent({
    id: 'hn-top-stories',
    name: 'HN Top Stories',
    status: 'active',
    source: 'local',
    mcp: false,
    nodes: [{ id: 'fetch', type: 'shell', command: 'echo hi', dependsOn: [] }],
    signal: { title: 'HN', template: 'text-headline', mapping: { headline: 'h' } },
  }, 'cli');

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  if (provider) {
    const start = Date.now();
    while ((provider as unknown as { running?: { size: number } }).running?.size && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  await closeTestContext(t);
  t = undefined;
  provider = undefined;
});

const NOTES_AGENT_YAML = `id: notes-list-daily
name: Notes List Daily
status: active
source: local
mcp: false
nodes:
  - id: read
    type: shell
    command: ls ~/Documents
    dependsOn: []
signal:
  title: Notes
  template: text-headline
  mapping:
    headline: result
`;

describe('POST /agents/build/commit', () => {
  it('agent-only intent: creates one agent, redirects to /agents/:id', async () => {
    const app = await makeApp();
    const plan: BuildPlan = {
      intent: 'agent',
      summary: 'Build a notes-list agent',
      survey: { matchedAgents: [], missingFor: ['notes list'], existingDashboards: [] },
      newAgents: [{ id: 'notes-list-daily', purpose: 'list latest notes', yaml: NOTES_AGENT_YAML }],
      dashboard: null,
      questions: [],
    };
    const res = await request(app).post('/agents/build/commit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send({ plan });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.agentsCreated).toEqual(['notes-list-daily']);
    expect(res.body.dashboardCreated).toBeNull();
    expect(res.body.redirectUrl).toBe('/agents/notes-list-daily');
    expect(agentStore.getAgent('notes-list-daily')).not.toBeNull();
    // The first run started for it is returned so "Done" can link to it.
    const firstRun = res.body.autoRuns['notes-list-daily'];
    expect(firstRun).toMatch(/^[0-9a-f-]{36}$/);
    expect(runStore.getRun(firstRun)?.agentName).toBe('notes-list-daily');
  });

  it('dashboard-mixed intent: creates new agent + dashboard wiring it with an existing one', async () => {
    const app = await makeApp();
    const plan: BuildPlan = {
      intent: 'dashboard-mixed',
      summary: 'Morning briefing',
      survey: {
        matchedAgents: [{ id: 'hn-top-stories', matchedFor: 'top stories on HN' }],
        missingFor: ['notes list'],
        existingDashboards: [],
      },
      newAgents: [{ id: 'notes-list-daily', purpose: 'list latest notes', yaml: NOTES_AGENT_YAML }],
      dashboard: {
        id: 'user:morning-briefing',
        name: 'Morning Briefing',
        sections: [
          { title: 'News', agentIds: ['hn-top-stories'] },
          { title: 'Notes', agentIds: ['notes-list-daily'] },
        ],
      },
      questions: [],
    };
    const res = await request(app).post('/agents/build/commit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send({ plan });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.agentsCreated).toEqual(['notes-list-daily']);
    expect(res.body.dashboardCreated).toBe('user:morning-briefing');
    expect(res.body.redirectUrl).toBe('/dashboards/user%3Amorning-briefing');

    const dash = dashboardsStore.getDashboard('user:morning-briefing');
    expect(dash).not.toBeNull();
    expect(dash?.layout.sections).toHaveLength(2);
  });

  it('skips an agent whose id already exists; still creates the dashboard', async () => {
    const app = await makeApp();
    const plan: BuildPlan = {
      intent: 'dashboard-mixed',
      summary: 'Morning briefing',
      survey: { matchedAgents: [{ id: 'hn-top-stories', matchedFor: 'HN' }], missingFor: [], existingDashboards: [] },
      newAgents: [{ id: 'hn-top-stories', purpose: 'duplicate', yaml: NOTES_AGENT_YAML.replace('notes-list-daily', 'hn-top-stories') }],
      dashboard: {
        id: 'user:morning',
        name: 'Morning',
        sections: [{ title: 'News', agentIds: ['hn-top-stories'] }],
      },
      questions: [],
    };
    const res = await request(app).post('/agents/build/commit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send({ plan });
    expect(res.body.ok).toBe(true);
    expect(res.body.agentsCreated).toEqual([]);
    expect(res.body.agentsSkipped).toHaveLength(1);
    expect(res.body.agentsSkipped[0].reason).toMatch(/already exists/);
    expect(res.body.dashboardCreated).toBe('user:morning');
  });

  it('refuses to create the dashboard when a referenced agent failed to land', async () => {
    const app = await makeApp();
    // YAML with a v1 inputs-as-array shape — autoFixYaml + schema reject.
    const broken = `id: broken-agent\nname: Broken\nstatus: active\nsource: local\nmcp: false\ninputs:\n  - name: foo\n    description: bad shape\nnodes:\n  - id: n\n    type: shell\n    command: echo x\n    dependsOn: []\n`;
    const plan: BuildPlan = {
      intent: 'dashboard-mixed',
      summary: 'Mixed with failing new agent',
      survey: { matchedAgents: [{ id: 'hn-top-stories', matchedFor: 'HN' }], missingFor: ['notes'], existingDashboards: [] },
      newAgents: [{ id: 'broken-agent', purpose: 'will fail to parse', yaml: broken }],
      dashboard: {
        id: 'user:will-not-land',
        name: 'Will Not Land',
        sections: [{ title: 'Mixed', agentIds: ['hn-top-stories', 'broken-agent'] }],
      },
      questions: [],
    };
    const res = await request(app).post('/agents/build/commit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send({ plan });
    expect(res.body.ok).toBe(true);
    expect(res.body.agentsCreated).toEqual([]);
    expect(res.body.agentsSkipped).toHaveLength(1);
    // Dashboard was NOT created (would have referenced a non-existent agent).
    expect(res.body.dashboardCreated).toBeNull();
    expect(res.body.dashboardError).toMatch(/broken-agent/);
    expect(dashboardsStore.getDashboard('user:will-not-land')).toBeNull();
  });

  it('rejects plans that fail schema validation', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/build/commit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send({ plan: { intent: 'agent', summary: 'X', newAgents: [], dashboard: null, questions: [] } });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/exactly one|requires|failed/);
  });

  it('rejects a plan with mismatched YAML id', async () => {
    const app = await makeApp();
    const plan: BuildPlan = {
      intent: 'agent',
      summary: 'X',
      survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
      newAgents: [{ id: 'wrong-id', purpose: 'p', yaml: NOTES_AGENT_YAML }],
      dashboard: null,
      questions: [],
    };
    const res = await request(app).post('/agents/build/commit')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .send({ plan });
    expect(res.body.ok).toBe(true); // commit returned a partial result
    expect(res.body.agentsCreated).toEqual([]);
    expect(res.body.agentsSkipped[0].reason).toMatch(/does not match/);
  });
});
