import { describe, it, expect, afterEach } from 'vitest';
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

const embedded = (text: string, re: RegExp) => JSON.parse(re.exec(text)![1].replace(/\\u003c/g, '<'));
const surface = (text: string) => embedded(text, /data-board-canvas="[^"]*"[^>]*><script type="application\/json">([\s\S]*?)<\/script>/)[1].updateComponents.components as Array<Record<string, unknown>>;
const registry = (text: string) => embedded(text, /<script type="application\/json" id="board-tiles">([\s\S]*?)<\/script>/);
const editorData = (text: string) => embedded(text, /<script type="application\/json" id="board-canvas-data">([\s\S]*?)<\/script>/);

describe('boards are canvases', () => {
  it('draws a dashboard as one A2UI surface: Sections of Grids of AgentTiles, with a tile registry and the editor', async () => {
    const app = await setup();
    const json = await get(app, '/boards/user:morning.json');
    expect(json.body.board).toMatchObject({ id: 'user:morning', name: 'Morning', derived: true, version: 0 });
    const page = await get(app, '/dashboards/user:morning');
    expect(page.status).toBe(200);
    expect(page.text).toContain('data-board-canvas="user:morning"');
    expect(page.text).toContain('src="/assets/board-canvas-editor.js"');
    expect(page.text).toContain('data-canvas-edit');
    expect(page.text).toContain('data-canvas-suggest');
    expect(page.text).toContain('Save as pack');
    expect(page.text).not.toContain('board-grid');
    const comps = surface(page.text);
    expect(comps.find((c) => c.id === 'root')).toMatchObject({ component: 'Column' });
    expect(comps.filter((c) => c.component === 'Section').map((c) => c.title)).toEqual(['Today']);
    expect(comps.filter((c) => c.component === 'AgentTile').map((c) => c.agentId)).toEqual(['news', 'weather', 'ghost']);
    expect(comps.find((c) => c.component === 'Cell')).toMatchObject({ span: 2 }); // weather is 2x1
    const tiles = registry(page.text);
    expect(Object.keys(tiles).sort()).toEqual(['news', 'weather']); // ghost draws as "isn't installed"
    expect(tiles.news).toMatchObject({ title: 'news', run: 'button', empty: 'No runs yet.', age: 'never' });
    expect(tiles.news.configure.config).toMatchObject({ template: 'text-headline' });
    expect(tiles.news.hideAction).toBeUndefined();
    expect(editorData(page.text)).toMatchObject({ id: 'user:morning', version: 0, isPulse: false, plannerUrl: '/dashboards/user%3Amorning/layout-plan', offerImport: false });
  });

  it('Pulse: placed tiles on the canvas, the rest under "Everything else" in tabs; health tiles as A2UI; × hides', async () => {
    const app = await setup();
    let page = await get(app, '/pulse');
    let comps = surface(page.text);
    expect(comps.find((c) => c.id === 'rest')).toMatchObject({ component: 'Section', title: 'Everything else', child: 'rest_tabs' });
    expect((comps.find((c) => c.id === 'rest_tabs')!.tabs as Array<{ title: string }>).map((t) => t.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^Health/), expect.stringMatching(/^Never run/)]));
    let tiles = registry(page.text);
    expect(tiles.weather.hideAction).toBe('/agents/weather/signal/toggle');
    expect(JSON.stringify(tiles['_system-runs-today'].messages)).toContain('"component":"Metric"');
    expect(editorData(page.text)).toMatchObject({ isPulse: true, offerImport: true });

    new BoardsStore(ctx.runStore.databaseHandle()).saveDoc({ id: 'pulse', name: 'Pulse', expectedVersion: 0, doc: { components: [
      { id: 't1', component: 'AgentTile', agentId: 'news' }, { id: 't2', component: 'AgentTile', agentId: 'weather' },
      { id: 'root', component: 'Column', children: ['t1', 't2'] },
    ] } });
    page = await get(app, '/pulse');
    comps = surface(page.text);
    expect((comps.find((c) => c.id === 'root')!.children as string[]).slice(0, 2)).toEqual(['t1', 't2']);
    expect(comps.some((c) => c.id === 'rest_tile_news')).toBe(false); // placed, so not under Everything else
    expect(comps.some((c) => c.id === 'rest_tile_notes')).toBe(true);
    expect(editorData(page.text)).toMatchObject({ version: 1, offerImport: false });

    // A placed agent hidden from Pulse drops off the canvas.
    ctx.agentStore.updateAgentMeta('news', { pulseVisible: false });
    page = await get(app, '/pulse');
    comps = surface(page.text);
    expect(comps.some((c) => c.component === 'AgentTile' && c.agentId === 'news')).toBe(false);
    expect(page.text).toContain('1 hidden');

    const one = await get(app, '/boards/tile/weather.json?board=pulse');
    expect(one.body).toMatchObject({ title: 'weather', hideAction: '/agents/weather/signal/toggle' });
    expect((await get(app, '/boards/tile/ghost.json')).status).toBe(404);
  });

  it('redirects /boards/<id> to the page; with boards off the old pages return and /boards/<id>/canvas previews', async () => {
    const app = await setup();
    expect((await get(app, '/boards/pulse')).headers.location).toBe('/pulse');
    expect((await get(app, '/boards/user:morning')).headers.location).toBe('/dashboards/user%3Amorning');
    expect((await get(app, '/boards/user:morning/canvas')).headers.location).toBe('/dashboards/user%3Amorning');
    expect((await get(app, '/boards/nope')).status).toBe(404);
    expect((await get(app, '/boards/nope.json')).status).toBe(404);
    setDashboardPrefs({ boardPages: false });
    try {
      expect((await get(app, '/pulse')).text).toContain('id="pulse-tile-data"');
      expect((await get(app, '/boards/pulse')).headers.location).toBe('/boards/pulse/canvas');
      const preview = await get(app, '/boards/pulse/canvas');
      expect(preview.status).toBe(200);
      expect(preview.text).toContain('Canvas preview');
      expect(preview.text).toContain('data-board-canvas="pulse"');
    } finally { setDashboardPrefs({ boardPages: true }); }
  });
});

