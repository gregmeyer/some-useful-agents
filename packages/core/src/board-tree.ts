/**
 * Editing a canvas board's A2UI document as a tree (docs/boards.md). One set
 * of operations for everyone who arranges a board — the canvas editor, and
 * agents through board-place — so they follow the same rules:
 *
 *   insert  a tile, heading, note, section, grid, row, column, tabs or card
 *   move    a node to another container (or another place in the same one)
 *   remove  a node and everything inside it (never the root)
 *   wrap    a node in a section, card, row, column or tabs
 *   unwrap  a container, putting its contents where it was
 *   set     a few safe props (titles, text, grid width, palette, tab titles)
 *   span    how many grid columns / rows a tile takes (adds or drops its Cell)
 *
 * A tile inside a grid may sit in a Cell (for its span); operations on the
 * tile act on that Cell, so a span travels with the tile. After the
 * operations, components nothing reaches are dropped and the document is
 * validated like any board.
 */
import { z } from 'zod';
import { validateBoardDoc, type BoardDoc } from './boards.js';
import type { ViewComponent } from './a2ui/view.js';

/** Components holding a list of children. */
const LIST = new Set(['Column', 'Row', 'Grid', 'List']);
/** Components holding one child. */
const SINGLE = new Set(['Section', 'Card', 'Cell', 'Disclosure']);

const palette = z.enum(['default', 'dark', 'light', 'accent-teal', 'accent-red', 'accent-green']);

const nodeSpec = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tile'), agentId: z.string().min(1).max(128), palette: palette.optional() }).strict(),
  z.object({ type: z.literal('system'), tileId: z.string().regex(/^_[a-z0-9_-]+$/i) }).strict(),
  z.object({ type: z.literal('heading'), text: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal('note'), text: z.string().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('section'), title: z.string().min(1).max(120) }).strict(),
  z.object({ type: z.literal('grid'), minWidth: z.number().int().min(120).max(800).optional() }).strict(),
  z.object({ type: z.literal('row') }).strict(),
  z.object({ type: z.literal('column') }).strict(),
  z.object({ type: z.literal('tabs'), title: z.string().min(1).max(80).optional() }).strict(),
  z.object({ type: z.literal('card') }).strict(),
]);
export type BoardNodeSpec = z.infer<typeof nodeSpec>;

const id = z.string().min(1).max(128);
export const boardOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert'), parent: id, index: z.number().int().min(0).optional(), node: nodeSpec }).strict(),
  z.object({ op: z.literal('move'), id, parent: id, index: z.number().int().min(0).optional() }).strict(),
  z.object({ op: z.literal('remove'), id }).strict(),
  z.object({ op: z.literal('wrap'), id, in: z.enum(['section', 'card', 'row', 'column', 'tabs']), title: z.string().min(1).max(120).optional() }).strict(),
  z.object({ op: z.literal('unwrap'), id }).strict(),
  z.object({
    op: z.literal('set'), id,
    props: z.object({
      title: z.string().min(1).max(120).optional(),
      text: z.string().min(1).max(4000).optional(),
      minWidth: z.number().int().min(120).max(800).optional(),
      palette: palette.optional(),
      tabTitles: z.array(z.string().min(1).max(80)).max(20).optional(),
    }).strict(),
  }).strict(),
  z.object({ op: z.literal('span'), id, span: z.number().int().min(1).max(4).optional(), rows: z.number().int().min(1).max(4).optional() }).strict(),
]);
export type BoardOp = z.infer<typeof boardOpSchema>;

type Comp = ViewComponent & Record<string, unknown>;
type Slot = { parent: Comp; kind: 'list'; index: number } | { parent: Comp; kind: 'single' } | { parent: Comp; kind: 'tab'; index: number };

