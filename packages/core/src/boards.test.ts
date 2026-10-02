import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardConflictError, BoardsStore, sectionsFromBoardItems, boardDocFromItems, validateBoardDoc, boardDocAgentIds, sectionsFromBoardDoc, boardItemsFromLayoutPlan, boardItemsFromSections, normalizeBoardItems, type BoardItem } from './boards.js';
import { getBuiltinTool } from './builtin-tools.js';
import { validateViewComponents } from './a2ui/view.js';
import type { DashboardSection } from './packs-store.js';
import { DatabaseSync } from 'node:sqlite';

const agent = (id: string, x: number, y: number, w = 3, h = 5): BoardItem => ({ id, kind: 'agent', agentId: id, x, y, w, h });

describe('normalizeBoardItems (vertical compaction)', () => {
  it('floats items up into gaps and never overlaps', () => {
    const out = normalizeBoardItems([agent('a', 0, 10), agent('b', 3, 40), agent('c', 0, 12)]);
    expect(out.map((i) => [i.id, i.x, i.y])).toEqual([['a', 0, 0], ['b', 3, 0], ['c', 0, 5]]);
  });

  it('pushes an overlapping item below the one above it, then floats', () => {
    const out = normalizeBoardItems([agent('a', 0, 0, 6, 5), agent('b', 3, 2, 6, 3)]);
    expect(out.find((i) => i.id === 'b')).toMatchObject({ x: 3, y: 5 });
  });

  it('clamps to 12 columns and rejects bad items', () => {
    expect(normalizeBoardItems([agent('wide', 10, 0, 6, 2)])[0]).toMatchObject({ x: 6, w: 6 });
    expect(() => normalizeBoardItems([agent('a', 0, 0), agent('a', 3, 0)])).toThrow(/Duplicate/);
    expect(() => normalizeBoardItems([{ id: 'x', kind: 'script', x: 0, y: 0, w: 1, h: 1 }])).toThrow();
    expect(() => normalizeBoardItems([{ ...agent('a', 0, 0), onclick: 'x' }])).toThrow();
  });
});

