import { describe, it, expect } from 'vitest';
import { applyBoardOps } from './board-tree.js';
import { boardDocFromItems, boardItemsFromSections, type BoardDoc } from './boards.js';

const base = (): BoardDoc => boardDocFromItems(boardItemsFromSections([
  { title: 'Today', agentIds: ['weather', 'news'], placements: { weather: { size: '2x1' } } },
  { title: 'Later', agentIds: ['notes'] },
]));
const by = (doc: BoardDoc, id: string) => doc.components.find((c) => c.id === id)!;
const tileId = (doc: BoardDoc, agentId: string) => doc.components.find((c) => c.component === 'AgentTile' && c.agentId === agentId)!.id;
/** Agent ids in reading order, depth-first from root. */
function order(doc: BoardDoc): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const c = by(doc, id);
    if (c.component === 'AgentTile') out.push(c.agentId as string);
    const kids = Array.isArray(c.children) ? c.children as string[] : typeof c.child === 'string' ? [c.child] : Array.isArray(c.tabs) ? (c.tabs as Array<{ child: string }>).map((t) => t.child) : [];
    kids.forEach(walk);
  };
  walk('root');
  return out;
}

describe('applyBoardOps', () => {
  it('inserts a section with tiles, a heading and a note; returns the new ids', () => {
    const { doc, created } = applyBoardOps(base(), [
      { op: 'insert', parent: 'root', index: 0, node: { type: 'section', title: 'Morning' } },
    ]);
    const section = by(doc, created[0]);
    expect(section).toMatchObject({ component: 'Section', title: 'Morning' });
    const out = applyBoardOps(doc, [
      { op: 'insert', parent: section.child as string, node: { type: 'tile', agentId: 'stocks', palette: 'dark' } },
      { op: 'insert', parent: created[0], node: { type: 'note', text: 'Markets open at 9:30' } },
    ]);
    expect(order(out.doc)).toEqual(['stocks', 'weather', 'news', 'notes']);
    expect(by(out.doc, out.created[0])).toMatchObject({ component: 'AgentTile', palette: 'dark' });
    // A note added to a section lands in the section's grid.
    const morning = by(out.doc, created[0]);
    expect(by(out.doc, morning.child as string).children).toContain(out.created[1]);
    // A section whose child isn't a list gets a Column holding both.
    const card = applyBoardOps(out.doc, [{ op: 'wrap', id: out.created[0], in: 'card' }]);
    const cardId = card.doc.components.find((c) => c.component === 'Card')!.id;
    const withNote = applyBoardOps(card.doc, [{ op: 'insert', parent: cardId, node: { type: 'heading', text: 'Hi' } }]);
    expect(by(withNote.doc, by(withNote.doc, cardId).child as string)).toMatchObject({ component: 'Column' });
  });

  it('moves a tile (with its span) between grids, refuses moving a container into itself', () => {
    const doc = base();
    const later = (by(doc, 'root').children as string[])[1];
    const laterGrid = by(doc, later).child as string;
    const moved = applyBoardOps(doc, [{ op: 'move', id: tileId(doc, 'weather'), parent: laterGrid, index: 0 }]).doc;
    expect(order(moved)).toEqual(['news', 'weather', 'notes']);
    const cell = moved.components.find((c) => c.component === 'Cell' && c.child === tileId(moved, 'weather'))!;
    expect(cell.span).toBe(2);
    const today = (by(doc, 'root').children as string[])[0];
    expect(() => applyBoardOps(doc, [{ op: 'move', id: today, parent: by(doc, today).child as string }])).toThrow(/inside itself/);
    expect(() => applyBoardOps(doc, [{ op: 'move', id: 'root', parent: today }])).toThrow(/root/);
  });

  it('wraps in tabs, unwraps, removes (dropping the Cell), sets props and spans', () => {
    const doc = base();
    const [today] = by(doc, 'root').children as string[];
    let r = applyBoardOps(doc, [{ op: 'wrap', id: today, in: 'tabs', title: 'Now' }]);
    const tabs = r.doc.components.find((c) => c.component === 'Tabs')!;
    expect(tabs.tabs).toEqual([{ title: 'Now', child: today }]);
    r = applyBoardOps(r.doc, [{ op: 'set', id: tabs.id, props: { tabTitles: ['Right now'] } }, { op: 'set', id: today, props: { title: 'Today!' } }]);
    expect(by(r.doc, tabs.id).tabs).toEqual([{ title: 'Right now', child: today }]);
    expect(by(r.doc, today).title).toBe('Today!');
    r = applyBoardOps(r.doc, [{ op: 'unwrap', id: tabs.id }]);
    expect(r.doc.components.some((c) => c.component === 'Tabs')).toBe(false);
    expect((by(r.doc, 'root').children as string[])[0]).toBe(today);

    const w = tileId(r.doc, 'weather');
    r = applyBoardOps(r.doc, [{ op: 'span', id: w, span: 1 }]);
    expect(r.doc.components.some((c) => c.component === 'Cell' && c.child === w)).toBe(false);
    r = applyBoardOps(r.doc, [{ op: 'span', id: tileId(r.doc, 'news'), span: 3, rows: 2 }]);
    expect(r.doc.components.find((c) => c.component === 'Cell' && c.child === tileId(r.doc, 'news'))).toMatchObject({ span: 3, rows: 2 });
    r = applyBoardOps(r.doc, [{ op: 'remove', id: tileId(r.doc, 'news') }]);
    expect(order(r.doc)).toEqual(['weather', 'notes']);
    expect(r.doc.components.some((c) => c.component === 'Cell')).toBe(false); // the news Cell went with it
  });

  it('refuses bad operations without changing anything', () => {
    const doc = base();
    expect(() => applyBoardOps(doc, [{ op: 'remove', id: 'root' }])).toThrow(/root/);
    expect(() => applyBoardOps(doc, [{ op: 'remove', id: 'nope' }])).toThrow(/no "nope"/);
    expect(() => applyBoardOps(doc, [{ op: 'insert', parent: tileId(doc, 'news'), node: { type: 'row' } }])).toThrow(/can't hold/);
    expect(() => applyBoardOps(doc, [{ op: 'set', id: tileId(doc, 'news'), props: { title: 'x' } }])).toThrow(/Only a section/);
    expect(() => applyBoardOps(doc, [{ op: 'explode', id: 'root' }])).toThrow();
    expect(() => applyBoardOps(doc, [])).toThrow();
    expect(order(doc)).toEqual(['weather', 'news', 'notes']);
  });
});
