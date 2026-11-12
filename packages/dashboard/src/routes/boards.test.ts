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
  // No model in tests: a built board keeps its grid unless a test answers for the page agent.
  ctx.boardPageRun = async () => undefined;
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

  it("a board has a goal: said on its page, kept through arranging and a new look, set from what a build was asked for, and given to sua whenever it draws the page", async () => {
    const app = await setup();
    const boards = new BoardsStore(ctx.runStore.databaseHandle());
    // None yet: the page offers to add one.
    let page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('data-board-goal');
    expect(page.text).toContain('Say what this board is for');
    expect(page.text).toContain('<form method="POST" action="/boards/user%3Amorning/goal" class="board-goal__form">');
    // Saved on a board that has never been saved itself; one line, trimmed.
    const saved = await post(app, '/boards/user:morning/goal', { goal: '  Know the weather\nand the news before I leave  ' });
    expect(saved.status).toBe(303);
    expect(saved.headers.location).toBe('/dashboards/user%3Amorning?ok=Goal%20saved.');
    expect(boards.goal('user:morning')).toMatchObject({ text: 'Know the weather and the news before I leave', by: 'you' });
    page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('<span class="board-goal__text">Know the weather and the news before I leave</span>');
    expect(page.text).toContain('>Know the weather and the news before I leave</textarea>');
    // A new look and Undo leave it alone.
    await post(app, '/boards/user:morning/look', { look: 'front-page' });
    await post(app, '/boards/user:morning/look', { look: 'grid' });
    expect(boards.goal('user:morning')?.text).toBe('Know the weather and the news before I leave');
    // sua is told what the board is for when it draws the page, without being told again.
    const asked: Record<string, string>[] = [];
    ctx.boardPageRun = async (inputs) => { asked.push(inputs); return undefined; };
    await post(app, '/boards/user:morning/look', { look: 'pick' });
    expect(JSON.parse(asked[0].BOARD).for).toBe('Know the weather and the news before I leave');
    // Too long is cut; empty clears; Pulse has none.
    await post(app, '/boards/user:morning/goal', { goal: 'x'.repeat(400) });
    expect(boards.goal('user:morning')!.text).toHaveLength(280);
    expect((await post(app, '/boards/user:morning/goal', { goal: '   ' })).headers.location).toContain('Goal%20cleared');
    expect(boards.goal('user:morning')).toBeUndefined();
    expect((await post(app, '/boards/pulse/goal', { goal: 'x' })).headers.location).toContain('error=');
    expect((await post(app, '/boards/nope/goal', { goal: 'x' })).headers.location).toContain('error=');
    expect((await get(app, '/pulse/agents')).text).not.toContain('data-board-goal');
    expect(boards.setGoal('user:morning', 'From a build', 'request')).toMatchObject({ by: 'request' });
    expect((await get(app, '/dashboards/user:morning')).text).toContain('from what you asked for');
  });

  it('"Improve this board": sua reviews it against its goal; you take the goal, apply or skip each suggestion, and look again; nothing changes until you press', async () => {
    const app = await setup();
    const boards = new BoardsStore(ctx.runStore.databaseHandle());
    // On the board: news and weather (and a ghost that isn't installed). Not on it: notes.
    const asked: Record<string, string>[] = [];
    const review = (v: unknown) => `<review>${JSON.stringify(v)}</review>`;
    ctx.boardReviewRun = async (inputs) => {
      asked.push(inputs);
      return review({ goal: 'Know the weather and the news before I leave', note: 'Nothing here keeps your notes.',
        suggestions: [{ type: 'add-agent', agentId: 'notes', why: 'Returns your notes, which nothing on the board shows.' }, { type: 'remove', agentId: 'ghost', why: "It isn't installed, so its tile is empty." }, { type: 'add-agent', agentId: 'made-up', why: 'Not real.' }] });
    };
    let page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('<form method="POST" action="/boards/user%3Amorning/review" class="board-review__start"');
    expect(page.text).toContain('>Improve this board</button>');
    expect(page.text).not.toContain('class="board-review"');
    const start = await post(app, '/boards/user:morning/review', {});
    expect(start.headers.location).toBe('/dashboards/user%3Amorning');
    await ctx.boardReviewWork;
    // The reviewer read the goal (none yet), what is on the board and what isn't, each with what it returns.
    expect(asked[0].GOAL).toBe('');
    expect(JSON.parse(asked[0].BOARD)).toMatchObject({ name: 'Morning' });
    expect(JSON.parse(asked[0].BOARD).agents.map((a: { id: string }) => a.id)).toEqual(['news', 'weather']);
    expect(JSON.parse(asked[0].CANDIDATES).map((a: { id: string }) => a.id)).toContain('notes');
    expect(asked[0].ROUND).toBe('1');
    expect((await get(app, '/boards/user:morning/review.json')).body).toMatchObject({ round: 1, status: 'ready', open: 2 });
    // The board hasn't changed. The card: the goal to take first, then each suggestion with its reason and buttons.
    expect(boards.loadDocOrDerive('user:morning')!.doc.components.filter((c) => c.component === 'AgentTile').map((c) => c.agentId)).toEqual(['news', 'weather', 'ghost']);
    page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('sua suggests');
    expect(page.text).toContain('round 1');
    expect(page.text).toContain('<textarea id="board-review-goal" name="goal" rows="2" maxlength="280">Know the weather and the news before I leave</textarea>');
    expect(page.text).toContain('<span class="board-review__what">Add notes</span><span class="board-review__why">Returns your notes, which nothing on the board shows.</span>');
    expect(page.text).toContain('<span class="board-review__what">Leave out ghost</span>');
    expect(page.text).not.toContain('made-up');
    expect(page.text).toContain('>Apply all 2</button>');
    expect(page.text).toContain('>Look again</button>');
    // Take the goal as proposed: it's sua's.
    await post(app, '/boards/user:morning/goal', { goal: 'Know the weather and the news before I leave', proposed: 'Know the weather and the news before I leave' });
    expect(boards.goal('user:morning')).toMatchObject({ by: 'sua' });
    const rid = (await get(app, '/boards/user:morning/review.json')).body.id as string;
    // Add: a new version with the tile, the dashboard follows, and Undo is there.
    const add = await post(app, `/boards/user:morning/review/${rid}/apply`, { key: 'add-agent:notes' });
    expect(decodeURIComponent(add.headers.location)).toContain('?ok=Applied 1 suggestion. Undo last save puts the board back.');
    await ctx.boardReviewWork;
    expect(boards.loadDocOrDerive('user:morning')!.doc.components.filter((c) => c.component === 'AgentTile').map((c) => c.agentId).sort()).toEqual(['ghost', 'news', 'notes', 'weather']);
    expect(ctx.dashboardsStore!.getDashboard('user:morning')!.layout.sections.flatMap((x) => x.agentIds)).toContain('notes');
    expect(boards.get('user:morning')!.hasPrevious).toBe(true);
    // Skip: marked, and remembered.
    await post(app, `/boards/user:morning/review/${rid}/skip`, { key: 'remove:ghost' });
    page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('<span class="board-review__state">Added</span>');
    expect(page.text).toContain('<span class="board-review__state">Skipped</span>');
    expect(page.text).toContain('That was all of them.');
    expect(boards.loadDocOrDerive('user:morning')!.doc.components.some((c) => c.agentId === 'ghost')).toBe(true);
    // Applying it again, or one from another board, does nothing.
    expect(decodeURIComponent((await post(app, `/boards/user:morning/review/${rid}/apply`, { key: 'add-agent:notes' })).headers.location)).toContain('nothing left to apply');
    expect(decodeURIComponent((await post(app, `/boards/user:other/review/${rid}/apply`, {})).headers.location)).toContain("isn't for this board");
    // Look again: round 2 knows the goal, sees notes on the board, is told what was skipped, and can be done.
    ctx.boardReviewRun = async (inputs) => { asked.push(inputs); return review({ goal: 'Ignored now', suggestions: [{ type: 'remove', agentId: 'ghost', why: 'Again.' }], note: 'It serves the goal.' }); };
    await post(app, '/boards/user:morning/review', {});
    await ctx.boardReviewWork;
    expect(asked[1].GOAL).toBe('Know the weather and the news before I leave');
    expect(asked[1].ROUND).toBe('2');
    expect(JSON.parse(asked[1].BOARD).agents.map((a: { id: string }) => a.id)).toEqual(['news', 'weather', 'notes']);
    expect(JSON.parse(asked[1].SKIPPED)).toEqual(['remove:ghost']);
    page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('round 2');
    expect(page.text).toContain('Nothing more to suggest for this goal.');
    expect(page.text).not.toContain('board-review-goal');
    // Leave out works when taken; a reviewer that fails says so; Pulse has no review.
    ctx.boardReviewRun = async () => review({ suggestions: [{ type: 'remove', agentId: 'weather', why: 'It repeats the news.' }] });
    await post(app, '/boards/user:morning/review', {});
    await ctx.boardReviewWork;
    const r3 = (await get(app, '/boards/user:morning/review.json')).body.id as string;
    await post(app, `/boards/user:morning/review/${r3}/apply`, {});
    await ctx.boardReviewWork;
    expect(boards.loadDocOrDerive('user:morning')!.doc.components.some((c) => c.agentId === 'weather')).toBe(false);
    // Content: sua is told what the board's results can be drawn as; taking one asks sua's page agent in words, and it's marked done once the page is drawn.
    const pageAsks: Record<string, string>[] = [];
    ctx.boardReviewRun = async (inputs) => { asked.push(inputs); return review({ suggestions: [{ type: 'content', kind: 'headline', from: 'news', why: 'Its headline says the day in a line.' }, { type: 'content', kind: 'numbers', from: 'news', why: 'No figures here.' }] }); };
    await post(app, '/boards/user:morning/review', {});
    await ctx.boardReviewWork;
    expect(JSON.parse(asked[asked.length - 1].BOARD).canDraw).toEqual({});
    expect((await get(app, '/boards/user:morning/review.json')).body.open).toBe(0);
    // news has run with a headline: now it can be drawn.
    ctx.runStore.createRun({ id: 'run-news', agentName: 'news', status: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), result: JSON.stringify({ headline: 'Rain by noon', stories: [{ title: 'a' }] }), triggeredBy: 'cli' } as never);
    await post(app, '/boards/user:morning/review', {});
    await ctx.boardReviewWork;
    expect(JSON.parse(asked[asked.length - 1].BOARD).canDraw).toEqual({ headline: ['news'], 'top-story': ['news'] });
    const r4 = (await get(app, '/boards/user:morning/review.json')).body;
    expect(r4.open).toBe(1);
    expect((await get(app, '/dashboards/user:morning')).text).toContain('headline from news</span>');
    const comps = [{ id: 'root', component: 'Column', children: ['p'] }, { id: 'p', component: 'Panel', title: 'News', child: 't', treatment: 'feature', when: 'news' }, { id: 't', component: 'AgentTile', agentId: 'news', chrome: 'bare' }];
    ctx.boardPageRun = async (inputs) => { pageAsks.push(inputs); return `<page>${JSON.stringify({ components: comps, about: 'the headline leads' })}</page>`; };
    const draw = await post(app, `/boards/user:morning/review/${String(r4.id)}/apply`, { key: 'content:headline:news' });
    expect(decodeURIComponent(draw.headers.location)).toContain('sua is drawing 1 of them on the page');
    await ctx.boardReviewWork;
    expect(pageAsks[0].ASK).toBe("Lead the page with the day's headline from news's result, as a lede right under the masthead. Keep everything else that is on the page.");
    expect(JSON.parse(pageAsks[0].BOARD).for).toBe('Know the weather and the news before I leave');
    expect(boards.get('user:morning')!.layoutMeta).toMatchObject({ layoutBy: 'you' });
    expect((await get(app, '/dashboards/user:morning')).text).toContain('<span class="board-review__state">Drawn</span>');
    ctx.boardReviewRun = async () => 'no review here';
    await post(app, '/boards/user:morning/review', {});
    await ctx.boardReviewWork;
    expect((await get(app, '/dashboards/user:morning')).text).toContain("The review didn't finish.");
    expect(decodeURIComponent((await post(app, '/boards/pulse/review', {})).headers.location)).toContain('All agents grid has no goal');
    expect((await get(app, '/pulse/agents')).text).not.toContain('board-review__start');
  });

  it("Pulse opens on today's edition when scheduled agents reported in the last day: a generated front page of their own views, never saved; the grid is under All agents", async () => {
    const app = await setup();
    // Nothing scheduled has run: Pulse is its grid, with no tabs.
    const before = await get(app, '/pulse');
    expect(before.text).toContain('data-board-canvas="pulse"');
    expect(before.text).not.toContain('pulse-tabs');
    const sched = (id: string, result: string) => {
      ctx.agentStore.createAgent({ id, name: id, status: 'active', source: 'local', mcp: false, schedule: '0 8 * * *',
        nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }], signal: { title: `The ${id}`, template: 'text-headline', mapping: { headline: 'result' } } } as never, 'cli');
      const at = new Date(Date.now() - 3600_000).toISOString();
      ctx.runStore.createRun({ id: `run-${id}`, agentName: id, status: 'completed', startedAt: at, completedAt: at, result, triggeredBy: 'schedule' } as never);
    };
    sched('digest', JSON.stringify({ summary: 'Six roles passed.' }));
    sched('hn', JSON.stringify({ headline: 'HN Top 5' }));
    const page = await get(app, '/pulse');
    expect(page.status).toBe(200);
    expect(page.text).toContain('data-board-canvas="today"');
    expect(page.text).toContain('data-board-composed="1"');
    expect(page.text).toContain('2 scheduled agents reported in the last day');
    expect(page.text).toContain('<a class="pulse-tabs__tab is-active" href="/pulse" aria-current="page">Today\'s edition</a>');
    expect(page.text).toContain('<a class="pulse-tabs__tab" href="/pulse/agents">All agents</a>');
    // Generated, so nothing to arrange: no editor, no Arrange.
    expect(page.text).not.toContain('board-canvas-editor.js');
    expect(page.text).not.toContain('data-canvas-edit');
    const comps = surface(page.text);
    expect(comps.find((c) => c.id === 'masthead')).toMatchObject({ component: 'Panel', hero: true });
    // Only the scheduled ones that reported; each as its own view in a panel.
    expect(comps.filter((c) => c.component === 'AgentTile').map((c) => c.agentId).sort()).toEqual(['digest', 'hn']);
    expect(comps.filter((c) => c.component === 'AgentTile').every((c) => c.chrome === 'bare')).toBe(true);
    expect(Object.keys(registry(page.text)).sort()).toEqual(['digest', 'hn']);
    // It links to a part by agent; the script that scrolls there is on the page.
    expect(page.text).toContain("/^#agent-(.+)$/");
    // All agents is the grid as before, with the tabs.
    const grid = await get(app, '/pulse/agents');
    expect(grid.text).toContain('data-board-canvas="pulse"');
    expect(grid.text).toContain('data-canvas-edit');
    expect(grid.text).toContain('<a class="pulse-tabs__tab is-active" href="/pulse/agents" aria-current="page">All agents</a>');
    // Coming back from an action on the grid (a flash) lands on the grid.
    expect((await get(app, '/pulse?ok=Hid+3')).text).toContain('data-board-canvas="pulse"');
    // It refreshes like a board, and can't be saved, arranged or given a look.
    const data = await get(app, '/boards/today/data.json');
    expect(data.status).toBe(200);
    expect(Object.keys(data.body.tiles).sort()).toEqual(['digest', 'hn']);
    expect((await get(app, '/boards/today')).headers.location).toBe('/pulse');
    for (const path of ['/boards/today/doc', '/boards/today/doc/apply', '/boards/today/undo', '/boards/today/look']) {
      const no = await post(app, path, { doc: { components: [] } });
      expect(no.status).toBe(400);
      expect(no.body.error).toContain("can't be arranged or saved");
    }
    expect((await get(app, '/boards/today.json')).body.board).toMatchObject({ id: 'today', name: "Today's edition", version: 0 });
  });

  it("Today's edition can be improved: it has a goal, sua reviews it, and what you take becomes a preference the edition follows every day, with Undo and a way back", async () => {
    const app = await setup();
    const { EditionPrefsStore } = await import('@some-useful-agents/core');
    const prefs = () => new EditionPrefsStore(ctx.runStore.databaseHandle()).get();
    const sched = (id: string, result: unknown, schedule = '0 8 * * *') => {
      ctx.agentStore.createAgent({ id, name: id, status: 'active', source: 'local', mcp: false, ...(schedule ? { schedule } : {}),
        nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }], signal: { title: `The ${id}`, template: 'text-headline', mapping: { headline: 'result' } } } as never, 'cli');
      const at = new Date(Date.now() - 3600_000).toISOString();
      ctx.runStore.createRun({ id: `run-${id}`, agentName: id, status: 'completed', startedAt: at, completedAt: at, result: JSON.stringify(result), triggeredBy: 'schedule' } as never);
    };
    sched('digest', { summary: 'Six roles passed all checks today.', matches: [{ title: 'Senior PM, AI', url: 'https://jobs.example/1' }] });
    sched('hn', { headline: 'HN Top 5', stories: [{ title: 'A new SQLite release', url: 'https://news.example/1' }] });
    sched('routine', { headline: 'Evening reset' });
    sched('journal', { summary: 'Three entries this week.' }, '');
    const tilesOf = (text: string) => surface(text).filter((c) => c.component === 'AgentTile').map((c) => c.agentId).sort();
    let page = await get(app, '/pulse');
    expect(tilesOf(page.text)).toEqual(['digest', 'hn', 'routine']);
    expect(page.text).toContain('>Improve today&#39;s edition</button>');
    expect(page.text).toContain('<form method="POST" action="/boards/today/goal" class="board-goal__form">');
    expect(page.text).not.toContain('data-edition-changes');
    // A goal, kept like any board's.
    const goal = await post(app, '/boards/today/goal', { goal: 'Know what changed overnight' });
    expect(decodeURIComponent(goal.headers.location)).toBe('/pulse?edition=Goal saved.');
    expect((await get(app, goal.headers.location)).text).toContain('<span class="board-goal__text">Know what changed overnight</span>');
    // The review reads the edition as it is drawn now, and the agents that could be brought in; no new agents, no note.
    const asked: Record<string, string>[] = [];
    ctx.boardReviewRun = async (inputs) => {
      asked.push(inputs);
      return `<review>${JSON.stringify({ note: 'Covers jobs and news.', suggestions: [
        { type: 'content', kind: 'headline', from: 'hn', why: 'Its headline is the news of the day.' },
        { type: 'remove', agentId: 'routine', why: 'An evening checklist says nothing about what changed overnight.' },
        { type: 'add-agent', agentId: 'journal', why: 'Returns your entries, which nothing here shows.' },
        { type: 'content', kind: 'top-story', from: 'hn', why: 'Its first story is the one to read.' },
        { type: 'draft', purpose: 'A summary of overnight email that needs a reply', why: 'Not offered for the edition.' },
        { type: 'content', kind: 'note', why: 'Not for the edition.' },
      ] })}</review>`;
    };
    const start = await post(app, '/boards/today/review', {});
    expect(start.headers.location).toBe('/pulse');
    await ctx.boardReviewWork;
    expect(asked[0].GOAL).toBe('Know what changed overnight');
    expect(JSON.parse(asked[0].BOARD).name).toBe("Today's edition");
    expect(JSON.parse(asked[0].BOARD).agents.map((a: { id: string }) => a.id).sort()).toEqual(['digest', 'hn', 'routine']);
    expect(JSON.parse(asked[0].CANDIDATES).map((a: { id: string }) => a.id)).toContain('journal');
    // news, weather and notes have never run: nothing to show, so not offered.
    expect(JSON.parse(asked[0].CANDIDATES).map((a: { id: string }) => a.id)).not.toContain('notes');
    const r = (await get(app, '/boards/today/review.json')).body;
    expect(r).toMatchObject({ round: 1, status: 'ready', open: 4 });
    page = await get(app, '/pulse');
    expect(page.text).toContain('sua suggests');
    expect(page.text).toContain('Leave out The routine');
    expect(page.text).not.toContain('Draft a new agent');
    // Nothing has changed yet.
    expect(prefs()).toEqual({ hidden: [], include: [], wide: [], narrow: [] });
    // Take them all: preferences, not a saved page.
    const all = await post(app, `/boards/today/review/${String(r.id)}/apply`, {});
    expect(decodeURIComponent(all.headers.location)).toBe('/pulse?edition=Applied 4 suggestions. The edition follows them from now on; Undo last change goes back.');
    expect(prefs()).toEqual({ lead: 'hn', hidden: ['routine'], include: ['journal'], wide: [], narrow: [], topStory: 'hn' });
    expect(new BoardsStore(ctx.runStore.databaseHandle()).get('today')).toBeUndefined();
    page = await get(app, all.headers.location);
    expect(tilesOf(page.text)).toEqual(['digest', 'hn', 'journal']);
    const comps = surface(page.text);
    expect(comps.find((c) => c.id === 'lede')).toMatchObject({ title: 'The hn' });
    expect(comps.find((c) => c.id === 'lede_c')).toMatchObject({ text: 'HN Top 5: A new SQLite release' });
    expect(comps.find((c) => c.id === 'top_story_link')).toMatchObject({ component: 'Link', text: 'A new SQLite release', url: 'https://news.example/1' });
    expect(page.text).toContain('data-edition-changes');
    expect(page.text).toContain('Leads with The hn');
    expect(page.text).toContain('Always shows The journal');
    expect(page.text).toContain('<input type="hidden" name="agentId" value="routine"><span>The routine</span>');
    expect(page.text).toContain('>Undo last change</button>');
    expect(page.text).toContain('>Back to automatic</button>');
    // Bring one back; undo that; reset everything; undo the reset.
    await post(app, '/pulse/edition/show', { agentId: 'routine' });
    expect(prefs().hidden).toEqual([]);
    expect(decodeURIComponent((await post(app, '/pulse/edition/undo', {})).headers.location)).toContain('before your last change');
    expect(prefs().hidden).toEqual(['routine']);
    await post(app, '/pulse/edition/reset', {});
    expect(prefs()).toEqual({ hidden: [], include: [], wide: [], narrow: [] });
    expect(tilesOf((await get(app, '/pulse')).text)).toEqual(['digest', 'hn', 'routine']);
    await post(app, '/pulse/edition/undo', {});
    expect(prefs().lead).toBe('hn');
    // Asking in words: sua is given the edition as it is, proposes changes, and nothing changes until you apply.
    await post(app, '/pulse/edition/reset', {});
    const edits: Record<string, string>[] = [];
    ctx.editionEditorRun = async (inputs) => { edits.push(inputs); return `<edition>${JSON.stringify({ ops: [{ op: 'lead', agentId: 'digest' }, { op: 'hide', agentId: 'routine' }], say: 'The job digest will lead and the routine will be left out.' })}</edition>`; };
    page = await get(app, '/pulse');
    expect(page.text).toContain('<form method="POST" action="/pulse/edition/ask" class="edition-ask"');
    expect((await post(app, '/pulse/edition/ask', { text: '  lead with jobs,\n drop the routine ' })).headers.location).toBe('/pulse');
    await ctx.boardReviewWork;
    expect(edits[0].ASK).toBe('lead with jobs, drop the routine');
    const seen = JSON.parse(edits[0].EDITION) as { goal: string; showing: Array<{ id: string; title: string; column: string }>; couldShow: Array<{ id: string }>; numbersBand: boolean };
    expect(seen.goal).toBe('Know what changed overnight');
    expect(seen.showing.map((x) => x.id).sort()).toEqual(['digest', 'hn', 'routine']);
    expect(seen.couldShow.map((x) => x.id)).toContain('journal');
    expect(seen.numbersBand).toBe(true);
    expect((await get(app, '/pulse/edition/ask.json')).body).toMatchObject({ status: 'ready' });
    expect(prefs()).toEqual({ hidden: [], include: [], wide: [], narrow: [] });
    page = await get(app, '/pulse');
    expect(page.text).toContain('You asked');
    expect(page.text).toContain('<span class="board-review__what">Lead with The digest</span>');
    expect(page.text).toContain('<span class="board-review__what">Leave out The routine</span>');
    expect(page.text).toContain('>Apply all 2</button>');
    const askId = (await get(app, '/pulse/edition/ask.json')).body.id as string;
    const applied = await post(app, `/pulse/edition/ask/${askId}/apply`, {});
    expect(decodeURIComponent(applied.headers.location)).toBe('/pulse?edition=Lead with The digest; Leave out The routine. The edition follows them from now on; Undo last change goes back.');
    expect(prefs()).toMatchObject({ lead: 'digest', hidden: ['routine'] });
    expect((await get(app, '/pulse')).text).not.toContain('You asked');
    // Applying it twice does nothing; one that names nothing real says why and changes nothing; Discard forgets a proposal.
    expect(decodeURIComponent((await post(app, `/pulse/edition/ask/${askId}/apply`, {})).headers.location)).toContain('nothing to apply');
    ctx.editionEditorRun = async () => `<edition>${JSON.stringify({ ops: [{ op: 'lead', agentId: 'made-up' }] })}</edition>`;
    await post(app, '/pulse/edition/ask', { text: 'lead with the thing' });
    await ctx.boardReviewWork;
    page = await get(app, '/pulse');
    expect(page.text).toContain("That couldn't be worked out.");
    expect(page.text).toContain('no agent');
    const bad = (await get(app, '/pulse/edition/ask.json')).body.id as string;
    await post(app, `/pulse/edition/ask/${bad}/discard`, {});
    expect((await get(app, '/pulse/edition/ask.json')).body).toEqual({ status: 'none' });
    expect(prefs()).toMatchObject({ lead: 'digest', hidden: ['routine'] });
    expect(decodeURIComponent((await post(app, '/pulse/edition/ask', { text: '   ' })).headers.location)).toContain('Say what to change');
    // Still nothing to arrange or save.
    expect((await post(app, '/boards/today/doc', { doc: { components: [] } })).status).toBe(400);
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

  it('a tile may run the agents placed on its board: a named board\'s placements, or everything Pulse shows', async () => {
    await setup();
    const { boardRunTargets } = await import('./boards.js');
    expect([...boardRunTargets(ctx, 'user:morning')]).toEqual(['news', 'weather', 'ghost']);
    expect([...boardRunTargets(ctx, 'pulse')].sort()).toEqual(['news', 'notes', 'weather']);
    ctx.agentStore.updateAgentMeta('notes', { pulseVisible: false });
    expect([...boardRunTargets(ctx, 'pulse')].sort()).toEqual(['news', 'weather']); // hidden from Pulse: not a target there
    expect([...boardRunTargets(ctx, 'user:nope')]).toEqual([]);
  });

  it('redirects /boards/<id> (and the old /canvas preview address) to the page', async () => {
    const app = await setup();
    expect((await get(app, '/boards/pulse')).headers.location).toBe('/pulse/agents');
    expect((await get(app, '/boards/user:morning')).headers.location).toBe('/dashboards/user%3Amorning');
    expect((await get(app, '/boards/user:morning/canvas')).headers.location).toBe('/dashboards/user%3Amorning');
    expect((await get(app, '/boards/nope')).status).toBe(404);
    expect((await get(app, '/boards/nope.json')).status).toBe(404);
    expect((await get(app, '/boards/nope/canvas')).status).toBe(404);
  });
});

