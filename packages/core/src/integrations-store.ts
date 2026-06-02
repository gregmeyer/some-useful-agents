import { DatabaseSync } from 'node:sqlite';
import { openStoreDb } from './sqlite-open.js';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { chmod600Safe } from './fs-utils.js';

/**
 * The kinds an integration row can declare. The store accepts any string so
 * new kinds (gmail, postgres, csv, …) can land without a schema bump — the
 * dashboard/route layer is responsible for validating that the kind is one
 * it knows how to render and dispatch.
 *
 * Today: lifted from the per-agent notify handlers so PR 1 is purely
 * additive — notify keeps working unchanged, and PR 2 will let agents
 * reference these integrations by id.
 */
export type IntegrationKind = 'slack' | 'webhook' | 'file' | (string & {});

export interface Integration {
  /** Namespaced slug: "user:<name>" for user-created, "<packId>:<name>" for pack-installed. */
  id: string;
  /** Pack ownership. NULL for user-created. Pack-installed integrations are not deletable until the pack is uninstalled. */
  packId: string | null;
  /** Driver kind (slack / webhook / file / ...) — see IntegrationKind. */
  kind: IntegrationKind;
  /** Human-readable display name, separate from the slug. */
  name: string;
  /** Kind-specific config. Never holds secret values — only URLs, paths, channel names, etc. */
  config: Record<string, unknown>;
  /** Names of secrets this integration resolves from the encrypted secrets store at use time. */
  secretRefs: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Allowed id format. Matches DashboardsStore's convention: lowercase with
 * `:` for namespacing. Enforced at the store boundary so callers can't
 * smuggle in arbitrary text that would later break URL routing.
 */
export const INTEGRATION_ID_RE = /^[a-z0-9][a-z0-9:_-]*$/;

/** SQLite-backed store for named external-service integrations. */
export class IntegrationsStore {
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

  static fromHandle(db: DatabaseSync): IntegrationsStore {
    const store = Object.create(IntegrationsStore.prototype) as IntegrationsStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    (store as unknown as { dataRoot: string }).dataRoot = '';
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS integrations (
        id TEXT PRIMARY KEY,
        pack_id TEXT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        secret_refs_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_integrations_kind ON integrations(kind)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_integrations_pack_id ON integrations(pack_id)`);
  }

  /**
   * Insert or replace. `createdAt` is preserved on update; `updatedAt` is bumped.
   * Throws on invalid id format so callers know early — the URL surface depends on it.
   */
  upsertIntegration(args: {
    id: string;
    packId: string | null;
    kind: IntegrationKind;
    name: string;
    config: Record<string, unknown>;
    secretRefs: string[];
  }): void {
    if (!INTEGRATION_ID_RE.test(args.id)) {
      throw new Error(`Invalid integration id "${args.id}": must match ${INTEGRATION_ID_RE}`);
    }
    if (!args.kind || typeof args.kind !== 'string') {
      throw new Error(`Integration kind is required`);
    }
    if (!args.name || typeof args.name !== 'string') {
      throw new Error(`Integration name is required`);
    }
    const now = Date.now();
    const existing = this.getIntegration(args.id);
    const createdAt = existing?.createdAt ?? now;
    this.db.prepare(`
      INSERT INTO integrations (id, pack_id, kind, name, config_json, secret_refs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        pack_id = excluded.pack_id,
        kind = excluded.kind,
        name = excluded.name,
        config_json = excluded.config_json,
        secret_refs_json = excluded.secret_refs_json,
        updated_at = excluded.updated_at
    `).run(
      args.id,
      args.packId,
      args.kind,
      args.name,
      JSON.stringify(args.config),
      JSON.stringify(args.secretRefs),
      createdAt,
      now,
    );
  }

  getIntegration(id: string): Integration | null {
    const row = this.db.prepare(`SELECT * FROM integrations WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToIntegration(row) : null;
  }

  listIntegrations(): Integration[] {
    const rows = this.db.prepare(`SELECT * FROM integrations ORDER BY name`).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToIntegration(r));
  }

  listByKind(kind: IntegrationKind): Integration[] {
    const rows = this.db.prepare(`SELECT * FROM integrations WHERE kind = ? ORDER BY name`).all(kind) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToIntegration(r));
  }

  listUserIntegrations(): Integration[] {
    const rows = this.db.prepare(`SELECT * FROM integrations WHERE pack_id IS NULL ORDER BY name`).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToIntegration(r));
  }

  /** Delete a single integration. Returns true if a row was removed. */
  deleteIntegration(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM integrations WHERE id = ?`).run(id);
    return Number(result.changes) > 0;
  }

  /** Delete every integration owned by a pack. Used by PacksStore.deletePack. */
  deleteByPack(packId: string): number {
    const result = this.db.prepare(`DELETE FROM integrations WHERE pack_id = ?`).run(packId);
    return Number(result.changes);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private rowToIntegration(row: Record<string, unknown>): Integration {
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(row.config_json as string) as Record<string, unknown>; } catch { /* default */ }
    let secretRefs: string[] = [];
    try {
      const parsed = JSON.parse(row.secret_refs_json as string) as unknown;
      if (Array.isArray(parsed)) secretRefs = parsed.filter((s) => typeof s === 'string');
    } catch { /* default */ }
    return {
      id: row.id as string,
      packId: (row.pack_id as string | null) ?? null,
      kind: row.kind as IntegrationKind,
      name: row.name as string,
      config,
      secretRefs,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }
}
