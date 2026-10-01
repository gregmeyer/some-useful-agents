import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardConflictError, BoardsStore, boardItemsFromSections, normalizeBoardItems, type BoardItem } from './boards.js';

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