describe('arranging a canvas', () => {
  it('applies tree operations to a working copy (nothing saved), then saves with a version and undoes', async () => {
    const app = await setup();
    const data = editorData((await get(app, '/dashboards/user:morning')).text);
    const section = (data.doc.components as Array<{ id: string; component: string }>).find((c) => c.component === 'Section')!;

    let res = await post(app, '/boards/user:morning/doc/apply', { doc: data.doc, ops: [
      { op: 'wrap', id: section.id, in: 'tabs', title: 'Now' },
      { op: 'insert', parent: 'root', node: { type: 'tile', agentId: 'notes' } },
    ] });
    expect(res.body.error).toBeUndefined();
    expect(res.body.created).toHaveLength(1);
    expect(res.body.tiles.notes).toMatchObject({ title: 'notes' });
    expect(JSON.stringify(res.body.messages)).toContain('"component":"Tabs"');
    expect(new BoardsStore(ctx.runStore.databaseHandle()).get('user:morning')).toBeUndefined();
    const working = res.body.doc;

    res = await post(app, '/boards/user:morning/doc/apply', { doc: working, ops: [{ op: 'insert', parent: 'root', node: { type: 'tile', agentId: 'nope-agent' } }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No tile for "nope-agent"/);
    res = await post(app, '/boards/user:morning/doc/apply', { doc: working, ops: [{ op: 'remove', id: 'root' }] });
    expect(res.body.error).toMatch(/root/);
    res = await post(app, '/boards/user:morning/doc/apply', { doc: working, ops: [] });
    expect(res.body.doc).toEqual(working);

    res = await post(app, '/boards/user:morning/doc', { doc: working, version: 0 });
    expect(res.body.board).toMatchObject({ version: 1 });
    expect((await post(app, '/boards/user:morning/doc', { doc: working, version: 0 })).status).toBe(409);
    const notesTile = (working.components as Array<{ id: string; agentId?: string }>).find((c) => c.agentId === 'notes')!.id;
    const second = (await post(app, '/boards/user:morning/doc/apply', { doc: working, ops: [{ op: 'remove', id: notesTile }] })).body.doc;
    expect((await post(app, '/boards/user:morning/doc', { doc: second, version: 1 })).body.board.version).toBe(2);
    res = await post(app, '/boards/user:morning/undo', { version: 2 });
    expect(res.body.error).toBeUndefined();
    const after = await get(app, '/dashboards/user:morning');
    expect(after.text).toContain('data-canvas-undo');
    expect(surface(after.text).some((c) => c.agentId === 'notes')).toBe(true);
  });

  it('a save from another origin is refused', async () => {
    const app = await setup();
    const res = await request(app).post('/boards/pulse/doc').set('Host', `127.0.0.1:${PORT}`).set('Origin', 'https://evil.example').set('Cookie', COOKIE)
      .send({ version: 0, doc: { components: [{ id: 'root', component: 'Column', children: [] }] } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(new BoardsStore(ctx.runStore.databaseHandle()).get('pulse')).toBeUndefined();
  });

  it('Save as pack exports the canvas: each section or tab becomes a pack section', async () => {
    const app = await setup();
    new BoardsStore(ctx.runStore.databaseHandle()).saveDoc({ id: 'user:morning', name: 'Morning', expectedVersion: 0, doc: { components: [
      { id: 'a', component: 'AgentTile', agentId: 'weather' }, { id: 'b', component: 'AgentTile', agentId: 'notes' },
      { id: 'tabs', component: 'Tabs', tabs: [{ title: 'Outside', child: 'a' }, { title: 'Reading', child: 'b' }] },
      { id: 'root', component: 'Column', children: ['tabs'] },
    ] } });
    const pack = await get(app, '/dashboards/user:morning/export');
    expect(pack.text).toContain('Outside');
    expect(pack.text).toContain('Reading');
    expect(pack.text).not.toMatch(/- news\b/);
  });

  it('starts Pulse from the old browser arrangement once', async () => {
    const app = await setup();
    let res = await post(app, '/boards/pulse/import', {
      containers: [{ id: 'mine', label: 'Mine', tiles: ['weather', 'ghost', '_system-runs-today'] }],
      sizes: { weather: '2x2' },
    });
    expect(res.status).toBe(200);
    const comps = surface((await get(app, '/pulse')).text);
    expect(comps.filter((c) => c.component === 'Section').map((c) => c.title)).toEqual(['Mine', 'Everything else']);
    expect(comps.find((c) => c.component === 'Cell')).toMatchObject({ span: 2, rows: 2 });
    res = await post(app, '/boards/pulse/import', { containers: [{ label: 'Again', tiles: ['news'] }] });
    expect(res.status).toBe(409);
  });

  it('turns a layout-planner plan into a canvas document without saving', async () => {
    const app = await setup();
    const plan = {
      summary: 'Weather first.',
      topAgents: [{ id: 'weather', rationale: 'Most used', suggestedSize: '2x2' }],
      containers: [{ label: 'Now', tiles: ['weather', 'ghost', '_system-runs-today'] }, { label: 'Later', tiles: ['notes'] }],
    };
    let res = await post(app, '/boards/user:morning/plan-preview', { plan });
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe('Weather first.');
    const comps = res.body.doc.components as Array<Record<string, unknown>>;
    expect(comps.filter((c) => c.component === 'Section').map((c) => c.title)).toEqual(['Now', 'Later']);
    expect(comps.filter((c) => c.component === 'AgentTile').map((c) => c.agentId)).toEqual(['weather', 'notes']);
    expect(comps.some((c) => c.component === 'SystemTile')).toBe(false); // health tiles only on Pulse
    expect(new BoardsStore(ctx.runStore.databaseHandle()).get('user:morning')).toBeUndefined();
    res = await post(app, '/boards/user:morning/plan-preview', { plan: { summary: 'x', topAgents: [{ id: 'ghost', rationale: 'r' }], containers: [{ label: 'G', tiles: ['ghost'] }] } });
    expect(res.status).toBe(400);
  });

  it('an agent arranges the canvas with board-place, and the page shows it', async () => {
    const app = await setup();
    const store = new BoardsStore(ctx.runStore.databaseHandle());
    const { getBuiltinTool } = await import('@some-useful-agents/core');
    const read = await getBuiltinTool('board-read')!.execute({ board: 'user:morning' }, { boards: store });
    const grid = /\[(grid_\d+)\] grid/.exec(String(read.result))![1];
    const out = await getBuiltinTool('board-place')!.execute({ board: 'user:morning', version: 0, ops: [
      { op: 'insert', parent: grid, index: 0, node: { type: 'tile', agentId: 'notes' } },
      { op: 'insert', parent: 'root', index: 0, node: { type: 'section', title: 'Agent picks' } },
    ] }, { boards: store });
    expect(out.isError).toBeFalsy();
    const comps = surface((await get(app, '/dashboards/user:morning')).text);
    const root = comps.find((c) => c.id === 'root')!;
    expect((root.children as string[]).map((id) => comps.find((c) => c.id === id)!.title)).toEqual(['Agent picks', 'Today']);
    const gridKids = comps.find((c) => c.id === grid)!.children as string[];
    expect(comps.find((c) => c.id === gridKids[0])).toMatchObject({ component: 'AgentTile', agentId: 'notes' });
  });

});

describe('brand theme', () => {
  const form = (app: Parameters<typeof request>[0], p: string, body: Record<string, string>) =>
    request(app).post(p).type('form').send(body).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);

  it('is served as theme.css on every page, edited in Settings → Appearance, with undo and reset', async () => {
    const app = await setup();
    let css = await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`);
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
    expect(css.text).toContain('--accent-teal: #2dd4bf;');
    expect(css.text).not.toContain('--color-primary');
    expect((await get(app, '/pulse')).text).toContain('href="/assets/theme.css"');

    let page = await get(app, '/settings/appearance');
    expect(page.text).toContain('action="/settings/appearance/brand"');
    const version = /name="version" value="([^"]*)"/.exec(page.text)![1];
    let res = await form(app, '/settings/appearance/brand', {
      version, preset: 'warm', name: 'Acme', 'dark.primary': '#ff0066', 'light.primary': '', 'fonts.sans': '"Inter", sans-serif', 'radius.md': '4', 'accents.teal': 'rgb(0, 128, 128)',
    });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/flash=Brand\+saved/);
    css = await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`);
    expect(css.text).toContain('--color-primary: #ff0066;');
    expect(css.text).toContain('--color-bg: #1c1917;'); // from the warm preset
    expect(css.text).toContain('--font-sans: "Inter", sans-serif;');
    expect(css.text).toContain('--radius-md: 4px;');
    expect(css.text).toContain('--accent-teal: rgb(0, 128, 128);');

    // Anything that could break out of CSS is refused, and nothing changes.
    page = await get(app, '/settings/appearance');
    const v2 = /name="version" value="([^"]*)"/.exec(page.text)![1];
    res = await form(app, '/settings/appearance/brand', { version: v2, preset: 'warm', 'dark.primary': 'red; } body { display: none' });
    expect(res.headers.location).toMatch(/error=/);
    expect((await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`)).text).toContain('--color-primary: #ff0066;');
    // A stale form is refused.
    res = await form(app, '/settings/appearance/brand', { version: 'stale', preset: 'neon' });
    expect(decodeURIComponent(res.headers.location.replace(/\+/g, " "))).toMatch(/changed since you opened it/);

    res = await form(app, '/settings/appearance/brand', { version: v2, reset: '1' });
    expect((await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`)).text).not.toContain('--color-primary');
    page = await get(app, '/settings/appearance');
    const v3 = /name="version" value="([^"]*)"/.exec(page.text)![1];
    expect(page.text).toContain('action="/settings/appearance/brand/undo"');
    res = await form(app, '/settings/appearance/brand/undo', { version: v3 });
    expect((await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`)).text).toContain('--color-primary: #ff0066;');
  });
});

describe('build a board from a request', { timeout: 30_000 }, () => {
  it('plans with the board builder, arranges a canvas, runs the tiles, and reports in the inbox', async () => {
    const app = await setup();
    // A stand-in board builder that returns a fixed plan (the real one is an LLM agent).
    const plan = { name: 'Morning view', summary: 'Weather and news; no calendar agent yet.', layout: 'sections',
      sections: [{ title: 'Outside', tiles: [{ agentId: 'weather', span: 2 }] }, { title: 'Reading', tiles: [{ agentId: 'news' }, { agentId: 'ghost' }] }],
      missing: [] };
    // (Drafting agents for missing parts is covered in board-build-drafts.test.ts, with a stubbed drafter.)
    ctx.agentStore.createAgent({ id: 'board-builder', name: 'Test builder', status: 'active', source: 'local', mcp: false,
      inputs: { REQUEST: { type: 'string', required: true }, CATALOG: { type: 'string', required: true } },
      nodes: [{ id: 'plan', type: 'shell', command: `printf '%s' '<plan>${JSON.stringify(plan)}</plan>'` }] } as never, 'cli');

    const page = await get(app, '/boards/new');
    expect(page.text).toContain('action="/boards/build"');
    const res = await request(app).post('/boards/build').type('form').send({ request: 'a morning board with weather and news' })
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    const boardId = decodeURIComponent(res.headers.location.replace('/dashboards/', ''));
    expect(boardId).toMatch(/^user:a-morning-board/);

    let build: { phase: string } = { phase: '' };
    for (let i = 0; i < 300 && build.phase !== 'done' && build.phase !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      build = (await get(app, `/boards/${encodeURIComponent(boardId)}/build.json`)).body;
    }
    expect(build).toMatchObject({ phase: 'done', placed: ['weather', 'news'], failed: [], missing: [], drafts: [], detail: plan.summary });

    const board = await get(app, res.headers.location);
    const comps = surface(board.text);
    expect(comps.filter((c) => c.component === 'Section').map((c) => c.title).sort()).toEqual(['Outside', 'Reading']);
    expect(comps.filter((c) => c.component === 'AgentTile').map((c) => c.agentId).sort()).toEqual(['news', 'weather']);
    expect(board.text).toContain('Built from your request.');
    expect(ctx.dashboardsStore!.getDashboard(boardId)!.name).toBe('Morning view');
    // Every tile ran once.
    expect(ctx.runStore.listRuns({ agentName: 'weather', limit: 5 }).length).toBeGreaterThan(0);
    expect(ctx.runStore.listRuns({ agentName: 'news', limit: 5 }).length).toBeGreaterThan(0);
    // The inbox says it's ready.
    const msg = ctx.inboxStore!.list({ source: 'board' })[0];
    expect(msg).toMatchObject({ source: 'board', title: 'Your board "Morning view" is ready' });
    expect(msg.body).toContain(res.headers.location);
    expect(msg.body).toContain('2 tiles from your agents, all run.');
  });

  it('reports a builder that fails, and refuses an empty request', async () => {
    const app = await setup();
    ctx.agentStore.createAgent({ id: 'board-builder', name: 'Broken builder', status: 'active', source: 'local', mcp: false,
      inputs: { REQUEST: { type: 'string', required: true }, CATALOG: { type: 'string', required: true } },
      nodes: [{ id: 'plan', type: 'shell', command: 'echo not a plan' }] } as never, 'cli');
    const res = await request(app).post('/boards/build').type('form').send({ request: 'anything' })
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const boardId = decodeURIComponent(res.headers.location.replace('/dashboards/', ''));
    let build: { phase: string; error?: string } = { phase: '' };
    for (let i = 0; i < 300 && build.phase !== 'done' && build.phase !== 'failed'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      build = (await get(app, `/boards/${encodeURIComponent(boardId)}/build.json`)).body;
    }
    expect(build).toMatchObject({ phase: 'failed', error: expect.stringMatching(/didn't return a plan/) });
    expect(ctx.inboxStore!.list({ source: 'board' })[0]).toMatchObject({ title: "Couldn't build your board", priority: 'high' });
    const empty = await request(app).post('/boards/build').type('form').send({ request: '  ' })
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(empty.headers.location).toMatch(/^\/boards\/new\?error=/);
  });
});
