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

export const boardItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...itemBase, kind: z.literal('agent'), agentId: z.string().min(1).max(128), fit: z.enum(['grow', 'scroll']).optional() }).strict(),
  z.object({ ...itemBase, kind: z.literal('heading'), text: z.string().min(1).max(120) }).strict(),
  z.object({ ...itemBase, kind: z.literal('note'), text: z.string().min(1).max(4000) }).strict(),
  z.object({ ...itemBase, kind: z.literal('system'), tileId: z.string().regex(/^_[a-z0-9_-]+$/i) }).strict(),
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

/** A short fingerprint of a board's items (for comparisons and tests). */
export function boardItemsHash(items: readonly BoardItem[]): string {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12);
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
  }

  get(id: string): Board | undefined {
    const row = this.db.prepare('SELECT id, name, pack_id, items_json, version, updated_at FROM boards WHERE id = ?').get(id) as
      | { id: string; name: string; pack_id: string | null; items_json: string; version: number; updated_at: number }
      | undefined;
    if (!row) return undefined;
    let items: BoardItem[] = [];
    try { items = normalizeBoardItems(JSON.parse(row.items_json)); } catch { items = []; }
    return { id: row.id, name: row.name, packId: row.pack_id, items, version: row.version, updatedAt: row.updated_at };
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

  /** Put back the items from before the last save (Undo twice = Redo). */
  undo(id: string, expectedVersion?: number): Board {
    const row = this.db.prepare('SELECT previous_items_json, version FROM boards WHERE id = ?').get(id) as
      | { previous_items_json: string | null; version: number } | undefined;
    if (!row || !row.previous_items_json) throw new Error('There is no earlier layout to go back to.');
    if (expectedVersion !== undefined && expectedVersion !== row.version) throw new BoardConflictError(id, row.version);
    this.db.prepare('UPDATE boards SET items_json = previous_items_json, previous_items_json = items_json, version = version + 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
    return this.get(id)!;
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
