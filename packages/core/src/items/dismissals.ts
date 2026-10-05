/**
 * Items you've dismissed from Today: off it until they change. An item comes
 * back when something newer happens to it than your dismissal (a new failure
 * run, an edited draft), so dismissing isn't hiding forever.
 */
import type { DatabaseSync } from 'node:sqlite';

export class ItemDismissals {
  private db!: DatabaseSync;

  static fromHandle(db: DatabaseSync): ItemDismissals {
    const s = Object.create(ItemDismissals.prototype) as ItemDismissals;
    s.db = db;
    s.ensureSchema();
    return s;
  }

  private ensureSchema(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS item_dismissals (
      item_id TEXT PRIMARY KEY,
      dismissed_at TEXT NOT NULL,
      by TEXT NOT NULL DEFAULT 'you'
    )`);
  }

  dismiss(itemId: string, by = 'you', at = new Date().toISOString()): void {
    this.db.prepare(`INSERT INTO item_dismissals (item_id, dismissed_at, by) VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET dismissed_at = excluded.dismissed_at, by = excluded.by`).run(itemId, at, by);
  }

  undismiss(itemId: string): boolean {
    return Number(this.db.prepare('DELETE FROM item_dismissals WHERE item_id = ?').run(itemId).changes) === 1;
  }

  /** item id → when it was dismissed. */
  all(): Map<string, string> {
    return new Map((this.db.prepare('SELECT item_id, dismissed_at FROM item_dismissals').all() as Array<{ item_id: string; dismissed_at: string }>)
      .map((r) => [r.item_id, r.dismissed_at]));
  }
}

/** Is an item still dismissed: dismissed at or after its latest event? */
export function stillDismissed(itemAt: string, dismissedAt: string | number | undefined): boolean {
  if (dismissedAt === undefined) return false;
  const d = typeof dismissedAt === 'number' ? dismissedAt : Date.parse(dismissedAt);
  const a = Date.parse(itemAt);
  return Number.isFinite(d) && (!Number.isFinite(a) || a <= d);
}
