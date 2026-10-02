import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore, BoardsStore, DashboardsStore, InboxStore, LocalProvider, MemorySecretsStore, RunStore,
  buildLoopbackAllowlist, loadAgents,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { BoardBuildStore, queueBoardBuild } from '@some-useful-agents/core';
import { startQueuedBoardBuilds } from '../lib/board-build.js';
import { parseProposedActions } from './inbox-plan.js';
import { executeBoardBuild } from './inbox-engine.js';
import { setDashboardPrefs } from '../lib/dashboard-prefs.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../session.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3992;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
let dir = '';
let ctx: DashboardContext;
let provider: LocalProvider;

async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-boards-route-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  const secretsStore = new MemorySecretsStore();
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  ctx = {
    token: TOKEN, allowlist: buildLoopbackAllowlist(PORT), port: PORT, provider,
    runStore: new RunStore(dbPath), agentStore: new AgentStore(dbPath), dashboardsStore: new DashboardsStore(dbPath), inboxStore: new InboxStore(dbPath),
    loadAgents: () => loadAgents({ directories: [agentsDir] }), secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }), tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30, dbPath, secretsPath: join(dir, 'secrets.enc'), rotateToken: () => 'r'.repeat(64),
    allowUntrustedShell: new Set(), activeRuns: new Map(), inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(), dataDir: dir, dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  } as DashboardContext;
  const add = (id: string, size?: string) => ctx.agentStore.createAgent({ id, name: id, status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }], signal: { title: id, template: 'text-headline', mapping: { headline: 'result' }, ...(size ? { size } : {}) } } as never, 'cli');
  add('news'); add('weather', '2x1'); add('notes');
  ctx.dashboardsStore!.upsertDashboard({ id: 'user:morning', packId: null, name: 'Morning', layout: { sections: [{ title: 'Today', agentIds: ['news', 'weather', 'ghost'] }] } } as never);
  return buildDashboardApp(ctx);
}
afterEach(async () => {
  if (!dir) return; // this test didn't call setup()
  await provider?.shutdown();
  try { ctx.runStore.close(); ctx.agentStore.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
const post = (app: Parameters<typeof request>[0], p: string, body: unknown) => request(app).post(p).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).send(body as object);

// The drafter is an LLM agent; stand in for a draft session that returns a known agent.
const DRAFT_YAML = `id: calendar-today
name: Calendar today
description: Today's calendar.
status: draft
source: local
nodes:
  - id: n
    type: shell
    command: echo "3 meetings"
signal:
  title: Calendar
  template: text-headline
  mapping:
    headline: result
`;
vi.mock('./build-orchestrator.js', () => {
  const sessions = new Map<string, Record<string, unknown>>();
  return {
    startDraftOneSession: async (args: { purpose: string }) => {
      const id = `s-${sessions.size + 1}`;
      sessions.set(id, args.purpose.includes('fail')
        ? { phase: 'failed', error: 'the critic gave up', phaseMessage: '' }
        : { phase: 'done', phaseMessage: '', plan: { newAgents: [{ id: 'calendar-today', yaml: DRAFT_YAML }] } });
      return id;
    },
    getSession: (id: string) => sessions.get(id),
    advanceSession: async () => {},
  };
});


const standInBuilder = (tiles: string[]) => {
  const plan = { name: 'Queued view', summary: 'From MCP.', layout: 'sections', sections: [{ title: 'All', tiles: tiles.map((agentId) => ({ agentId })) }], missing: [] };
  ctx.agentStore.createAgent({ id: 'board-builder', name: 'Test builder', status: 'active', source: 'local', mcp: false,
    inputs: { REQUEST: { type: 'string', required: true }, CATALOG: { type: 'string', required: true } },
    nodes: [{ id: 'plan', type: 'shell', command: `printf '%s' '<plan>${JSON.stringify(plan)}</plan>'` }] } as never, 'cli');
};
const waitDone = async (buildId: string) => {
  const store = new BoardBuildStore(ctx.runStore.databaseHandle());
  for (let i = 0; i < 300; i++) {
    const b = store.get(buildId)!;
    if (b.phase === 'done' || b.phase === 'failed') return b;
    await new Promise((r) => setTimeout(r, 100));
  }
  return store.get(buildId)!;
};

describe('other ways to build a board', { timeout: 30_000 }, () => {
  it('runs a build queued elsewhere (the MCP server) once the dashboard picks it up — and only once', async () => {
    const app = await setup();
    void app;
    standInBuilder(['weather']);
    const { boardId, build } = queueBoardBuild(ctx.runStore.databaseHandle(), ctx.dashboardsStore!, { request: 'weather please', queued: true, origin: 'mcp' });
    expect(build.phase).toBe('queued');
    expect(ctx.dashboardsStore!.getDashboard(boardId)).toBeTruthy();
    expect(startQueuedBoardBuilds(ctx)).toBe(1);
    expect(startQueuedBoardBuilds(ctx)).toBe(0); // claimed already
    const done = await waitDone(build.id);
    expect(done).toMatchObject({ phase: 'done', placed: ['weather'], origin: 'mcp' });
  });

  it('Ask sua: triage proposes board-build; running it starts a build and links the board', async () => {
    await setup();
    standInBuilder(['news']);
    const { accepted, rejected } = parseProposedActions([
      { type: 'board-build', rationale: 'They described a board', inputs: { REQUEST: 'a board with the news', NAME: 'News' } },
      { type: 'board-build', inputs: {} },
    ], []);
    expect(accepted).toEqual([expect.objectContaining({ agentId: 'board-build', effect: 'write', ctaLabel: 'Build board', inputs: { REQUEST: 'a board with the news', NAME: 'News' } })]);
    expect(rejected).toEqual([{ agentId: 'board-build', reason: 'board-build requires inputs.REQUEST' }]);
    const out = executeBoardBuild(ctx, accepted[0]);
    expect(out.status).toBe('completed');
    const boardId = /\/dashboards\/(user:[a-z0-9-]+)/.exec(out.summary!)![1];
    expect(ctx.dashboardsStore!.getDashboard(boardId)!.name).toBe('News'); // the name they gave is kept
    const b = new BoardBuildStore(ctx.runStore.databaseHandle()).latestFor(boardId)!;
    expect((await waitDone(b.id))).toMatchObject({ phase: 'done', placed: ['news'], origin: 'inbox', keepName: true });
    expect(executeBoardBuild(ctx, { ...accepted[0], inputs: { REQUEST: ' ' } })).toMatchObject({ status: 'failed' });
  });

  it('retries the tiles that failed, and clears them once they succeed', async () => {
    const app = await setup();
    const flag = join(dir, 'flaky-ok');
    ctx.agentStore.createAgent({ id: 'flaky', name: 'flaky', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: `test -f "${flag}" && echo ok || exit 1` }],
      signal: { title: 'Flaky', template: 'text-headline', mapping: { headline: 'result' } } } as never, 'cli');
    standInBuilder(['flaky', 'news']);
    const { build } = queueBoardBuild(ctx.runStore.databaseHandle(), ctx.dashboardsStore!, { request: 'flaky things', queued: true });
    startQueuedBoardBuilds(ctx);
    const done = await waitDone(build.id);
    expect(done.failed).toEqual(['flaky']);
    const page = await get(app, `/dashboards/${encodeURIComponent(done.boardId)}`);
    expect(page.text).toContain(`action="/boards/builds/${build.id}/retry"`);
    writeFileSync(flag, 'ok');
    const res = await request(app).post(`/boards/builds/${build.id}/retry`).type('form').send({})
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.headers.location).toMatch(/\?ok=Running%201%20tile%20again/);
    const store = new BoardBuildStore(ctx.runStore.databaseHandle());
    for (let i = 0; i < 100 && store.get(build.id)!.failed.length; i++) await new Promise((r) => setTimeout(r, 100));
    expect(store.get(build.id)).toMatchObject({ failed: [], detail: 'All tiles ran.' });
  });
});