class Tree {
  byId = new Map<string, Comp>();
  private n = 0;
  constructor(components: readonly ViewComponent[]) {
    for (const c of components) this.byId.set(c.id, JSON.parse(JSON.stringify(c)) as Comp);
    if (!this.byId.get('root')) throw new Error('The board has no root.');
  }
  get(nodeId: string): Comp {
    const c = this.byId.get(nodeId);
    if (!c) throw new Error(`There's no "${nodeId}" on this board.`);
    return c;
  }
  newId(prefix: string): string {
    let next: string;
    do { this.n += 1; next = `${prefix}_${this.n}`; } while (this.byId.has(next));
    return next;
  }
  add(c: Comp): string { this.byId.set(c.id, c); return c.id; }
  children(c: Comp): string[] {
    if (LIST.has(c.component)) return Array.isArray(c.children) ? (c.children as string[]) : [];
    if (SINGLE.has(c.component)) return typeof c.child === 'string' ? [c.child] : [];
    if (c.component === 'Tabs') return ((c.tabs as Array<{ child: string }>) ?? []).map((t) => t.child);
    return [];
  }
  isContainer(c: Comp): boolean { return LIST.has(c.component) || SINGLE.has(c.component) || c.component === 'Tabs'; }
  slotOf(nodeId: string): Slot | undefined {
    for (const c of this.byId.values()) {
      if (LIST.has(c.component)) {
        const i = this.children(c).indexOf(nodeId);
        if (i >= 0) return { parent: c, kind: 'list', index: i };
      } else if (SINGLE.has(c.component) && c.child === nodeId) {
        return { parent: c, kind: 'single' };
      } else if (c.component === 'Tabs') {
        const i = this.children(c).indexOf(nodeId);
        if (i >= 0) return { parent: c, kind: 'tab', index: i };
      }
    }
    return undefined;
  }
  /** The node as placed: a tile in a Cell is placed as the Cell. */
  placed(nodeId: string): string {
    this.get(nodeId);
    const slot = this.slotOf(nodeId);
    return slot && slot.parent.component === 'Cell' ? slot.parent.id : nodeId;
  }
  /** The tile inside a Cell (or the node itself). */
  inner(nodeId: string): Comp {
    const c = this.get(nodeId);
    return c.component === 'Cell' && typeof c.child === 'string' ? this.get(c.child) : c;
  }
  contains(ancestor: string, nodeId: string): boolean {
    if (ancestor === nodeId) return true;
    return this.children(this.get(ancestor)).some((k) => this.byId.has(k) && this.contains(k, nodeId));
  }
  /** Take a node out of its slot. A Section/Card left empty gets an empty Column; a Cell goes with its tile. */
  detach(nodeId: string): void {
    const slot = this.slotOf(nodeId);
    if (!slot) throw new Error(`"${nodeId}" isn't placed anywhere.`);
    if (slot.kind === 'list') (slot.parent.children as string[]).splice(slot.index, 1);
    else if (slot.kind === 'tab') (slot.parent.tabs as unknown[]).splice(slot.index, 1);
    else if (slot.parent.component === 'Cell') this.detach(slot.parent.id);
    else slot.parent.child = this.add({ id: this.newId('column'), component: 'Column', children: [] });
  }
  /** Put a node into a container at `index` (default: the end). */
  attach(parentId: string, nodeId: string, index?: number, tabTitle?: string): void {
    let parent = this.get(parentId);
    if (parent.component === 'Cell') parent = this.get(this.slotOf(parentId)?.parent.id ?? parentId);
    if (LIST.has(parent.component)) {
      const kids = this.children(parent).slice();
      kids.splice(index === undefined ? kids.length : Math.min(index, kids.length), 0, nodeId);
      parent.children = kids;
    } else if (parent.component === 'Tabs') {
      const tabs = ((parent.tabs as Array<{ title: string; child: string }>) ?? []).slice();
      tabs.splice(index === undefined ? tabs.length : Math.min(index, tabs.length), 0, { title: tabTitle ?? 'Tab', child: nodeId });
      parent.tabs = tabs;
    } else if (SINGLE.has(parent.component)) {
      // A section/card holds one thing: put it in a Column with what's there (or into it, if it is one).
      const current = typeof parent.child === 'string' ? this.get(parent.child) : undefined;
      if (current && LIST.has(current.component)) return this.attach(current.id, nodeId, index);
      const col = this.add({ id: this.newId('column'), component: 'Column', children: current ? [current.id] : [] });
      parent.child = col;
      this.attach(col, nodeId, index);
    } else {
      throw new Error(`"${parentId}" can't hold other things; pick a section, grid, row, column, tabs or card.`);
    }
  }
  replaceSlot(oldId: string, newId: string): void {
    const slot = this.slotOf(oldId);
    if (!slot) throw new Error(`"${oldId}" isn't placed anywhere.`);
    if (slot.kind === 'list') (slot.parent.children as string[])[slot.index] = newId;
    else if (slot.kind === 'tab') (slot.parent.tabs as Array<{ child: string }>)[slot.index].child = newId;
    else slot.parent.child = newId;
  }
  build(spec: BoardNodeSpec): string {
    switch (spec.type) {
      case 'tile': return this.add({ id: this.newId('tile'), component: 'AgentTile', agentId: spec.agentId, ...(spec.palette && spec.palette !== 'default' ? { palette: spec.palette } : {}) });
      case 'system': return this.add({ id: this.newId('tile'), component: 'SystemTile', tileId: spec.tileId });
      case 'heading': return this.add({ id: this.newId('heading'), component: 'Text', text: spec.text, variant: 'h3' });
      case 'note': return this.add({ id: this.newId('note'), component: 'Text', text: spec.text });
      case 'grid': return this.add({ id: this.newId('grid'), component: 'Grid', children: [], ...(spec.minWidth ? { minWidth: spec.minWidth } : {}) });
      case 'row': return this.add({ id: this.newId('row'), component: 'Row', children: [] });
      case 'column': return this.add({ id: this.newId('column'), component: 'Column', children: [] });
      case 'section': {
        const grid = this.add({ id: this.newId('grid'), component: 'Grid', children: [] });
        return this.add({ id: this.newId('section'), component: 'Section', title: spec.title, child: grid });
      }
      case 'tabs': {
        const grid = this.add({ id: this.newId('grid'), component: 'Grid', children: [] });
        return this.add({ id: this.newId('tabs'), component: 'Tabs', tabs: [{ title: spec.title ?? 'Tab 1', child: grid }] });
      }
      case 'card': {
        const col = this.add({ id: this.newId('column'), component: 'Column', children: [] });
        return this.add({ id: this.newId('card'), component: 'Card', child: col });
      }
    }
  }
  /** Drop everything the root no longer reaches. */
  collect(): ViewComponent[] {
    const keep = new Set<string>();
    const walk = (nodeId: string) => {
      if (keep.has(nodeId) || !this.byId.has(nodeId)) return;
      keep.add(nodeId);
      for (const k of this.children(this.get(nodeId))) walk(k);
    };
    walk('root');
    return [...this.byId.values()].filter((c) => keep.has(c.id));
  }
}

