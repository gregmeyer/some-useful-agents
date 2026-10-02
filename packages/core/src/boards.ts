/**
 * Boards (W4, docs/boards.md): a canvas of items on a 12-column grid, stored
 * on the server. Pulse is the `pulse` board; every named dashboard is a board.
 *
 * Layout rule: vertical compaction. Items never overlap and float up into any
 * gap, so a board never has holes and reflows predictably on narrow screens.
 * `normalizeBoardItems` enforces both on every save, whoever saves (you in the
 * editor, Improve layout, or an agent through the `board-place` tool).
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { openStoreDb } from './sqlite-open.js';
import type { DashboardSection } from './packs-store.js';
import { validateViewComponents, type ViewComponent } from './a2ui/view.js';

export const BOARD_COLUMNS = 12;
/** Height of one grid row, in CSS pixels. */
export const BOARD_ROW_PX = 40;
export const MAX_BOARD_ITEMS = 200;
export const PULSE_BOARD_ID = 'pulse';

const itemBase = {
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, 'item ids are letters, digits, - and _'),
  x: z.number().int().min(0).max(BOARD_COLUMNS - 1),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(BOARD_COLUMNS),
  h: z.number().int().min(1).max(60),
};

/** Tile colour schemes (the ● button on a tile). `default` is stored as no palette. */
export const BOARD_PALETTES = ['default', 'dark', 'light', 'accent-teal', 'accent-red', 'accent-green'] as const;
const palette = z.enum(BOARD_PALETTES).optional();

export const boardItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...itemBase, kind: z.literal('agent'), agentId: z.string().min(1).max(128), fit: z.enum(['grow', 'scroll']).optional(), palette }).strict(),
  z.object({ ...itemBase, kind: z.literal('heading'), text: z.string().min(1).max(120) }).strict(),
  z.object({ ...itemBase, kind: z.literal('note'), text: z.string().min(1).max(4000) }).strict(),
  z.object({ ...itemBase, kind: z.literal('system'), tileId: z.string().regex(/^_[a-z0-9_-]+$/i), palette }).strict(),
]);

export type BoardItem = z.infer<typeof boardItemSchema>;

export interface Board {
  id: string;
  name: string;
  packId: string | null;
  items: BoardItem[];
  /** Bumped on every save; a save from an older version is refused. */
  version: number;
  updatedAt: number;
  /** True when there's an earlier layout to go back to (Undo). */
  hasPrevious?: boolean;
  /** The canvas document, once the board has been saved as one (else derive it from `items`). */
  doc?: BoardDoc;
}

/** A save from an older version of the board than the one stored. */
export class BoardConflictError extends Error {
  constructor(public readonly boardId: string, public readonly current: number) {
    super(`Board "${boardId}" changed since you opened it (now at version ${current}). Reload to see the current layout, then make your change again.`);
    this.name = 'BoardConflictError';
  }
}

const overlaps = (a: BoardItem, b: BoardItem) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Validate and settle items: clamp to the grid, give every item a unique id,
 * push overlapping items down, then float everything up into gaps (vertical
 * compaction). Order of precedence when two items want the same spot: higher
 * up first, then further left. Throws on items that fail the schema.
 */