describe('boardItemsFromSections', () => {
  it('turns each section into a heading plus its tiles, wrapping at 12 columns, honouring sizes', () => {
    const items = boardItemsFromSections([
      { title: 'News', agentIds: ['hn', 'rss', 'weather', 'stocks', 'extra'] },
      { title: 'Notes', agentIds: ['notes'], placements: { notes: { size: '2x2' } } },
      { title: 'Empty', agentIds: [] },
    ], (id) => (id === 'weather' ? '2x1' : undefined));
    const brief = items.map((i) => `${i.kind === 'heading' ? `#${i.text}` : (i as { agentId: string }).agentId}@${i.x},${i.y} ${i.w}x${i.h}`);
    expect(brief).toEqual([
      '#News@0,0 12x1',
      'hn@0,1 3x5', 'rss@3,1 3x5', 'weather@6,1 6x5',
      'stocks@0,6 3x5', 'extra@3,6 3x5',
      '#Notes@0,11 12x1',
      'notes@0,12 6x10',
    ]);
  });
});

describe('BoardsStore', () => {
  const store = () => new BoardsStore(join(mkdtempSync(join(tmpdir(), 'sua-boards-')), 'runs.db'));

  it('saves normalised items with a version, refuses a stale save, and undoes one step', () => {
    const s = store();
    expect(s.get('pulse')).toBeUndefined();
    const v1 = s.save({ id: 'pulse', name: 'Pulse', items: [agent('a', 0, 9)], expectedVersion: 0 });
    expect(v1).toMatchObject({ version: 1, items: [{ id: 'a', y: 0 }] });
    expect(() => s.save({ id: 'pulse', name: 'Pulse', items: [], expectedVersion: 0 })).toThrow(BoardConflictError);
    const v2 = s.save({ id: 'pulse', name: 'Pulse', items: [agent('a', 0, 0), agent('b', 3, 0)], expectedVersion: 1 });
    expect(v2.items).toHaveLength(2);
    const undone = s.undo('pulse', 2);
    expect(undone).toMatchObject({ version: 3, items: [{ id: 'a' }] });
    expect(s.undo('pulse').items).toHaveLength(2); // undo again = redo
    expect(s.list().map((b) => b.id)).toEqual(['pulse']);
    s.close();
  });
});

describe('boardItemsFromLayoutPlan', () => {
  it('turns containers into headings + tiles sized by the plan, and system tiles into system items', () => {
    const items = boardItemsFromLayoutPlan({
      containers: [{ label: 'Morning', tiles: ['news', '_system-runs-today'] }],
      topAgents: [{ id: 'news', suggestedSize: '2x2' }],
    });
    expect(items.map((i) => `${i.kind}:${i.w}x${i.h}`)).toEqual(['heading:12x1', 'agent:6x10', 'system:3x5']);
    expect(items[2]).toMatchObject({ kind: 'system', tileId: '_system-runs-today' });
  });
});

describe('board-read / board-place tools', () => {
  function setup() {
    const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'sua-board-tools-')), 'runs.db'));
    db.exec("CREATE TABLE agents (id TEXT PRIMARY KEY); INSERT INTO agents VALUES ('news'), ('weather');");
    db.exec("CREATE TABLE dashboards (id TEXT PRIMARY KEY, pack_id TEXT, name TEXT, layout_json TEXT, created_at INTEGER, updated_at INTEGER);");
    db.prepare('INSERT INTO dashboards VALUES (?, NULL, ?, ?, 0, 0)').run('user:am', 'AM', JSON.stringify({ sections: [{ title: 'Top', agentIds: ['news'] }] }));
    return new BoardsStore(db);
  }
  const read = getBuiltinTool('board-read')!;
  const place = getBuiltinTool('board-place')!;

  it('lists boards, reads a board as an outline, arranges it with tree ops, and refuses stale or bad ops', async () => {
    const boards = setup();
    const list = await read.execute({}, { boards });
    expect(list.result).toContain('pulse — Pulse');
    expect(list.result).toContain('user:am — AM');
    const am = await read.execute({ board: 'user:am' }, { boards });
    expect(am.result).toMatch(/^Board "AM" \(user:am\), version 0, 1 tile:/);
    expect(am.result).toContain('[section_1] section "Top"');
    expect(am.result).toContain('[grid_1] grid');
    expect(am.result).toMatch(/\[tile_s0t0\] tile news/);

    const placed = await place.execute({ board: 'user:am', version: 0, ops: JSON.stringify([
      { op: 'insert', parent: 'grid_1', node: { type: 'tile', agentId: 'weather' } },
      { op: 'wrap', id: 'section_1', in: 'tabs', title: 'Today' },
      { op: 'insert', parent: 'root', index: 0, node: { type: 'heading', text: 'Morning' } },
    ]) }, { boards });
    expect(placed.isError).toBeFalsy();
    expect(placed.result).toMatch(/^Saved\. Board "AM" \(user:am\), version 1, 2 tiles:/);
    expect(placed.result).toContain('tab "Today":');
    expect(boards.get('user:am')!.doc!.components.some((c) => c.component === 'Tabs')).toBe(true);

    const stale = await place.execute({ board: 'user:am', version: 0, ops: [{ op: 'remove', id: 'tile_s0t0' }] }, { boards });
    expect(stale).toMatchObject({ isError: true });
    expect(stale.result).toMatch(/now at version 1/);
    const ghost = await place.execute({ board: 'user:am', ops: [{ op: 'insert', parent: 'grid_1', node: { type: 'tile', agentId: 'ghost' } }] }, { boards });
    expect(ghost.result).toMatch(/no installed agent "ghost"/);
    const bad = await place.execute({ board: 'user:am', ops: [{ op: 'remove', id: 'root' }] }, { boards });
    expect(bad).toMatchObject({ isError: true, result: expect.stringMatching(/root/) });
    expect(boards.get('user:am')!.version).toBe(1);
    expect((await place.execute({ board: 'nope', ops: [] }, { boards })).result).toMatch(/no board "nope"/);
    expect((await read.execute({ board: 'pulse' }, {})).result).toMatch(/not available/);
  });

  it('accepts ops sent as JSON strings one by one, or under the old name "changes"', async () => {
    const boards = setup();
    const out = await place.execute({ board: 'pulse', changes: [JSON.stringify({ op: 'insert', parent: 'root', node: { type: 'section', title: 'Top' } })] }, { boards });
    expect(out.isError).toBeFalsy();
    expect(boards.get('pulse')!.doc!.components.some((c) => c.component === 'Section' && c.title === 'Top')).toBe(true);
  });
});

describe('sectionsFromBoardItems', () => {
  it('round-trips sections through a board, keeping titles, order and sizes', () => {
    const sections: DashboardSection[] = [
      { title: 'News', agentIds: ['hn', 'weather'], placements: { weather: { size: '2x1' as const } } },
      { title: 'Notes', agentIds: ['notes'], placements: { notes: { size: '2x2' as const } } },
    ];
    const back = sectionsFromBoardItems(boardItemsFromSections(sections));
    expect(back.map((s) => [s.title, s.agentIds])).toEqual([['News', ['hn', 'weather']], ['Notes', ['notes']]]);
    expect(back[0].placements).toMatchObject({ hn: { size: '1x1' }, weather: { size: '2x1' } });
    expect(back[1].placements).toMatchObject({ notes: { size: '2x2' } });
    expect(sectionsFromBoardItems([agent('a', 0, 0)])).toEqual([{ title: 'Tiles', agentIds: ['a'], placements: { a: { size: '1x1' } } }]);
  });

  it('accepts a palette on agent and system tiles only', () => {
    expect(normalizeBoardItems([{ ...agent('a', 0, 0), palette: 'dark' }])[0]).toMatchObject({ palette: 'dark' });
    expect(() => normalizeBoardItems([{ ...agent('a', 0, 0), palette: 'neon' }])).toThrow();
    expect(() => normalizeBoardItems([{ id: 'h', kind: 'heading', text: 'x', x: 0, y: 0, w: 12, h: 1, palette: 'dark' }])).toThrow();
  });
});