describe('arranging a canvas', () => {
  it('lists agents for the tile picker with what they do, and never names one by an unfilled template title', async () => {
    const app = await setup();
    ctx.agentStore.createAgent({ id: 'job-search', name: 'Job Search', description: 'Finds\n  roles   on job boards.', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }], signal: { title: '{{inputs.SEARCH_QUERY}}', template: 'text-headline', mapping: { headline: 'result' } } } as never, 'cli');
    const data = editorData((await get(app, '/dashboards/user:morning')).text);
    const agents = data.agents as Array<{ id: string; name: string; description: string }>;
    expect(agents.find((a) => a.id === 'job-search')).toMatchObject({ name: 'Job Search', description: 'Finds roles on job boards.' });
    expect(agents.find((a) => a.id === 'news')).toMatchObject({ name: 'news', description: '' });
    expect(agents.some((a) => a.name.includes('{{'))).toBe(false);
  });

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

  it('the gallery uses a preset in one click, and Undo puts the look before back', async () => {
    const app = await setup();
    const version = async () => /name="version" value="([^"]*)"/.exec((await get(app, '/settings/appearance')).text)![1];
    const css = async () => (await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`)).text;
    await form(app, '/settings/appearance/brand', { version: await version(), preset: 'minimal', name: 'Apple', 'dark.primary': '#2997ff' });
    let page = await get(app, '/settings/appearance');
    // The look now: its name and a light and a dark preview in its colours.
    expect(page.text).toMatch(/id="look-now-title">Apple</);
    expect(page.text).toContain('data-preview-mode="dark" style="--p-bg: ');
    expect(page.text).toContain('--p-primary: #2997ff');
    // Presets in the gallery, none in use (Apple is your own look on top of Minimal).
    expect(page.text).toContain('aria-label="Use Warm"');
    expect(page.text).not.toMatch(/, in use"/);
    let res = await form(app, '/settings/appearance/presets/warm/apply', { version: await version() });
    expect(res.headers.location).toContain('applied=1');
    expect(decodeURIComponent(res.headers.location.replace(/\+/g, ' '))).toContain('Now using Warm everywhere');
    expect(await css()).not.toContain('#2997ff');
    expect(await css()).toContain('--color-bg: #1c1917;');
    page = await get(app, '/settings/appearance?applied=1');
    expect(page.text).toContain('aria-label="Warm, in use"');
    expect(page.text).toMatch(/btn btn--sm btn--primary">Undo last change/);
    // Undo: Apple again.
    await form(app, '/settings/appearance/brand/undo', { version: await version() });
    expect(await css()).toContain('--color-primary: #2997ff;');
    // No such preset; a stale page.
    expect((await form(app, '/settings/appearance/presets/nope/apply', { version: await version() })).headers.location).toMatch(/error=/);
    expect((await form(app, '/settings/appearance/presets/neon/apply', { version: 'stale' })).headers.location).toMatch(/error=/);
    // Saving from Fine-tune comes back to it.
    res = await form(app, '/settings/appearance/brand', { version: await version(), preset: 'minimal', 'dark.primary': '#3399ff' });
    expect(res.headers.location).toMatch(/tuned=1#tune$/);
  });

  it("keeps colours the form doesn't show while the preset stays; a new preset starts from its own", async () => {
    const app = await setup();
    const version = async () => /name="version" value="([^"]*)"/.exec((await get(app, '/settings/appearance')).text)![1];
    const css = async () => (await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`)).text;
    // A made brand sets shades the form has no field for.
    await form(app, '/settings/appearance/brand', { version: await version(), preset: 'minimal', name: 'Apple', 'dark.primary': '#2997ff', 'dark.primary-hover': '#47a6ff' });
    expect(await css()).toContain('--color-primary-hover: #47a6ff;');
    // Saving the form (no hover field) keeps it.
    await form(app, '/settings/appearance/brand', { version: await version(), preset: 'minimal', name: 'Apple', 'dark.primary': '#3399ff' });
    expect(await css()).toContain('--color-primary-hover: #47a6ff;');
    expect(await css()).toContain('--color-primary: #3399ff;');
    // Picking another preset: the page knows its values, and the old shades don't carry over.
    const page = await get(app, '/settings/appearance');
    expect(page.text).toContain('action="/settings/appearance/presets/warm/apply"');
    await form(app, '/settings/appearance/brand', { version: await version(), preset: 'warm' });
    expect(await css()).not.toContain('#47a6ff');
    expect(await css()).toContain('--color-bg: #1c1917;');
  });

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
    expect(res.headers.location).toMatch(/flash=Saved\./);
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

    // Saved brands: keep the current look under a name, switch, delete.
    const themeCss = async () => (await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`)).text;
    res = await form(app, '/settings/appearance/brands/save', { name: 'Acme' });
    expect(decodeURIComponent(res.headers.location.replace(/\+/g, ' '))).toContain('Saved "Acme"');
    page = await get(app, '/settings/appearance');
    let v = /name="version" value="([^"]*)"/.exec(page.text)![1];
    await form(app, '/settings/appearance/brand', { version: v, reset: '1' });
    expect(await themeCss()).not.toContain('--color-primary');
    page = await get(app, '/settings/appearance');
    expect(page.text).toContain('aria-label="Use Acme"');
    expect(page.text).toContain('action="/settings/appearance/brands/acme/apply"');
    v = /name="version" value="([^"]*)"/.exec(page.text)![1];
    res = await form(app, '/settings/appearance/brands/acme/apply', { version: v });
    expect(decodeURIComponent(res.headers.location.replace(/\+/g, ' '))).toContain('Now using "Acme" everywhere');
    expect(await themeCss()).toContain('--color-primary: #ff0066;');
    expect((await get(app, '/settings/appearance')).text).toContain('aria-label="Acme, in use"');
    expect((await form(app, '/settings/appearance/brands/save', { name: '   ' })).headers.location).toMatch(/error=/);
    await form(app, '/settings/appearance/brands/acme/delete', {});
    expect((await get(app, '/settings/appearance')).text).toContain('Presets (your saved brands show here too)');
    expect(await themeCss()).toContain('--color-primary: #ff0066;'); // deleting doesn't change the look in use
  });
});

describe('update my brand (sua proposes one)', () => {
  const form = (app: Parameters<typeof request>[0], p: string, body: Record<string, string>) =>
    request(app).post(p).type('form').send(body).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  const proposal = (extra = '') => `<brand>{"name": "Harbor", "preset": "default",
    "dark": {"bg": "#0f1726", "surface": "#16213a", "text": "#e8edf6", "text-muted": "#9aa8c2", "primary": "#ff7a66"},
    "light": {"bg": "#f6f7fb", "surface": "#ffffff", "text": "#14213d", "text-muted": "#5b6782", "primary": "#e0533d"},
    "fonts": {"sans": "\\"Söhne\\", \\"Bad;Font\\", system-ui, sans-serif"}, "radius": {"md": 14}${extra},
    "why": "navy and coral"}</brand>`;
  const waitReady = async (app: Parameters<typeof request>[0]) => {
    for (let i = 0; i < 50; i++) {
      const s = (await get(app, '/settings/appearance/brand/proposal')).body.status;
      if (s !== 'working') return s as string;
      await new Promise((r) => setTimeout(r, 20));
    }
    return 'working';
  };

  it('proposes from a few words, previews, checks it, and changes nothing until used', async () => {
    const app = await setup();
    let seen: Record<string, string> = {};
    ctx.brandMakerRun = async (inputs) => { seen = inputs; return proposal(); };
    let page = await get(app, '/settings/appearance');
    expect(page.text).toContain('Make one with sua');
    expect((await form(app, '/settings/appearance/brand/propose', { source: '  ' })).headers.location).toMatch(/error=/);
    const res = await form(app, '/settings/appearance/brand/propose', { source: 'calm navy and coral' });
    expect(res.status).toBe(303);
    expect(await waitReady(app)).toBe('ready');
    expect(seen.SOURCE).toBe('calm navy and coral');
    expect(JSON.parse(seen.CURRENT)).toMatchObject({ version: 1 });
    const themeCss = async () => (await request(app).get('/assets/theme.css').set('Host', `127.0.0.1:${PORT}`)).text;
    expect(await themeCss()).not.toContain('#e0533d'); // nothing applied yet
    page = await get(app, '/settings/appearance');
    expect(page.text).toContain('Harbor');
    expect(page.text).toContain('Use this brand');
    expect(page.text).toContain('readable in both modes');
    const version = /name="version" value="([^"]*)"/.exec(page.text)![1];
    await form(app, '/settings/appearance/brand/proposal/use', { version });
    const css = await themeCss();
    expect(css).toContain('--color-primary: #e0533d;');
    expect(css).toContain('--font-sans: "Söhne", system-ui, sans-serif;'); // the bad family is dropped, not the brand
    const after = (await get(app, '/settings/appearance')).text;
    expect(after).not.toContain('Use this brand');
    // Used, it's kept under Your brands as the one in use, and the page names it.
    expect(after).toContain('aria-label="Harbor, in use"');
    expect(after).toMatch(/id="look-now-title">Harbor</);
  });

  it('flags hard-to-read colours, reports a broken proposal, and discards', async () => {
    const app = await setup();
    ctx.brandMakerRun = async () => proposal().replace('"text": "#14213d"', '"text": "#eeeeee"');
    await form(app, '/settings/appearance/brand/propose', { source: 'pale' });
    expect(await waitReady(app)).toBe('ready');
    expect((await get(app, '/settings/appearance')).text).toMatch(/Light mode: text on the page is hard to read/);
    await form(app, '/settings/appearance/brand/proposal/discard', {});
    expect((await get(app, '/settings/appearance/brand/proposal')).body.status).toBe('none');

    ctx.brandMakerRun = async () => proposal().replace('"#e0533d"', '"red; } body {"');
    await form(app, '/settings/appearance/brand/propose', { source: 'broken' });
    expect(await waitReady(app)).toBe('failed');
    expect((await get(app, '/settings/appearance')).text).toContain("didn&#39;t check out");
    expect((await form(app, '/settings/appearance/brand/proposal/use', { version: '' })).headers.location).toMatch(/error=/);
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
    // What was asked for is the board's goal, shown on its page.
    expect(new BoardsStore(ctx.runStore.databaseHandle()).goal(boardId)).toMatchObject({ text: 'a morning board with weather and news', by: 'request' });

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

describe('archiving a board', () => {
  it('Archive hides it from the dashboards menu (under Archived instead); its page offers Restore; Restore brings it back', async () => {
    const app = await setup();
    const before = await get(app, '/dashboards/user:morning');
    expect(before.text).toContain('action="/dashboards/user%3Amorning/archive"');
    expect(before.text).toContain('href="/pulse"');

    const archived = await post(app, '/dashboards/user:morning/archive', {});
    expect(archived.status).toBe(303);
    expect(decodeURIComponent(archived.headers.location)).toContain('Archived "Morning"');

    ctx.dashboardsStore!.upsertDashboard({ id: 'user:evening', packId: null, name: 'Evening', layout: { sections: [] } } as never);
    const pulse = await get(app, '/pulse');
    expect(pulse.text).toContain('Archived (1)');
    const fold = pulse.text.slice(pulse.text.indexOf('dashboards-dropdown__archived'));
    expect(fold).toContain('href="/dashboards/user%3Amorning"');
    expect(pulse.text.slice(0, pulse.text.indexOf('dashboards-dropdown__archived'))).not.toContain('href="/dashboards/user%3Amorning"');

    const page = await get(app, '/dashboards/user:morning');
    expect(page.status).toBe(200);
    expect(page.text).toContain('This board is archived');
    expect(page.text).toContain('action="/dashboards/user%3Amorning/restore"');
    expect(page.text).not.toContain('action="/dashboards/user%3Amorning/archive"');

    const restored = await post(app, '/dashboards/user:morning/restore', {});
    expect(restored.headers.location).toMatch(/^\/dashboards\/user%3Amorning\?ok=/);
    expect(ctx.dashboardsStore!.listArchived()).toEqual([]);
    expect((await get(app, '/dashboards/user:morning')).text).not.toContain('This board is archived');
  });
});

describe('archiving an agent', () => {
  it('leaves the default agents list, the tile picker and sua\'s catalog; its tile is marked; Restore brings it back (paused when scheduled)', async () => {
    const app = await setup();
    ctx.agentStore.updateAgentMeta('weather', { status: 'archived' });

    const list = await get(app, '/agents');
    expect(list.text).not.toContain('href="/agents/weather"');
    expect(list.text).toMatch(/Archived \(1\)/);
    expect((await get(app, '/agents?status=archived')).text).toContain('/agents/weather');

    const data = editorData((await get(app, '/dashboards/user:morning')).text);
    expect((data.agents as Array<{ id: string }>).map((a) => a.id)).not.toContain('weather');
    const tiles = registry((await get(app, '/dashboards/user:morning')).text) as Record<string, { archived?: boolean; run: string }>;
    expect(tiles.weather).toMatchObject({ archived: true, run: 'none' });
    expect(tiles.news.archived).toBeUndefined();

    const { buildTriageCatalogJson, buildAgentCatalogJson } = await import('./inbox-catalog.js');
    expect(buildTriageCatalogJson(ctx)).not.toContain('"weather"');
    expect(buildAgentCatalogJson(ctx)).not.toContain('"weather"');

    // It can't be run by hand while archived (tile Run, Run now).
    const tileRun = await post(app, '/agents/weather/widget-run', {});
    expect(tileRun.status).toBe(409);
    expect(tileRun.body.error).toContain('archived');
    const runNow = await post(app, '/agents/weather/run', {});
    expect(decodeURIComponent(runNow.headers.location)).toContain('Restore it to run it');

    const page = await get(app, '/agents/weather');
    expect(page.text).toContain('This agent is archived');
    expect(page.text).toContain('action="/agents/weather/restore"');
    const back = await post(app, '/agents/weather/restore', {});
    expect(decodeURIComponent(back.headers.location)).toContain('Restored.');
    expect(ctx.agentStore.getAgent('weather')!.status).toBe('active');

    ctx.agentStore.updateAgentMeta('news', { status: 'archived', schedule: '0 7 * * *' });
    const paused = await post(app, '/agents/news/restore', {});
    expect(decodeURIComponent(paused.headers.location)).toContain('paused so its schedule');
    expect(ctx.agentStore.getAgent('news')!.status).toBe('paused');
  });
});

describe('a composed board page (ADR-0070)', () => {
  const ran = (agentName: string, result: string) => {
    const id = `run-${agentName}`;
    const at = new Date().toISOString();
    ctx.runStore.createRun({ id, agentName, status: 'completed', startedAt: at, completedAt: at, result, triggeredBy: 'cli' } as never);
    ctx.runStore.createNodeExecution({ runId: id, nodeId: 'n', workflowVersion: 1, status: 'completed', startedAt: at, completedAt: at, result, outputsJson: JSON.stringify({ result }) } as never);
  };
  const page = [
    { id: 'root', component: 'Column', children: ['masthead', 'lede', 'top'] },
    { id: 'masthead', component: 'Panel', title: { path: '/board/name' }, note: { path: '/board/date' }, child: 'm_t', treatment: 'feature', hero: true },
    { id: 'm_t', component: 'Text', text: { path: '/board/updated' }, variant: 'caption' },
    { id: 'lede', component: 'Panel', title: 'news', child: 'lede_c', treatment: 'lede', when: 'news' },
    { id: 'lede_c', component: 'Callout', text: { path: '/board/agents/news/outputs/headline' } },
    { id: 'top', component: 'Columns', children: ['story', 'rail'], widths: [2, 1] },
    { id: 'story', component: 'Column', children: ['f_weather'] },
    { id: 'f_weather', component: 'Panel', title: 'weather', child: 'f_weather_t', treatment: 'feature', when: 'weather' },
    { id: 'f_weather_t', component: 'AgentTile', agentId: 'weather', chrome: 'bare' },
    { id: 'rail', component: 'Column', children: ['a_notes'] },
    { id: 'a_notes', component: 'Panel', title: 'notes', child: 'a_notes_l', treatment: 'aside', when: 'numbers:notes' },
    { id: 'a_notes_l', component: 'Lead', stat: { path: '/board/agents/notes/stats/count' } },
  ];

  it('draws only the parts whose agents have run, carries the board data, and refetches as data.json', async () => {
    const app = await setup();
    ran('news', JSON.stringify({ headline: 'Voters rebuke', summary: 'Both chambers.' }));
    ran('notes', JSON.stringify({ count: 10 }));
    const saved = new BoardsStore(ctx.runStore.databaseHandle()).saveDoc({ id: 'user:morning', name: 'Morning', expectedVersion: 0, doc: { components: page }, meta: { preset: 'front-page', layoutBy: 'picked' } });
    expect(saved.layoutMeta).toEqual({ preset: 'front-page', layoutBy: 'picked' });
    const res = await get(app, '/dashboards/user:morning');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-board-composed="1"');
    const comps = surface(res.text);
    const ids = comps.map((c) => c.id);
    expect(ids).toContain('masthead');
    expect(ids).toContain('lede');
    expect(ids).toContain('a_notes');
    expect(ids).not.toContain('f_weather'); // weather never ran
    expect(comps.find((c) => c.id === 'top')).toMatchObject({ widths: [1] }); // the story went; the rail takes the row
    expect(comps.every((c) => c.when === undefined)).toBe(true);
    const messages = embedded(res.text, /data-board-canvas="[^"]*"[^>]*><script type="application\/json">([\s\S]*?)<\/script>/) as Array<Record<string, { value?: { board?: Record<string, unknown> } }>>;
    const model = messages.find((m) => m.updateDataModel)!.updateDataModel.value!.board!;
    expect(model.name).toBe('Morning');
    expect((model.agents as Record<string, { outputs: Record<string, unknown>; stats: Record<string, unknown> }>).news.outputs).toMatchObject({ headline: 'Voters rebuke' });
    expect((model.agents as Record<string, { stats: Record<string, { value: string }> }>).notes.stats.count.value).toBe('10');
    expect(editorData(res.text).layoutMeta).toEqual({ preset: 'front-page', layoutBy: 'picked' });
    // The same canvas again, for the page to take new data in place.
    const data = await get(app, '/boards/user:morning/data.json');
    expect(data.status).toBe(200);
    expect(data.body.messages.some((m: Record<string, unknown>) => m.updateDataModel)).toBe(true);
    expect(Object.keys(data.body.tiles)).toEqual([]); // no tile is drawn until weather runs
    // Arranging keeps the page's parts: a Panel moves like any node.
    const apply = await post(app, '/boards/user:morning/doc/apply', { ops: [{ op: 'move', id: 'a_notes', parent: 'story' }] });
    expect(apply.status).toBe(200);
    expect(apply.body.doc.components.find((c: Record<string, unknown>) => c.id === 'story').children).toEqual(['f_weather', 'a_notes']);
    expect(apply.body.doc.components.find((c: Record<string, unknown>) => c.id === 'lede').when).toBe('news');
  });

  it('leaves a grid of tiles exactly as it was, with the data model beside it', async () => {
    const app = await setup();
    const res = await get(app, '/dashboards/user:morning');
    expect(res.text).not.toContain('data-board-composed');
    const comps = surface(res.text);
    expect(comps.filter((c) => c.component === 'AgentTile').map((c) => c.agentId)).toEqual(['news', 'weather', 'ghost']);
    const messages = embedded(res.text, /data-board-canvas="[^"]*"[^>]*><script type="application\/json">([\s\S]*?)<\/script>/) as Array<Record<string, unknown>>;
    expect(messages.map((m) => Object.keys(m).find((k) => k !== 'version'))).toEqual(['createSurface', 'updateComponents', 'updateDataModel']);
  });
});

describe('how a board looks (ADR-0070)', () => {
  it('Front page by hand, let sua pick, and back to the grid, each a new version with its meta', async () => {
    const app = await setup();
    ctx.boardPageRun = async () => '<page>{"about":"news first","components":[{"id":"root","component":"Column","children":["p","g"]},{"id":"p","component":"Panel","title":"News","child":"c","treatment":"lede","when":"news"},{"id":"c","component":"Callout","text":{"path":"/board/agents/news/outputs/headline"}},{"id":"g","component":"Grid","children":["t"]},{"id":"t","component":"AgentTile","agentId":"weather"}]}</page>';
    let page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('How it looks');
    expect(page.text).toContain('value="front-page"');
    let res = await post(app, '/boards/user:morning/look', { look: 'front-page' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('ok=');
    const boards = new BoardsStore(ctx.runStore.databaseHandle());
    expect(boards.get('user:morning')!.layoutMeta).toEqual({ preset: 'front-page', layoutBy: 'picked' });
    page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('data-board-composed="1"');
    expect(page.text).toContain('· front page');
    res = await post(app, '/boards/user:morning/look', { look: 'pick' });
    expect(res.headers.location).toContain('ok=');
    expect(boards.get('user:morning')!.layoutMeta).toEqual({ about: 'news first', layoutBy: 'picked' });
    page = await get(app, '/dashboards/user:morning');
    expect(page.text).toContain('Made for this board');
    expect(page.text).toContain('News first.');
    res = await post(app, '/boards/user:morning/look', { look: 'grid' });
    expect(res.headers.location).toContain('ok=');
    expect(boards.get('user:morning')!.layoutMeta).toBeUndefined();
    expect(surface((await get(app, '/dashboards/user:morning')).text).filter((c) => c.component === 'AgentTile').map((c) => c.agentId)).toEqual(['news', 'weather']);
    res = await post(app, '/boards/user:morning/look', { look: 'poster' });
    expect(res.headers.location).toContain('error=');
    expect((await post(app, '/boards/pulse/look', { look: 'front-page' })).headers.location).toContain('error=');
  });
});
