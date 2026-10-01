import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore, BoardsStore, DashboardsStore, LocalProvider, MemorySecretsStore, RunStore,
  buildLoopbackAllowlist, loadAgents,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../session.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3990;
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
    runStore: new RunStore(dbPath), agentStore: new AgentStore(dbPath), dashboardsStore: new DashboardsStore(dbPath),
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
  await provider?.shutdown();
  try { ctx.runStore.close(); ctx.agentStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
const post = (app: Parameters<typeof request>[0], p: string, body: unknown) => request(app).post(p).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).send(body as object);

describe('boards (read-only)', () => {
  it('derives a named dashboard as a board from its sections, with a missing agent shown in place', async () => {
    const app = await setup();
    const json = await get(app, '/boards/user:morning.json');
    expect(json.status).toBe(200);
    expect(json.body.board).toMatchObject({ id: 'user:morning', name: 'Morning', derived: true, version: 0 });
    expect(json.body.board.items.map((i: { kind: string; agentId?: string; w: number }) => `${i.kind}:${i.agentId ?? ''}:${i.w}`))
      .toEqual(['heading::12', 'agent:news:3', 'agent:weather:6', 'agent:ghost:3']);
    const page = await get(app, '/boards/user:morning');
    expect(page.text).toContain('class="board-grid"');
    expect(page.text).toContain('grid-column: 4 / span 6;'); // weather, 2x1, after news
    expect(page.text).toContain("isn't installed");
  });

  it('shows Pulse with everything in the Unplaced tray until something is placed, then the placed tiles on the grid', async () => {
    const app = await setup();
    let json = await get(app, '/boards/pulse.json');
    expect(json.body.board).toMatchObject({ id: 'pulse', derived: true, items: [] });
    expect(json.body.unplaced).toEqual(expect.arrayContaining(['news', 'weather', 'notes']));
    new BoardsStore(ctx.runStore.databaseHandle()).save({ id: 'pulse', name: 'Pulse', items: [{ id: 'a', kind: 'agent', agentId: 'news', x: 0, y: 3, w: 6, h: 5 }], expectedVersion: 0 });
    json = await get(app, '/boards/pulse.json');
    expect(json.body.board).toMatchObject({ derived: false, version: 1, items: [{ agentId: 'news', y: 0 }] });
    expect(json.body.unplaced).not.toContain('news');
    const page = await get(app, '/boards/pulse');
    expect(page.text).toContain('data-board-item="a"');
    expect(page.text).toContain('Unplaced');
    // each unplaced tile appears exactly once in the tray (system tiles head it, not repeated)
    for (const id of ['_system-runs-today', 'weather']) expect(page.text.split(`data-agent-id="${id}" data-tile-size`).length - 1).toBe(1);
  });

  it('404s for an unknown board', async () => {
    const app = await setup();
    expect((await get(app, '/boards/nope')).status).toBe(404);
    expect((await get(app, '/boards/nope.json')).status).toBe(404);
  });
});

describe('board editor routes', () => {
  it('saves a board (settled), refuses a stale save, rejects a bad layout, and undoes', async () => {
    const app = await setup();
    let res = await post(app, '/boards/user:morning', { version: 0, items: [
      { id: 'h', kind: 'heading', text: 'Top', x: 0, y: 0, w: 12, h: 1 },
      { id: 'w', kind: 'agent', agentId: 'weather', x: 0, y: 9, w: 6, h: 5 },
      { id: 'n', kind: 'note', text: '**hi** <script>', x: 6, y: 1, w: 4, h: 3 },
    ] });
    expect(res.status).toBe(200);
    expect(res.body.board).toMatchObject({ version: 1, hasPrevious: false });
    expect(res.body.board.items.find((i: { id: string }) => i.id === 'w')).toMatchObject({ y: 1 });

    res = await post(app, '/boards/user:morning', { version: 0, items: [] });
    expect(res.status).toBe(409);
    expect(res.body.version).toBe(1);

    res = await post(app, '/boards/user:morning', { version: 1, items: [{ id: 'x', kind: 'iframe', x: 0, y: 0, w: 1, h: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isn't valid/);

    res = await post(app, '/boards/user:morning', { version: 1, items: [{ id: 'h', kind: 'heading', text: 'Only', x: 0, y: 0, w: 12, h: 1 }] });
    expect(res.body.board).toMatchObject({ version: 2, hasPrevious: true });

    const page = await get(app, '/boards/user:morning');
    expect(page.text).toContain('data-board-undo');
    expect(page.text).toContain('src="/assets/board-editor.js"');
    const js = await get(app, '/assets/board-editor.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.text).toContain('normalizeBoardItems');
    const data = JSON.parse(/<script type="application\/json" id="board-data">([^<]*)<\/script>/.exec(page.text)![1]);
    expect(data).toMatchObject({ id: 'user:morning', version: 2, hasPrevious: true, isPulse: false });
    expect(data.agents.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining(['news', 'weather', 'notes']));

    res = await post(app, '/boards/user:morning/undo', { version: 2 });
    expect(res.status).toBe(200);
    expect(res.body.board.items.map((i: { id: string }) => i.id)).toEqual(['h', 'w', 'n']);

    expect((await post(app, '/boards/nope', { version: 0, items: [] })).status).toBe(404);
    expect((await post(app, '/boards/user:morning', { items: [] })).status).toBe(400);
  });

  it('refuses a save from another origin', async () => {
    const app = await setup();
    const res = await request(app).post('/boards/pulse').set('Host', `127.0.0.1:${PORT}`).set('Origin', 'https://evil.example').set('Cookie', COOKIE).send({ version: 0, items: [] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(new BoardsStore(ctx.runStore.databaseHandle()).get('pulse')).toBeUndefined();
  });

  it('starts Pulse from the old browser arrangement once, keeping known tiles and sizes', async () => {
    const app = await setup();
    let res = await post(app, '/boards/pulse/import', {
      containers: [{ id: 'mine', label: 'Mine', tiles: ['weather', 'ghost', '_system-runs-today'] }, { id: 'x', label: 'Empty', tiles: ['ghost'] }],
      sizes: { weather: '2x2' },
    });
    expect(res.status).toBe(200);
    expect(res.body.board.items.map((i: { kind: string; agentId?: string; tileId?: string; w: number; h: number }) => `${i.kind}:${i.agentId ?? i.tileId ?? ''}:${i.w}x${i.h}`))
      .toEqual(['heading::12x1', 'agent:weather:6x10', 'system:_system-runs-today:3x5']);
    res = await post(app, '/boards/pulse/import', { containers: [{ label: 'Again', tiles: ['news'] }] });
    expect(res.status).toBe(409);
    const json = await get(app, '/boards/pulse.json');
    expect(json.body.unplaced).not.toContain('weather');
    expect(json.body.unplaced).toContain('news');
  });
});