export function normalizeBoardItems(input: unknown): BoardItem[] {
  const parsed = z.array(boardItemSchema).max(MAX_BOARD_ITEMS).parse(input);
  const seen = new Set<string>();
  for (const it of parsed) {
    if (seen.has(it.id)) throw new Error(`Duplicate board item id "${it.id}".`);
    seen.add(it.id);
  }
  const items = parsed.map((it) => {
    const w = Math.min(it.w, BOARD_COLUMNS);
    return { ...it, w, x: Math.min(it.x, BOARD_COLUMNS - w) };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: BoardItem[] = [];
  for (const it of items) {
    const cur = { ...it };
    // Float up as far as nothing already placed is in the way…
    while (cur.y > 0 && !placed.some((p) => overlaps({ ...cur, y: cur.y - 1 }, p))) cur.y -= 1;
    // …and if it still lands on something, drop below it until clear.
    let hit = placed.find((p) => overlaps(cur, p));
    while (hit) { cur.y = hit.y + hit.h; hit = placed.find((p) => overlaps(cur, p)); }
    placed.push(cur);
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Each tile template's default size — the dashboard's TEMPLATE_REGISTRY
 * `defaultSize`, mirrored here so boards derived outside the dashboard (the
 * board tools) size tiles the way the page does. A dashboard test keeps the
 * two in step.
 */
export const TILE_TEMPLATE_DEFAULT_SIZES: Readonly<Record<string, '1x1' | '2x1' | '1x2' | '2x2'>> = {
  metric: '1x1', 'time-series': '2x1', 'text-headline': '1x1', 'text-image': '2x1', image: '2x2',
  table: '2x1', status: '1x1', media: '2x1', widget: '2x1', comparison: '2x1', 'key-value': '2x1',
  story: '2x1', funnel: '1x2',
};

/** Grid size for an old tile size hint (`1x1` … `2x2`). */
export function sizeToSpan(size: string | undefined): { w: number; h: number } {
  switch (size) {
    case '2x1': return { w: 6, h: 5 };
    case '1x2': return { w: 3, h: 10 };
    case '2x2': return { w: 6, h: 10 };
    default: return { w: 3, h: 5 };
  }
}

/**
 * A named dashboard's sections as board items: each section is a full-width
 * heading followed by its agent tiles, left to right, wrapping at 12 columns.
 * `sizeOf` gives an agent's preferred size (placement, layout hint, signal).
 */
export function boardItemsFromSections(
  sections: readonly DashboardSection[],
  sizeOf: (agentId: string, sectionIndex: number) => string | undefined = () => undefined,
): BoardItem[] {
  const items: BoardItem[] = [];
  let y = 0;
  sections.forEach((s, si) => {
    if (s.agentIds.length === 0) return;
    items.push({ id: `h${si}`, kind: 'heading', text: s.title || `Section ${si + 1}`, x: 0, y, w: BOARD_COLUMNS, h: 1 });
    y += 1;
    let x = 0;
    let rowH = 0;
    s.agentIds.forEach((agentId, ti) => {
      const placement = s.placements?.[agentId];
      const { w, h } = sizeToSpan(placement?.size ?? sizeOf(agentId, si));
      if (x + w > BOARD_COLUMNS) { y += rowH; x = 0; rowH = 0; }
      items.push({
        id: `s${si}t${ti}`, kind: 'agent', agentId, x, y, w,
        h: placement?.height ? Math.max(1, Math.ceil(placement.height / BOARD_ROW_PX)) : h,
        ...(placement?.tileFit ? { fit: placement.tileFit } : {}),
      });
      x += w;
      rowH = Math.max(rowH, placement?.height ? Math.ceil(placement.height / BOARD_ROW_PX) : h);
    });
    y += rowH;
  });
  return normalizeBoardItems(items);
}

/**
 * A board as dashboard sections (for Save as pack and anything else that
 * still speaks sections): each heading starts a section; tiles before the
 * first heading go in an untitled one. Order is the board's reading order;
 * sizes come back as the nearest 1x1…2x2.
 */
export function sectionsFromBoardItems(items: readonly BoardItem[]): DashboardSection[] {
  const sections: DashboardSection[] = [];
  let cur: DashboardSection | undefined;
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (it.kind === 'heading') { cur = { title: it.text, agentIds: [] }; sections.push(cur); continue; }
    if (it.kind !== 'agent') continue;
    if (!cur) { cur = { title: 'Tiles', agentIds: [] }; sections.push(cur); }
    if (cur.agentIds.includes(it.agentId)) continue;
    cur.agentIds.push(it.agentId);
    const size = `${it.w >= 5 ? 2 : 1}x${it.h >= 8 ? 2 : 1}` as '1x1';
    cur.placements = { ...(cur.placements ?? {}), [it.agentId]: { size, ...(it.fit ? { tileFit: it.fit } : {}) } };
  }
  return sections.filter((sct) => sct.agentIds.length > 0);
}

/** A short fingerprint of a board's items (for comparisons and tests). */
export function boardItemsHash(items: readonly BoardItem[]): string {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12);
}

/** First free w×h spot on a board, top to bottom then left to right (else a new row at the bottom). */
export function freeSpot(items: readonly BoardItem[], w: number, h: number): { x: number; y: number } {
  const width = Math.min(Math.max(1, w), BOARD_COLUMNS);
  const end = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (let y = 0; y <= end; y++) {
    for (let x = 0; x + width <= BOARD_COLUMNS; x++) {
      const probe = { id: '_', kind: 'heading', text: '_', x, y, w: width, h } as BoardItem;
      if (!items.some((o) => overlaps(probe, o))) return { x, y };
    }
  }
  return { x: 0, y: end };
}

const pos = { x: z.number().int().min(0).max(BOARD_COLUMNS - 1).optional(), y: z.number().int().min(0).max(10_000).optional() };
const span = { w: z.number().int().min(1).max(BOARD_COLUMNS).optional(), h: z.number().int().min(1).max(60).optional() };

/** One change an agent (or the board-place tool) makes to a board. */
export const boardChangeSchema = z.union([
  z.object({ op: z.literal('add'), kind: z.literal('agent'), agentId: z.string().min(1).max(128), size: z.enum(['1x1', '2x1', '1x2', '2x2']).optional(), ...pos, ...span }).strict(),
  // A heading always spans the row; w/h are accepted (models send them) and ignored.
  z.object({ op: z.literal('add'), kind: z.literal('heading'), text: z.string().min(1).max(120), ...pos, ...span }).strict(),
  z.object({ op: z.literal('add'), kind: z.literal('note'), text: z.string().min(1).max(4000), ...pos, ...span }).strict(),
  z.object({ op: z.literal('move'), id: z.string().min(1), x: z.number().int().min(0).max(BOARD_COLUMNS - 1), y: z.number().int().min(0).max(10_000) }).strict(),
  z.object({ op: z.literal('resize'), id: z.string().min(1), w: z.number().int().min(1).max(BOARD_COLUMNS), h: z.number().int().min(1).max(60) }).strict(),
  z.object({ op: z.literal('remove'), id: z.string().min(1) }).strict(),
]);
export type BoardChange = z.infer<typeof boardChangeSchema>;

/**
 * Apply changes to a board's items and settle them. An `add` without x/y
 * goes in the first free spot; `move`/`resize`/`remove` take an item id
 * (or, for an agent tile, the agent id). Throws a readable error on an
 * unknown id or a change that fails the schema.
 */
export function applyBoardChanges(current: readonly BoardItem[], changesInput: unknown): BoardItem[] {
  const changes = z.array(boardChangeSchema).min(1).max(100).parse(changesInput);
  let items: BoardItem[] = current.map((i) => ({ ...i }));
  const find = (id: string) => items.find((i) => i.id === id) ?? items.find((i) => i.kind === 'agent' && i.agentId === id);
  const newId = (prefix: string) => {
    let n = items.length + 1;
    while (items.some((i) => i.id === `${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  };
  for (const c of changes) {
    if (c.op === 'add') {
      if (c.kind === 'agent') {
        const { w, h } = c.w || c.h ? { w: c.w ?? 3, h: c.h ?? 5 } : sizeToSpan(c.size);
        const at = c.x !== undefined && c.y !== undefined ? { x: c.x, y: c.y } : freeSpot(items, w, h);
        items.push({ id: newId('a'), kind: 'agent', agentId: c.agentId, ...at, w, h });
      } else if (c.kind === 'heading') {
        const end = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
        items.push({ id: newId('h'), kind: 'heading', text: c.text, x: 0, y: c.y ?? end, w: BOARD_COLUMNS, h: 1 });
      } else {
        const w = c.w ?? 4;
        const h = c.h ?? 3;
        const at = c.x !== undefined && c.y !== undefined ? { x: c.x, y: c.y } : freeSpot(items, w, h);
        items.push({ id: newId('n'), kind: 'note', text: c.text, ...at, w, h });
      }
      items = normalizeBoardItems(items);
      continue;
    }
    const target = find(c.id);
    if (!target) throw new Error(`There's no item "${c.id}" on this board. Read the board first to get item ids.`);
    if (c.op === 'remove') items = items.filter((i) => i !== target);
    else if (c.op === 'move') { target.x = Math.min(c.x, BOARD_COLUMNS - target.w); target.y = c.y; }
    else { target.w = c.w; target.h = c.h; target.x = Math.min(target.x, BOARD_COLUMNS - c.w); }
    items = normalizeBoardItems(items);
  }
  return items;
}

/**
 * Board items from an Improve-layout plan: each container becomes a heading
 * plus its tiles, sized by the plan's suggestion for that agent (else
 * `sizeOf`). System tiles (`_…`) become system items.
 */
export function boardItemsFromLayoutPlan(
  plan: { containers: Array<{ label: string; tiles: string[] }>; topAgents?: Array<{ id: string; suggestedSize?: string; suggestedHeight?: number; suggestedTileFit?: 'grow' | 'scroll' }> },
  sizeOf: (tileId: string) => string | undefined = () => undefined,
): BoardItem[] {
  const hints = new Map((plan.topAgents ?? []).map((a) => [a.id, a]));
  const sections: DashboardSection[] = plan.containers.map((c) => ({
    title: c.label,
    agentIds: c.tiles,
    placements: Object.fromEntries(c.tiles.flatMap((t) => {
      const hnt = hints.get(t);
      if (!hnt) return [];
      return [[t, {
        ...(hnt.suggestedSize ? { size: hnt.suggestedSize as '1x1' } : {}),
        ...(hnt.suggestedHeight ? { height: hnt.suggestedHeight } : {}),
        ...(hnt.suggestedTileFit ? { tileFit: hnt.suggestedTileFit } : {}),
      }]];
    })),
  }));
  return boardItemsFromSections(sections, (id) => sizeOf(id)).map((it) =>
    it.kind === 'agent' && it.agentId.startsWith('_')
      ? { id: it.id, kind: 'system' as const, tileId: it.agentId, x: it.x, y: it.y, w: it.w, h: it.h }
      : it);
}

// ── Canvas boards (docs/boards.md) ─────────────────────────────────────
// A board's layout as ONE A2UI surface: basic layout components plus the
// board-only Grid, Cell, Section, AgentTile and SystemTile, rooted at `root`.

/** A board's A2UI document: the component list (one has id `root`). */
export interface BoardDoc {
  components: ViewComponent[];
}

/** Validate a board document (strict A2UI processor, board limits). */
export function validateBoardDoc(doc: unknown): { ok: true; doc: BoardDoc } | { ok: false; errors: string[] } {
  const components = doc && typeof doc === 'object' ? (doc as { components?: unknown }).components : undefined;
  const v = validateViewComponents(components, { board: true });
  return v.ok ? { ok: true, doc: { components: v.components } } : v;
}

/** Agent ids a board document shows (AgentTile leaves), in document order. */
export function boardDocAgentIds(doc: BoardDoc): string[] {
  return doc.components.flatMap((c) => (c.component === 'AgentTile' && typeof c.agentId === 'string' ? [c.agentId] : []));
}

/** System tile ids a board document shows. */
export function boardDocSystemTileIds(doc: BoardDoc): string[] {
  return doc.components.flatMap((c) => (c.component === 'SystemTile' && typeof c.tileId === 'string' ? [c.tileId] : []));
}

/** Column span for a grid item's width (12-column units → 1–3 tiles wide). */
function spanFor(w: number): number { return w >= 9 ? 3 : w >= 5 ? 2 : 1; }

/**
 * A grid board (items) as a canvas document: each heading starts a Section
 * holding a Grid of its tiles; tiles before the first heading sit in a Grid at
 * the top. Wide items span 2–3 columns, tall ones 2 rows. Notes become Text.
 */
export function boardDocFromItems(items: readonly BoardItem[]): BoardDoc {
  const components: ViewComponent[] = [];
  const top: string[] = [];
  let cells: string[] = [];
  let title: string | undefined;
  let n = 0;
  const flush = () => {
    if (cells.length === 0 && title === undefined) return;
    n += 1;
    const gridId = `grid_${n}`;
    components.push({ id: gridId, component: 'Grid', children: cells });
    if (title === undefined) top.push(gridId);
    else {
      const sectionId = `section_${n}`;
      components.push({ id: sectionId, component: 'Section', title, child: gridId });
      top.push(sectionId);
    }
    cells = [];
  };
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (it.kind === 'heading') { flush(); title = it.text; continue; }
    const leafId = `tile_${it.id}`;
    if (it.kind === 'agent') components.push({ id: leafId, component: 'AgentTile', agentId: it.agentId, ...(it.palette ? { palette: it.palette } : {}) });
    else if (it.kind === 'system') components.push({ id: leafId, component: 'SystemTile', tileId: it.tileId, ...(it.palette ? { palette: it.palette } : {}) });
    else components.push({ id: leafId, component: 'Text', text: it.text });
    // A Cell only when the tile spans more than one column or row.
    const span = spanFor(it.w);
    const rows = it.h >= 8 ? 2 : 1;
    if (span === 1 && rows === 1) { cells.push(leafId); continue; }
    const cellId = `cell_${it.id}`;
    components.push({ id: cellId, component: 'Cell', child: leafId, ...(span > 1 ? { span } : {}), ...(rows > 1 ? { rows } : {}) });
    cells.push(cellId);
  }
  flush();
  components.push({ id: 'root', component: 'Column', children: top });
  return { components };
}

/**
 * A canvas document as dashboard sections (Save as pack, and anything that
 * still speaks sections): tiles are grouped under the nearest enclosing
 * Section title or tab title, in reading order; tiles outside any go under
 * "Tiles". A Cell's span/rows become the 1x1…2x2 size.
 */
export function sectionsFromBoardDoc(doc: BoardDoc): DashboardSection[] {
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const order: string[] = [];
  const groups = new Map<string, DashboardSection>();
  const put = (title: string, agentId: string, size: string) => {
    let g = groups.get(title);
    if (!g) { g = { title, agentIds: [] }; groups.set(title, g); order.push(title); }
    if (g.agentIds.includes(agentId)) return;
    g.agentIds.push(agentId);
    g.placements = { ...(g.placements ?? {}), [agentId]: { size: size as '1x1' } };
  };
  const walk = (id: string, title: string, size: string, seen: Set<string>) => {
    const c = byId.get(id);
    if (!c || seen.has(id)) return;
    seen.add(id);
    if (c.component === 'AgentTile' && typeof c.agentId === 'string') { put(title, c.agentId, size); return; }
    if (c.component === 'Section' && typeof c.child === 'string') return walk(c.child, String(c.title), '1x1', seen);
    if (c.component === 'Cell' && typeof c.child === 'string') {
      const span = Number(c.span ?? 1);
      const rows = Number(c.rows ?? 1);
      return walk(c.child, title, `${span >= 2 ? 2 : 1}x${rows >= 2 ? 2 : 1}`, seen);
    }
    if (c.component === 'Tabs' && Array.isArray(c.tabs)) {
      for (const t of c.tabs as Array<{ title: string; child: string }>) walk(t.child, t.title || title, '1x1', seen);
      return;
    }
    const kids = Array.isArray(c.children) ? c.children as string[] : typeof c.child === 'string' ? [c.child] : [];
    for (const k of kids) walk(k, title, '1x1', seen);
  };
  walk('root', 'Tiles', '1x1', new Set());
  return order.map((t) => groups.get(t)!);
}

/**
 * Stored boards. A board with no row is "not customised yet": the caller
 * derives it (Pulse: nothing placed, everything in the Unplaced tray; a named
 * dashboard: from its sections) and the first save creates the row.
 */
export class BoardsStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPathOrHandle: string | DatabaseSync) {
    if (typeof dbPathOrHandle === 'string') {
      this.db = openStoreDb(dbPathOrHandle);
      this.ownsConnection = true;
    } else {
      this.db = dbPathOrHandle;
      this.ownsConnection = false;
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pack_id TEXT,
        items_json TEXT NOT NULL,
        previous_items_json TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      )
    `);
    // Canvas documents (W5/C1): added later, so older databases get the columns here.
    const cols = new Set((this.db.prepare("SELECT name FROM pragma_table_info('boards')").all() as Array<{ name: string }>).map((r) => r.name));
    if (!cols.has('doc_json')) this.db.exec('ALTER TABLE boards ADD COLUMN doc_json TEXT');
    if (!cols.has('previous_doc_json')) this.db.exec('ALTER TABLE boards ADD COLUMN previous_doc_json TEXT');
  }

  get(id: string): Board | undefined {
    const row = this.db.prepare('SELECT id, name, pack_id, items_json, doc_json, (previous_items_json IS NOT NULL OR previous_doc_json IS NOT NULL) AS has_previous, version, updated_at FROM boards WHERE id = ?').get(id) as
      | { id: string; name: string; pack_id: string | null; items_json: string; doc_json: string | null; has_previous: number; version: number; updated_at: number }
      | undefined;
    if (!row) return undefined;
    let items: BoardItem[] = [];
    try { items = normalizeBoardItems(JSON.parse(row.items_json)); } catch { items = []; }
    let doc: BoardDoc | undefined;
    if (row.doc_json) {
      try { const v = validateBoardDoc(JSON.parse(row.doc_json)); if (v.ok) doc = v.doc; } catch { doc = undefined; }
    }
    return { id: row.id, name: row.name, packId: row.pack_id, items, version: row.version, updatedAt: row.updated_at, hasPrevious: row.has_previous === 1, ...(doc ? { doc } : {}) };
  }

  /**
   * Save a board's items (normalised). `expectedVersion` is the version the
   * caller read (0 = it read a derived, never-saved board); a mismatch throws
   * BoardConflictError. The previous items are kept for one-step Undo.
   */
  save(args: { id: string; name: string; packId?: string | null; items: unknown; expectedVersion?: number }): Board {
    const items = normalizeBoardItems(args.items);
    const current = this.get(args.id);
    const currentVersion = current?.version ?? 0;
    if (args.expectedVersion !== undefined && args.expectedVersion !== currentVersion) {
      throw new BoardConflictError(args.id, currentVersion);
    }
    const now = Date.now();
    if (current) {
      this.db.prepare('UPDATE boards SET name = ?, items_json = ?, previous_items_json = items_json, version = version + 1, updated_at = ? WHERE id = ?')
        .run(args.name, JSON.stringify(items), now, args.id);
    } else {
      this.db.prepare('INSERT INTO boards (id, name, pack_id, items_json, previous_items_json, version, updated_at) VALUES (?, ?, ?, ?, NULL, 1, ?)')
        .run(args.id, args.name, args.packId ?? null, JSON.stringify(items), now);
    }
    return this.get(args.id)!;
  }

  /**
   * Save a board's canvas document (validated). Same version rule as save();
   * the previous document is kept for one-step Undo.
   */
  saveDoc(args: { id: string; name: string; packId?: string | null; doc: unknown; expectedVersion?: number }): Board {
    const v = validateBoardDoc(args.doc);
    if (!v.ok) throw new Error(`That board layout isn't valid: ${v.errors[0]}`);
    const current = this.get(args.id);
    const currentVersion = current?.version ?? 0;
    if (args.expectedVersion !== undefined && args.expectedVersion !== currentVersion) throw new BoardConflictError(args.id, currentVersion);
    const json = JSON.stringify(v.doc);
    const now = Date.now();
    if (current) {
      this.db.prepare('UPDATE boards SET name = ?, previous_doc_json = COALESCE(doc_json, ?), doc_json = ?, version = version + 1, updated_at = ? WHERE id = ?')
        .run(args.name, JSON.stringify(boardDocFromItems(current.items)), json, now, args.id);
    } else {
      this.db.prepare("INSERT INTO boards (id, name, pack_id, items_json, doc_json, version, updated_at) VALUES (?, ?, ?, '[]', ?, 1, ?)")
        .run(args.id, args.name, args.packId ?? null, json, now);
    }
    return this.get(args.id)!;
  }

  /** The board's canvas document: the saved one, else derived from its items (Pulse: empty). */
  loadDocOrDerive(id: string): (Board & { derived: boolean; doc: BoardDoc }) | undefined {
    const b = this.loadOrDerive(id);
    if (!b) return undefined;
    return { ...b, doc: b.doc ?? boardDocFromItems(b.items) };
  }

  /** Put back the items from before the last save (Undo twice = Redo). */
  undo(id: string, expectedVersion?: number): Board {
    const row = this.db.prepare('SELECT previous_items_json, previous_doc_json, version FROM boards WHERE id = ?').get(id) as
      | { previous_items_json: string | null; previous_doc_json: string | null; version: number } | undefined;
    if (!row || (!row.previous_items_json && !row.previous_doc_json)) throw new Error('There is no earlier layout to go back to.');
    if (expectedVersion !== undefined && expectedVersion !== row.version) throw new BoardConflictError(id, row.version);
    if (row.previous_doc_json) {
      this.db.prepare('UPDATE boards SET doc_json = previous_doc_json, previous_doc_json = doc_json, version = version + 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
    } else {
      this.db.prepare('UPDATE boards SET items_json = previous_items_json, previous_items_json = items_json, version = version + 1, updated_at = ? WHERE id = ?')
        .run(Date.now(), id);
    }
    return this.get(id)!;
  }

  /**
   * The board as it stands: the saved one, or (never saved) Pulse with nothing
   * placed / a named dashboard laid out from its sections. Undefined when
   * there's no such board. Used by the board tools, which have no tile data.
   */
  loadOrDerive(id: string): (Board & { derived: boolean }) | undefined {
    const stored = this.get(id);
    if (stored) return { ...stored, derived: false };
    if (id === PULSE_BOARD_ID) return { id, name: 'Pulse', packId: null, items: [], version: 0, updatedAt: 0, derived: true };
    let row: { name: string; pack_id: string | null; layout_json: string; updated_at: number } | undefined;
    try {
      row = this.db.prepare('SELECT name, pack_id, layout_json, updated_at FROM dashboards WHERE id = ?').get(id) as typeof row;
    } catch { row = undefined; }
    if (!row) return undefined;
    let sections: DashboardSection[] = [];
    try { sections = (JSON.parse(row.layout_json) as { sections?: DashboardSection[] }).sections ?? []; } catch { sections = []; }
    return { id, name: row.name, packId: row.pack_id, items: boardItemsFromSections(sections, (agentId) => this.tileSize(agentId)), version: 0, updatedAt: row.updated_at, derived: true };
  }

  /** Every board you can open: saved boards, Pulse, and every named dashboard. */
  listAll(): Array<{ id: string; name: string; saved: boolean }> {
    const out = new Map<string, { id: string; name: string; saved: boolean }>();
    out.set(PULSE_BOARD_ID, { id: PULSE_BOARD_ID, name: 'Pulse', saved: false });
    try {
      for (const r of this.db.prepare('SELECT id, name FROM dashboards ORDER BY name').all() as Array<{ id: string; name: string }>) out.set(r.id, { id: r.id, name: r.name, saved: false });
    } catch { /* no dashboards table */ }
    for (const b of this.list()) out.set(b.id, { id: b.id, name: b.name, saved: true });
    return [...out.values()];
  }

  /**
   * The size an agent's tile prefers, as the dashboard picks it: an
   * Improve-layout hint, else the tile's declared size, else its template's
   * default (agents with only a view use the widget template).
   */
  tileSize(agentId: string): string | undefined {
    try {
      const hint = this.db.prepare('SELECT size FROM layout_hints WHERE agent_id = ?').get(agentId) as { size: string | null } | undefined;
      if (hint?.size) return hint.size;
    } catch { /* no layout_hints table */ }
    try {
      const row = this.db.prepare('SELECT v.dag_json FROM agents a JOIN agent_versions v ON v.agent_id = a.id AND v.version = a.current_version WHERE a.id = ?').get(agentId) as { dag_json: string } | undefined;
      if (!row) return undefined;
      const dag = JSON.parse(row.dag_json) as { signal?: { size?: string; template?: string }; view?: unknown };
      if (dag.signal?.size) return dag.signal.size;
      if (dag.signal?.template) return TILE_TEMPLATE_DEFAULT_SIZES[dag.signal.template];
      if (dag.view) return TILE_TEMPLATE_DEFAULT_SIZES.widget;
    } catch { /* no agents tables, or unreadable */ }
    return undefined;
  }

  /** Agent ids among `ids` that aren't installed (or have no tile to show). */
  missingAgents(ids: readonly string[]): string[] {
    if (ids.length === 0) return [];
    try {
      const stmt = this.db.prepare('SELECT 1 FROM agents WHERE id = ?');
      return ids.filter((a) => !stmt.get(a));
    } catch { return []; }
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  }

  list(): Array<Pick<Board, 'id' | 'name' | 'packId' | 'version' | 'updatedAt'>> {
    return (this.db.prepare('SELECT id, name, pack_id, version, updated_at FROM boards ORDER BY id').all() as Array<{ id: string; name: string; pack_id: string | null; version: number; updated_at: number }>)
      .map((r) => ({ id: r.id, name: r.name, packId: r.pack_id, version: r.version, updatedAt: r.updated_at }));
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }
}