describe('canvas board documents', () => {
  it('converts grid items to a valid document: headings become Sections, tiles Grid cells with spans', () => {
    const items = boardItemsFromSections([
      { title: 'Today', agentIds: ['weather', 'news'], placements: { weather: { size: '2x2' } } },
      { title: 'Later', agentIds: ['notes'] },
    ]);
    items.push({ id: 'n1', kind: 'note', text: '**Hi**', x: 0, y: 99, w: 4, h: 3 });
    const doc = boardDocFromItems(items);
    const v = validateBoardDoc(doc);
    expect(v.ok).toBe(true);
    const by = (id: string) => doc.components.find((c) => c.id === id)!;
    const root = by('root');
    expect(root).toMatchObject({ component: 'Column' });
    const sections = (root.children as string[]).map(by);
    expect(sections.map((s) => s.title)).toEqual(['Today', 'Later']);
    const todayCells = (by(sections[0].child as string).children as string[]).map(by);
    expect(todayCells[0]).toMatchObject({ component: 'Cell', span: 2, rows: 2 });
    expect(by(todayCells[0].child as string)).toMatchObject({ component: 'AgentTile', agentId: 'weather' });
    expect(boardDocAgentIds(doc)).toEqual(['weather', 'news', 'notes']);
    expect(doc.components.some((c) => c.component === 'Text' && c.text === '**Hi**')).toBe(true);
    expect(validateBoardDoc(boardDocFromItems([])).ok).toBe(true);
  });

  it('keeps board-only components out of agent views, and checks board documents strictly', () => {
    const tile = [{ id: 'root', component: 'AgentTile', agentId: 'x' }];
    expect(validateViewComponents(tile)).toMatchObject({ ok: false, errors: [expect.stringMatching(/only be used on a board/)] });
    expect(validateBoardDoc({ components: tile }).ok).toBe(true);
    expect(validateBoardDoc({ components: [{ id: 'root', component: 'AgentTile', agentId: 'x', onClick: 'y' }] }).ok).toBe(false);
    expect(validateBoardDoc({ components: [{ id: 'root', component: 'Grid', children: ['missing'] }] }).ok).toBe(false);
    expect(validateBoardDoc({}).ok).toBe(false);
  });

  it('stores a document with a version, refuses stale saves, and undoes to the previous layout', () => {
    const s = new BoardsStore(join(mkdtempSync(join(tmpdir(), 'sua-boards-doc-')), 'runs.db'));
    s.save({ id: 'b', name: 'B', items: [agent('a', 0, 0)], expectedVersion: 0 });
    expect(s.get('b')!.doc).toBeUndefined();
    const doc = { components: [{ id: 't', component: 'AgentTile', agentId: 'a' }, { id: 'root', component: 'Tabs', tabs: [{ title: 'One', child: 't' }] }] };
    const saved = s.saveDoc({ id: 'b', name: 'B', doc, expectedVersion: 1 });
    expect(saved).toMatchObject({ version: 2, hasPrevious: true });
    expect(saved.doc!.components.find((c) => c.id === 'root')).toMatchObject({ component: 'Tabs' });
    expect(() => s.saveDoc({ id: 'b', name: 'B', doc, expectedVersion: 1 })).toThrow(BoardConflictError);
    expect(() => s.saveDoc({ id: 'b', name: 'B', doc: { components: [{ id: 'root', component: 'Nope' }] } })).toThrow(/isn't valid/);
    const undone = s.undo('b', 2);
    expect(undone.doc!.components.find((c) => c.id === 'root')).toMatchObject({ component: 'Column' });
    expect(s.loadDocOrDerive('b')!.doc.components.some((c) => c.component === 'AgentTile')).toBe(true);
    s.close();
  });
});

describe('sectionsFromBoardDoc', () => {
  it('groups tiles by enclosing section or tab title in reading order, with sizes from spans', () => {
    const doc = boardDocFromItems(boardItemsFromSections([
      { title: 'Today', agentIds: ['weather', 'news'], placements: { weather: { size: '2x2' } } },
      { title: 'Later', agentIds: ['notes'] },
    ]));
    expect(sectionsFromBoardDoc(doc)).toEqual([
      { title: 'Today', agentIds: ['weather', 'news'], placements: { weather: { size: '2x2' }, news: { size: '1x1' } } },
      { title: 'Later', agentIds: ['notes'], placements: { notes: { size: '1x1' } } },
    ]);
    const tabbed = { components: [
      { id: 'a', component: 'AgentTile', agentId: 'a' }, { id: 'b', component: 'AgentTile', agentId: 'b' },
      { id: 'tabs', component: 'Tabs', tabs: [{ title: 'One', child: 'a' }, { title: 'Two', child: 'b' }] },
      { id: 'c', component: 'AgentTile', agentId: 'c' },
      { id: 'root', component: 'Column', children: ['c', 'tabs'] },
    ] };
    expect(sectionsFromBoardDoc(tabbed).map((s) => [s.title, s.agentIds])).toEqual([['Tiles', ['c']], ['One', ['a']], ['Two', ['b']]]);
  });
});