/**
 * Apply operations to a board document. Returns the new document and the ids
 * of nodes `insert` created (in order). Throws a readable error, and changes
 * nothing, when an operation can't be applied or the result isn't valid.
 */
export function applyBoardOps(doc: BoardDoc, opsInput: unknown): { doc: BoardDoc; created: string[] } {
  const ops = z.array(boardOpSchema).min(1).max(100).parse(opsInput);
  const t = new Tree(doc.components);
  const created: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'insert': {
        const nodeId = t.build(op.node);
        t.attach(op.parent, nodeId, op.index, op.node.type === 'tabs' ? op.node.title : undefined);
        created.push(nodeId);
        break;
      }
      case 'move': {
        const moving = t.placed(op.id);
        if (moving === 'root') throw new Error("The board's root can't move.");
        if (t.contains(moving, op.parent)) throw new Error(`Can't move "${op.id}" inside itself.`);
        t.get(op.parent);
        t.detach(moving);
        t.attach(op.parent, moving, op.index);
        break;
      }
      case 'remove': {
        const target = t.placed(op.id);
        if (target === 'root') throw new Error("The board's root can't be removed.");
        t.detach(target);
        break;
      }
      case 'wrap': {
        const target = t.placed(op.id);
        if (target === 'root') throw new Error("The board's root can't be wrapped.");
        const slot = t.slotOf(target);
        if (!slot) throw new Error(`"${op.id}" isn't placed anywhere.`);
        const wrapperId = op.in === 'section'
          ? t.add({ id: t.newId('section'), component: 'Section', title: op.title ?? 'Section', child: target })
          : op.in === 'card'
            ? t.add({ id: t.newId('card'), component: 'Card', child: target })
            : op.in === 'tabs'
              ? t.add({ id: t.newId('tabs'), component: 'Tabs', tabs: [{ title: op.title ?? 'Tab 1', child: target }] })
              : t.add({ id: t.newId(op.in), component: op.in === 'row' ? 'Row' : 'Column', children: [target] });
        // Swap the wrapper into the target's slot (the wrapper already points at the target).
        if (slot.kind === 'list') (slot.parent.children as string[])[slot.index] = wrapperId;
        else if (slot.kind === 'tab') (slot.parent.tabs as Array<{ child: string }>)[slot.index].child = wrapperId;
        else slot.parent.child = wrapperId;
        break;
      }
      case 'unwrap': {
        const c = t.get(op.id);
        if (op.id === 'root') throw new Error("The board's root can't be unwrapped.");
        if (!t.isContainer(c) || c.component === 'Cell') throw new Error(`"${op.id}" isn't a container.`);
        const kids = t.children(c);
        const slot = t.slotOf(op.id);
        if (!slot) throw new Error(`"${op.id}" isn't placed anywhere.`);
        if (slot.kind === 'list') (slot.parent.children as string[]).splice(slot.index, 1, ...kids);
        else if (kids.length === 1) t.replaceSlot(op.id, kids[0]);
        else t.replaceSlot(op.id, t.add({ id: t.newId('column'), component: 'Column', children: kids }));
        break;
      }
      case 'set': {
        const c = t.inner(op.id);
        const p = op.props;
        if (p.title !== undefined) { if (c.component !== 'Section') throw new Error(`Only a section has a title (not "${op.id}").`); c.title = p.title; }
        if (p.text !== undefined) { if (c.component !== 'Text') throw new Error(`Only a heading or note has text (not "${op.id}").`); c.text = p.text; }
        if (p.minWidth !== undefined) { if (c.component !== 'Grid') throw new Error(`Only a grid has a column width (not "${op.id}").`); c.minWidth = p.minWidth; }
        if (p.palette !== undefined) {
          if (c.component !== 'AgentTile' && c.component !== 'SystemTile') throw new Error(`Only a tile has a palette (not "${op.id}").`);
          if (p.palette === 'default') delete c.palette; else c.palette = p.palette;
        }
        if (p.tabTitles !== undefined) {
          if (c.component !== 'Tabs') throw new Error(`Only tabs have tab titles (not "${op.id}").`);
          (c.tabs as Array<{ title: string }>).forEach((tab, i) => { if (p.tabTitles![i]) tab.title = p.tabTitles![i]; });
        }
        break;
      }
      case 'span': {
        const placed = t.placed(op.id);
        const tile = t.inner(placed);
        const slot = t.slotOf(placed);
        const span = op.span ?? 1;
        const rows = op.rows ?? 1;
        if (placed !== tile.id) {
          const cell = t.get(placed);
          if (span === 1 && rows === 1) t.replaceSlot(placed, tile.id);
          else { if (span > 1) cell.span = span; else delete cell.span; if (rows > 1) cell.rows = rows; else delete cell.rows; }
        } else if (span > 1 || rows > 1) {
          if (!slot || slot.parent.component !== 'Grid') throw new Error(`"${op.id}" isn't in a grid, so it can't span columns.`);
          const cell = t.add({ id: t.newId('cell'), component: 'Cell', child: tile.id, ...(span > 1 ? { span } : {}), ...(rows > 1 ? { rows } : {}) });
          t.replaceSlot(tile.id, cell);
        }
        break;
      }
    }
  }
  const v = validateBoardDoc({ components: t.collect() });
  if (!v.ok) throw new Error(`That would make the board invalid: ${v.errors[0]}`);
  return { doc: v.doc, created };
}
