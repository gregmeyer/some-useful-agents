import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore, BoardsStore, DashboardsStore, InboxStore, LocalProvider, MemorySecretsStore, RunStore,
  buildLoopbackAllowlist, loadAgents,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { setDashboardPrefs } from '../lib/dashboard-prefs.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../session.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3991;
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

const buildWith = async (app: Parameters<typeof request>[0], missing: Array<{ purpose: string; suggestedName?: string }>) => {
  const plan = { name: 'Morning view', summary: 'Weather.', layout: 'sections', sections: [{ title: 'Outside', tiles: [{ agentId: 'weather' }] }], missing };
  ctx.agentStore.createAgent({ id: 'board-builder', name: 'Test builder', status: 'active', source: 'local', mcp: false,
    inputs: { REQUEST: { type: 'string', required: true }, CATALOG: { type: 'string', required: true } },
    nodes: [{ id: 'plan', type: 'shell', command: `printf '%s' '<plan>${JSON.stringify(plan)}</plan>'` }] } as never, 'cli');
  const res = await request(app).post('/boards/build').type('form').send({ request: 'a morning board with my calendar' })
    .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  const boardId = decodeURIComponent(res.headers.location.replace('/dashboards/', ''));
  let build: Record<string, unknown> = {};
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 100));
    build = (await get(app, `/boards/${encodeURIComponent(boardId)}/build.json`)).body;
    if ((build.phase === 'done' && build.approval !== undefined) || build.phase === 'failed' || (build.phase === 'done' && (build.drafts as unknown[] | undefined)?.length)) break;
  }
  return { boardId, build, page: res.headers.location };
};
const postForm = (app: Parameters<typeof request>[0], p: string) => request(app).post(p).type('form').send({})
  .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);

describe('drafting the missing agents behind one approval', { timeout: 30_000 }, () => {
  it('drafts an agent (saved as a draft, not run), asks once in the inbox; Approve adds it to the board and runs it', async () => {
    const app = await setup();
    const { boardId, build, page } = await buildWith(app, [{ purpose: 'show my calendar for today', suggestedName: 'calendar-today' }]);
    expect(build).toMatchObject({ phase: 'done', approval: 'pending', drafts: [{ ok: true, id: 'calendar-today', hasTile: true }] });
    expect(ctx.agentStore.getAgent('calendar-today')!.status).toBe('draft');
    expect(ctx.runStore.listRuns({ agentName: 'calendar-today', limit: 5 })).toHaveLength(0); // nothing ran it

    const ready = ctx.inboxStore!.list({ source: 'board' }).find((m) => m.title.startsWith('Your board'))!;
    expect(ready.body).toMatch(/drafting agents for these now/);
    const ask = ctx.inboxStore!.list({ source: 'board' }).find((m) => m.title.startsWith('Approve'))!;
    expect(ask.title).toBe('Approve 1 new agent for your board "Morning view"?');
    expect(ask.body).toContain('/agents/calendar-today');
    const detail = await get(app, `/inbox/${ask.id}`);
    expect(detail.text).toContain(`action="/boards/builds/${build.id}/approve"`);
    expect((await get(app, page)).text).toContain('waiting for your approval');

    const res = await postForm(app, `/boards/builds/${build.id}/approve`);
    expect(res.headers.location).toMatch(/\?ok=Approved/);
    expect(ctx.agentStore.getAgent('calendar-today')!.status).toBe('active');
    const comps = (await get(app, `/boards/${encodeURIComponent(boardId)}.json`)).body;
    void comps;
    const canvas = (await get(app, page)).text;
    expect(canvas).toContain('"title":"New agents"');
    expect(canvas).toContain('"agentId":"calendar-today"');
    expect(ctx.inboxStore!.get(ask.id)!.status).toBe('resolved');
    expect((await get(app, `/boards/${encodeURIComponent(boardId)}/build.json`)).body).toMatchObject({ approval: 'approved' });
    for (let i = 0; i < 50 && ctx.runStore.listRuns({ agentName: 'calendar-today', limit: 5 }).length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(ctx.runStore.listRuns({ agentName: 'calendar-today', limit: 5 }).length).toBeGreaterThan(0);
    // Deciding twice does nothing.
    expect((await postForm(app, `/boards/builds/${build.id}/decline`)).headers.location).toMatch(/error=Already%20approved/);
    expect(ctx.agentStore.getAgent('calendar-today')).toBeTruthy();
  });

  it('Decline deletes the drafts; a draft that fails is reported', async () => {
    const app = await setup();
    const { build } = await buildWith(app, [{ purpose: 'show my calendar' }, { purpose: 'this one will fail' }]);
    expect(build.drafts).toEqual([
      expect.objectContaining({ ok: true, id: 'calendar-today' }),
      expect.objectContaining({ ok: false, error: 'the critic gave up' }),
    ]);
    const ask = ctx.inboxStore!.list({ source: 'board' }).find((m) => m.title.startsWith('Approve'))!;
    expect(ask.body).toContain("Couldn't draft: this one will fail");
    const res = await postForm(app, `/boards/builds/${build.id}/decline`);
    expect(res.headers.location).toMatch(/\?ok=Declined/);
    expect(ctx.agentStore.getAgent('calendar-today')).toBeNull();
    expect(ctx.inboxStore!.get(ask.id)!.status).toBe('resolved');
  });
});
