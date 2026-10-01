import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardConflictError, BoardsStore, applyBoardChanges, boardItemsFromLayoutPlan, boardItemsFromSections, freeSpot, normalizeBoardItems, type BoardItem } from './boards.js';
import { getBuiltinTool } from './builtin-tools.js';
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

describe('applyBoardChanges', () => {
  it('adds into the first free spot, moves, resizes and removes by item id or agent id', () => {
    let items = normalizeBoardItems([agent('a', 0, 0, 6, 5)]);
    expect(freeSpot(items, 3, 5)).toEqual({ x: 6, y: 0 });
    items = applyBoardChanges(items, [
      { op: 'add', kind: 'agent', agentId: 'b' },
      { op: 'add', kind: 'agent', agentId: 'c', size: '2x1' },
      { op: 'add', kind: 'heading', text: 'More' },
      { op: 'move', id: 'c', x: 6, y: 0 },
      { op: 'resize', id: 'a', w: 3, h: 5 },
    ]);
    const at = (agentId: string) => items.find((i) => i.kind === 'agent' && i.agentId === agentId)!;
    expect(at('a')).toMatchObject({ x: 0, y: 0, w: 3 });
    expect(at('b')).toMatchObject({ x: 6, y: 0 });
    expect(at('c')).toMatchObject({ x: 6, w: 6 });
    expect(items.find((i) => i.kind === 'heading')).toMatchObject({ x: 0, w: 12 });
    items = applyBoardChanges(items, [{ op: 'remove', id: 'b' }]);
    expect(items.some((i) => i.kind === 'agent' && i.agentId === 'b')).toBe(false);
    expect(() => applyBoardChanges(items, [{ op: 'remove', id: 'nope' }])).toThrow(/no item "nope"/);
    expect(() => applyBoardChanges(items, [{ op: 'explode', id: 'a' }])).toThrow();
    expect(() => applyBoardChanges(items, [])).toThrow();
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

  it('lists boards, reads a derived dashboard board, places tiles, and refuses stale or bad changes', async () => {
    const boards = setup();
    const list = await read.execute({}, { boards });
    expect(list.result).toContain('pulse — Pulse');
    expect(list.result).toContain('user:am — AM');
    const am = await read.execute({ board: 'user:am' }, { boards });
    expect(am.result).toMatch(/version 0, 12 columns, 2 items/);
    expect(am.result).toContain('agent news at x=0 y=1');

    const placed = await place.execute({ board: 'pulse', changes: JSON.stringify([{ op: 'add', kind: 'agent', agentId: 'weather', size: '2x1' }, { op: 'add', kind: 'note', text: 'Hi' }]), version: 0 }, { boards });
    expect(placed.isError).toBeFalsy();
    expect(placed.result).toMatch(/^Saved\. Board "Pulse" \(pulse\), version 1/);
    expect(boards.get('pulse')!.items.map((i) => i.kind)).toEqual(['agent', 'note']);

    const stale = await place.execute({ board: 'pulse', changes: [{ op: 'remove', id: 'weather' }], version: 0 }, { boards });
    expect(stale).toMatchObject({ isError: true });
    expect(stale.result).toMatch(/now at version 1/);
    const ghost = await place.execute({ board: 'pulse', changes: [{ op: 'add', kind: 'agent', agentId: 'ghost' }] }, { boards });
    expect(ghost.result).toMatch(/no installed agent "ghost"/);
    const bad = await place.execute({ board: 'pulse', changes: [{ op: 'add', kind: 'iframe' }] }, { boards });
    expect(bad).toMatchObject({ isError: true });
    expect(boards.get('pulse')!.version).toBe(1);
    expect((await place.execute({ board: 'nope', changes: [] }, { boards })).result).toMatch(/no board "nope"/);
    expect((await read.execute({ board: 'pulse' }, {})).result).toMatch(/not available/);
  });

  it('accepts changes sent as JSON strings one by one, and a heading with a size', async () => {
    const boards = setup();
    const out = await place.execute({ board: 'pulse', changes: [JSON.stringify({ op: 'add', kind: 'heading', text: 'Top', x: 0, y: 0, w: 12, h: 1 }), JSON.stringify({ op: 'add', kind: 'agent', agentId: 'news' })] }, { boards });
    expect(out.isError).toBeFalsy();
    expect(boards.get('pulse')!.items.map((i) => `${i.kind}:${i.w}x${i.h}`)).toEqual(['heading:12x1', 'agent:3x5']);
  });
});
