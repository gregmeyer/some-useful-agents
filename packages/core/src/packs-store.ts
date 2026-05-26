import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { chmod600Safe } from './fs-utils.js';

/**
 * One section within a dashboard layout — a titled, ordered list of agent
 * IDs to render as tiles. A dashboard is just an ordered list of these.
 *
 * `placements` is an optional per-agent override map keyed by agent id.
 * When set, it overrides the agent-global LayoutHintsStore entry FOR THIS
 * SECTION ONLY — so two dashboards can size the same agent differently.
 * Absent / missing keys fall through to the agent-global hint, then to
 * the agent's declared signal.size / outputWidget.tileFit, then to the
 * renderer defaults. Width is still grid-column-based; placements only
 * touch height-related fields.
 */
export interface DashboardSectionPlacement {
  size?: '1x1' | '2x1' | '1x2' | '2x2';
  tileFit?: 'grow' | 'scroll';
  /** Pinned height in CSS pixels. Bounded 80..1200 to match LayoutHintsStore. */
  height?: number;
}

export interface DashboardSection {
  title: string;
  agentIds: string[];
  placements?: Record<string, DashboardSectionPlacement>;
}

/**
 * Pack-author-declared dashboard. The `id` is namespaced when stored
 * (see DashboardsStore — `<packId>:<dashboardId>`); the bare id here is
 * what appears in the manifest YAML.
 */
export interface PackDashboardManifest {
  id: string;
  name: string;
  sections: DashboardSection[];
}

/**
 * Reference to an agent the pack expects/contributes. The `yaml` field is
 * an optional repo-relative path used by `PacksStore.install` (added in
 * PR 2) to upsert missing agents on install.
 */
export interface PackAgentRef {
  id: string;
  yaml?: string;
}

/**
 * Full pack manifest as stored in `packs.manifest_json`. Mirrors the
 * YAML shape that ships in `packages/core/packs/<id>.yaml`.
 */
export interface PackManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  agents?: PackAgentRef[];
  dashboards?: PackDashboardManifest[];
}

export interface Pack {
  id: string;
  name: string;
  description: string | null;
  version: string;
  author: string | null;
  /** "builtin", "user", or a URL string. */
  source: string;
  manifest: PackManifest;
  /** Epoch ms when installed; null = registered but not installed. */
  installedAt: number | null;
}

/**
 * SQLite-backed store for widget packs.
 *
 * Schema lives in this file's `ensureSchema()`; data and UI logic are
 * elsewhere. Install/uninstall semantics (creating dashboards from the
 * manifest, upserting missing agents) come in a follow-up PR — this
 * store deals only in raw CRUD + an installed_at flag.
 *
 * Connection model mirrors AgentStore: own a connection (default) or
 * share via `fromHandle(db)`.
 */
export class PacksStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;
  public readonly dataRoot: string;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.ownsConnection = true;
    chmod600Safe(dbPath);
    this.dataRoot = dir;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): PacksStore {
    const store = Object.create(PacksStore.prototype) as PacksStore;
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
      CREATE TABLE IF NOT EXISTS packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        version TEXT NOT NULL,
        author TEXT,
        source TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        installed_at INTEGER
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_packs_installed
      ON packs(installed_at) WHERE installed_at IS NOT NULL
    `);
  }

  /**
   * Insert or replace a pack registration. Preserves `installed_at` when
   * upserting an existing row — re-registering a built-in (e.g. on daemon
   * restart with an updated bundled manifest) shouldn't toggle install state.
   */
  upsertPack(args: {
    id: string;
    name: string;
    description?: string | null;
    version: string;
    author?: string | null;
    source: string;
    manifest: PackManifest;
  }): void {
    const existing = this.getPack(args.id);
    const installedAt = existing?.installedAt ?? null;
    this.db.prepare(`
      INSERT INTO packs (id, name, description, version, author, source, manifest_json, installed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        version = excluded.version,
        author = excluded.author,
        source = excluded.source,
        manifest_json = excluded.manifest_json
    `).run(
      args.id,
      args.name,
      args.description ?? null,
      args.version,
      args.author ?? null,
      args.source,
      JSON.stringify(args.manifest),
      installedAt,
    );
  }

  getPack(id: string): Pack | null {
    const row = this.db.prepare(`SELECT * FROM packs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToPack(row) : null;
  }

  /** All packs (installed and available), ordered by name. */
  listPacks(): Pack[] {
    const rows = this.db.prepare(`SELECT * FROM packs ORDER BY name`).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToPack(r));
  }

  /** Only packs with a non-null `installed_at`. */
  listInstalled(): Pack[] {
    const rows = this.db.prepare(`
      SELECT * FROM packs WHERE installed_at IS NOT NULL ORDER BY name
    `).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToPack(r));
  }

  /** Mark a pack as installed at the given epoch ms (default: now). */
  markInstalled(id: string, when: number = Date.now()): void {
    const result = this.db.prepare(`UPDATE packs SET installed_at = ? WHERE id = ?`).run(when, id);
    if (result.changes === 0) throw new Error(`No pack with id "${id}" to install`);
  }

  /** Set `installed_at = NULL`. Idempotent — no-op if pack is already uninstalled. */
  markUninstalled(id: string): void {
    this.db.prepare(`UPDATE packs SET installed_at = NULL WHERE id = ?`).run(id);
  }

  /**
   * Hard-delete a pack registration. Cascades to dashboards via the FK
   * declared in DashboardsStore. Use when removing a built-in pack that
   * was renamed or retired; for "user uninstalled it", prefer
   * `markUninstalled`.
   */
  deletePack(id: string): void {
    this.db.prepare(`DELETE FROM packs WHERE id = ?`).run(id);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private rowToPack(row: Record<string, unknown>): Pack {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      version: row.version as string,
      author: (row.author as string | null) ?? null,
      source: row.source as string,
      manifest: JSON.parse(row.manifest_json as string) as PackManifest,
      installedAt: (row.installed_at as number | null) ?? null,
    };
  }
}
