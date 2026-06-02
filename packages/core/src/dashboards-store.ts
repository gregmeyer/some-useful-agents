import { DatabaseSync } from 'node:sqlite';
import { openStoreDb } from './sqlite-open.js';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { chmod600Safe } from './fs-utils.js';
import type { DashboardSection } from './packs-store.js';

export type { DashboardSection } from './packs-store.js';

export interface DashboardLayout {
  sections: DashboardSection[];
}

export interface Dashboard {
  /** Namespaced id: "<packId>:<dashboardId>" for pack-owned, "user:<slug>" for user-created. */
  id: string;
  /** NULL for user-created dashboards. */
  packId: string | null;
  name: string;
  layout: DashboardLayout;
  createdAt: number;
  updatedAt: number;
}

/**
 * SQLite-backed store for user + pack-owned dashboards.
 *
 * The "Default Dashboard" backing /pulse is NOT stored here — it's
 * computed on each request from the agent list filtered by
 * `pulseVisible`. This store only holds named, persisted dashboards.
 *
 * pack_id references packs.id but is NOT a SQL foreign key — that would
 * couple table-creation order between the two stores. PacksStore.deletePack
 * is responsible for clearing dependent dashboards explicitly via
 * DashboardsStore.deleteByPack before removing the pack row.
 */
export class DashboardsStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;
  public readonly dataRoot: string;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = openStoreDb(dbPath);
    this.ownsConnection = true;
    chmod600Safe(dbPath);
    this.dataRoot = dir;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): DashboardsStore {
    const store = Object.create(DashboardsStore.prototype) as DashboardsStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    (store as unknown as { dataRoot: string }).dataRoot = '';
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY,
        pack_id TEXT,
        name TEXT NOT NULL,
        layout_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dashboards_pack_id ON dashboards(pack_id)
    `);
  }

  /**
   * Insert or replace a dashboard. `createdAt` is preserved on update;
   * `updatedAt` is bumped to the current time.
   */
  upsertDashboard(args: {
    id: string;
    packId: string | null;
    name: string;
    layout: DashboardLayout;
  }): void {
    const now = Date.now();
    const existing = this.getDashboard(args.id);
    const createdAt = existing?.createdAt ?? now;
    this.db.prepare(`
      INSERT INTO dashboards (id, pack_id, name, layout_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        pack_id = excluded.pack_id,
        name = excluded.name,
        layout_json = excluded.layout_json,
        updated_at = excluded.updated_at
    `).run(
      args.id,
      args.packId,
      args.name,
      JSON.stringify(args.layout),
      createdAt,
      now,
    );
  }

  /** Replace just the layout; bumps updated_at. */
  updateLayout(id: string, layout: DashboardLayout): void {
    const result = this.db.prepare(`
      UPDATE dashboards SET layout_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(layout), Date.now(), id);
    if (result.changes === 0) throw new Error(`No dashboard with id "${id}"`);
  }

  getDashboard(id: string): Dashboard | null {
    const row = this.db.prepare(`SELECT * FROM dashboards WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToDashboard(row) : null;
  }

  listDashboards(): Dashboard[] {
    const rows = this.db.prepare(`SELECT * FROM dashboards ORDER BY name`).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToDashboard(r));
  }

  /** Dashboards owned by a specific pack. */
  listByPack(packId: string): Dashboard[] {
    const rows = this.db.prepare(`
      SELECT * FROM dashboards WHERE pack_id = ? ORDER BY name
    `).all(packId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToDashboard(r));
  }

  /** User-created dashboards (pack_id IS NULL). */
  listUserDashboards(): Dashboard[] {
    const rows = this.db.prepare(`
      SELECT * FROM dashboards WHERE pack_id IS NULL ORDER BY name
    `).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToDashboard(r));
  }

  deleteDashboard(id: string): void {
    this.db.prepare(`DELETE FROM dashboards WHERE id = ?`).run(id);
  }

  /** Delete every dashboard owned by a pack. Used by PacksStore.deletePack. */
  deleteByPack(packId: string): number {
    const result = this.db.prepare(`DELETE FROM dashboards WHERE pack_id = ?`).run(packId);
    return Number(result.changes);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private rowToDashboard(row: Record<string, unknown>): Dashboard {
    return {
      id: row.id as string,
      packId: (row.pack_id as string | null) ?? null,
      name: row.name as string,
      layout: JSON.parse(row.layout_json as string) as DashboardLayout,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }
}
