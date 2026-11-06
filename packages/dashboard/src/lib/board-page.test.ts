/**
 * A board decides its page (ADR-0070): the agent's answer read (a preset
 * filled for the board, a page that checks out, or why not), one more try
 * when it reads like a grid, saved with who composed it; "How it looks" by
 * hand; a board that changed meanwhile is left alone.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, BoardsStore, DashboardsStore, RunStore, frontPageDoc, gridDoc, isComposedBoardDoc, type BoardAgentShape } from '@some-useful-agents/core';
import { parseBoardPageAnswer, drawBoardPage, decideBoardPage, setBoardLook, boardPageInputs, boardPageIsItsOwn } from './board-page.js';
import type { DashboardContext } from '../context.js';

const SHAPES: BoardAgentShape[] = [
  { id: 'news', title: 'News', kind: 'widget', ran: true, outputs: [{ name: 'headline', type: 'string', length: 40 }, { name: 'summary', type: 'string', length: 90 }, { name: 'items', type: 'list', length: 5 }] },
  { id: 'weather', title: 'Weather', kind: 'widget', ran: true, outputs: [{ name: 'temp_f', type: 'number' }, { name: 'condition', type: 'string', length: 10 }] },
  { id: 'notes', title: 'Notes', kind: 'text-headline', ran: false, outputs: [] },
];
const page = (v: unknown) => `<page>${JSON.stringify(v)}</page>`;

describe('reading the page agent\'s answer', () => {
  it('fills a preset for the board, keeps a page that checks out, and says why one doesn\'t', () => {
    expect(parseBoardPageAnswer(page({ preset: 'front-page', about: 'news leads' }), SHAPES)).toMatchObject({ preset: 'front-page', about: 'news leads', components: frontPageDoc(SHAPES) });
    expect(parseBoardPageAnswer(page({ preset: 'grid' }), SHAPES)).toMatchObject({ preset: 'grid', components: gridDoc(SHAPES) });
    const drawn = parseBoardPageAnswer(page({ about: 'weather first', components: [
      { id: 'root', component: 'Column', children: ['w'] },
      { id: 'w', component: 'Panel', title: 'Weather', child: 'w_l', treatment: 'lede', when: 'weather' },
      { id: 'w_l', component: 'Lead', stat: { path: '/board/agents/weather/stats/temp_f' } },
    ] }), SHAPES);
    expect('components' in drawn && !('preset' in drawn)).toBe(true);
    expect(parseBoardPageAnswer(page({ components: [{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Text', text: 'hi', when: 'someone' }] }), SHAPES)).toMatchObject({ error: expect.stringContaining('"when" must be an agent of this board') });
    expect(parseBoardPageAnswer(page({ preset: 'poster' }), SHAPES)).toMatchObject({ error: expect.stringContaining('no ready-made page "poster"') });
    expect(parseBoardPageAnswer('no block', SHAPES)).toMatchObject({ error: 'There was no <page> block.' });
  });

  it('gives the agent the board, the presets with the front page filled in, and the guide with its fields', () => {
    const inputs = boardPageInputs({ name: 'Morning' }, SHAPES, 'a morning read');
    expect(JSON.parse(inputs.BOARD)).toMatchObject({ name: 'Morning', for: 'a morning read', agents: [{ id: 'news' }, { id: 'weather' }, { id: 'notes' }] });
    expect(inputs.PRESETS).toContain('front-page:');
    expect(inputs.PRESETS).toContain('"id":"masthead"');
    expect(inputs.GUIDE).toContain('news ("News", widget): headline (string 40)');
  });

  it('tries once more when the first page reads like a grid, and keeps the first when the second fails', async () => {
    const grid = { components: [
      { id: 'root', component: 'Column', children: ['a', 'b', 'c', 'd'] },
      ...['a', 'b', 'c', 'd'].flatMap((id) => [{ id, component: 'Panel', title: id, child: `${id}_t`, when: 'news' }, { id: `${id}_t`, component: 'Text', text: { path: '/board/agents/news/outputs/headline' } }]),
    ] };
    const asked: string[] = [];
    const out = await drawBoardPage({ name: 'M' }, SHAPES, async (inputs) => { asked.push(inputs.ERRORS); return asked.length === 1 ? page(grid) : page({ preset: 'front-page' }); });
    expect(out.tries).toBe(2);
    expect(out.firstNotes).toContain('reads like a grid');
    expect(out.answer).toMatchObject({ preset: 'front-page' });
    const kept = await drawBoardPage({ name: 'M' }, SHAPES, async (inputs) => (inputs.ERRORS ? 'nothing' : page(grid)));
    expect(kept.tries).toBe(2);
    expect('components' in kept.answer).toBe(true);
  });
});

describe('a board deciding its page', () => {
  let dir: string | undefined;
  let ctx: DashboardContext;
  afterEach(() => { try { ctx?.runStore.close(); ctx?.agentStore.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  function setup(answer: (inputs: Record<string, string>) => string | undefined): BoardsStore {
    dir = mkdtempSync(join(tmpdir(), 'sua-board-page-'));
    const dbPath = join(dir, 'runs.db');
    ctx = { runStore: new RunStore(dbPath), agentStore: new AgentStore(dbPath), dashboardsStore: new DashboardsStore(dbPath), activeRuns: new Map(), boardPageRun: async (inputs: Record<string, string>) => answer(inputs) } as unknown as DashboardContext;
    const add = (id: string) => ctx.agentStore.createAgent({ id, name: id, status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }], signal: { title: id, template: 'text-headline', mapping: { headline: 'result' } } } as never, 'cli');
    add('news'); add('weather');
    const at = new Date().toISOString();
    ctx.runStore.createRun({ id: 'r-news', agentName: 'news', status: 'completed', startedAt: at, completedAt: at, result: JSON.stringify({ headline: 'Voters rebuke', summary: 'Both chambers.' }), triggeredBy: 'cli' } as never);
    ctx.runStore.createNodeExecution({ runId: 'r-news', nodeId: 'n', workflowVersion: 1, status: 'completed', startedAt: at, completedAt: at, result: '{}', outputsJson: JSON.stringify({ result: JSON.stringify({ headline: 'Voters rebuke', summary: 'Both chambers.' }) }) } as never);
    const boards = new BoardsStore(dbPath);
    boards.saveDoc({ id: 'user:m', name: 'Morning', doc: { components: [
      { id: 'root', component: 'Column', children: ['g'] }, { id: 'g', component: 'Grid', children: ['t1', 't2'] },
      { id: 't1', component: 'AgentTile', agentId: 'news' }, { id: 't2', component: 'AgentTile', agentId: 'weather' },
    ] } });
    return boards;
  }

  it('composes the page sua drew, as the board\'s own, and leaves a composed page alone unless asked again', async () => {
    const seen: Record<string, string>[] = [];
    const boards = setup((inputs) => { seen.push(inputs); return page({ preset: 'front-page', about: 'news leads' }); });
    expect(await decideBoardPage(ctx, 'user:m', { about: 'a morning read' })).toBe('drawn');
    const b = boards.get('user:m')!;
    expect(isComposedBoardDoc(b.doc!.components)).toBe(true);
    expect(b.layoutMeta).toEqual({ preset: 'front-page', about: 'news leads', layoutBy: 'board' });
    expect(boardPageIsItsOwn(b)).toBe(true);
    expect(JSON.parse(seen[0].BOARD)).toMatchObject({ for: 'a morning read', agents: [{ id: 'news', ran: true, outputs: [{ name: 'headline', type: 'string' }, { name: 'summary', type: 'string' }] }, { id: 'weather', ran: false }] });
    expect(await decideBoardPage(ctx, 'user:m')).toBe('skipped');
    expect(await decideBoardPage(ctx, 'user:m', { again: true, keep: true })).toBe('drawn');
    expect(boards.get('user:m')!.layoutMeta!.layoutBy).toBe('picked');
    expect(boardPageIsItsOwn(boards.get('user:m')!)).toBe(false);
  });

  it('keeps the grid when sua would, saves a page asked for in words as yours, and steps back when the board changed meanwhile', async () => {
    let reply = page({ preset: 'grid', about: 'tools' });
    const boards = setup(() => reply);
    expect(await decideBoardPage(ctx, 'user:m')).toBe('kept');
    expect(boards.get('user:m')!.version).toBe(1);
    reply = page({ about: 'weather first', components: [
      { id: 'root', component: 'Column', children: ['w', 'g'] },
      { id: 'w', component: 'Panel', title: 'News', child: 'w_c', treatment: 'lede', when: 'news' },
      { id: 'w_c', component: 'Callout', text: { path: '/board/agents/news/outputs/headline' } },
      { id: 'g', component: 'Grid', children: ['t2'] }, { id: 't2', component: 'AgentTile', agentId: 'weather' },
    ] });
    expect(await decideBoardPage(ctx, 'user:m', { request: 'lead with the news' })).toBe('drawn');
    expect(boards.get('user:m')!.layoutMeta).toEqual({ about: 'weather first', layoutBy: 'you' });
    // Changed by hand while sua was drawing: that stands.
    const slow = setup(() => { boards2.saveDoc({ id: 'user:m', name: 'Morning', doc: { components: gridDoc([{ id: 'news' }]) }, expectedVersion: 1 }); return page({ preset: 'front-page' }); });
    const boards2 = slow;
    expect(await decideBoardPage(ctx, 'user:m')).toBe('skipped');
    expect(boards2.get('user:m')!.layoutMeta).toBeUndefined();
  });

  it('"How it looks": the front page by hand, back to the grid, and let sua pick', async () => {
    const boards = setup(() => page({ about: 'drawn', components: [{ id: 'root', component: 'Column', children: ['p', 'g'] }, { id: 'p', component: 'Panel', title: 'News', child: 'c', treatment: 'lede', when: 'news' }, { id: 'c', component: 'Callout', text: { path: '/board/agents/news/outputs/headline' } }, { id: 'g', component: 'Grid', children: ['t'] }, { id: 't', component: 'AgentTile', agentId: 'weather' }] }));
    expect((await setBoardLook(ctx, 'user:m', 'front-page')).ok).toBe(true);
    expect(boards.get('user:m')!.layoutMeta).toEqual({ preset: 'front-page', layoutBy: 'picked' });
    expect(boards.get('user:m')!.doc!.components.find((c) => c.id === 'masthead')).toBeTruthy();
    expect((await setBoardLook(ctx, 'user:m', 'pick')).ok).toBe(true);
    expect(boards.get('user:m')!.layoutMeta).toEqual({ about: 'drawn', layoutBy: 'picked' });
    expect((await setBoardLook(ctx, 'user:m', 'grid')).ok).toBe(true);
    expect(boards.get('user:m')!.layoutMeta).toBeUndefined();
    expect(isComposedBoardDoc(boards.get('user:m')!.doc!.components)).toBe(false);
    expect(boards.get('user:m')!.doc!.components.filter((c) => c.component === 'AgentTile').map((c) => c.agentId).sort()).toEqual(['news', 'weather']);
    expect((await setBoardLook(ctx, 'user:m', 'poster')).ok).toBe(false);
    expect((await setBoardLook(ctx, 'nope', 'grid')).ok).toBe(false);
  });
});
