import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { chmod600Safe } from './fs-utils.js';
import { SIGNAL_SIZES, TILE_FITS, type SignalSize, type TileFit } from './layout-plan-schema.js';

/**
 * Per-agent layout hint. All fields optional — an agent may have a
 * size hint but no tileFit, or vice versa. Renderer uses these as the
 * first link in a fallback chain:
 *
 *   hint.size      ?? agent.signal.size        ?? '1x1'
 *   hint.tileFit   ?? agent.outputWidget.tileFit ?? 'grow'
 *   hint.height    ?? (renderer default from size + tileFit)
 *
 * Hints are decoupled from the versioned `signal` and `outputWidget`
 * fields on the agent definition so that the Improve-layout wizard can
 * write them on every commit without bumping the agent's content
 * version. That keeps version history meaningful (real schema changes)
 * and lets layout-planner runs stay cheap and frequent.
 */
export interface LayoutHint {
  agentId: string;
  size?: SignalSize;
  tileFit?: TileFit;
  /** Pinned height in CSS pixels. Bounded 80..1200 to match the planner schema. */
  height?: number;
  updatedAt: number;
}

/** Partial-update payload — undefined fields are left untouched; null clears them. */
export interface LayoutHintPatch {
  size?: SignalSize | null;
  tileFit?: TileFit | null;
  height?: number | null;
}

const HEIGHT_MIN = 80;
const HEIGHT_MAX = 1200;

/**
 * SQLite-backed store for layout-planner hints. One row per agent that
 * has any hint set; agents without hints have no row at all (the
 * renderer falls back to the agent's signal/outputWidget defaults).
 *
 * agent_id is NOT a SQL foreign key — coupling table-creation order
 * between this store and AgentStore (which lives in `agent_v2`) would
 * mean either store failing to boot breaks the other. Cleanup of
 * orphaned hints (agent deleted but hint row remains) is best-effort
 * via `deleteForAgent`; renderers skip hints for missing agents
 * naturally because they iterate the agent list, not the hints table.
 */
export class LayoutHintsStore {
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

  static fromHandle(db: DatabaseSync): LayoutHintsStore {
    const store = Object.create(LayoutHintsStore.prototype) as LayoutHintsStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    (store as unknown as { dataRoot: string }).dataRoot = '';
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS layout_hints (
        agent_id TEXT PRIMARY KEY,
        size TEXT,
        tile_fit TEXT,
        height INTEGER,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /** Read a single agent's hint, or null if none is set. */
  getHint(agentId: string): LayoutHint | null {
    const row = this.db.prepare(`SELECT * FROM layout_hints WHERE agent_id = ?`)
      .get(agentId) as Record<string, unknown> | undefined;
    return row ? this.rowToHint(row) : null;
  }

  /**
   * Read hints for a list of agent ids in one query. Returns a Map keyed
   * by agent id; agents without a hint row are simply absent from the
   * map. Pulse + dashboard renderers call this once per render rather
   * than per-tile.
   */
  getHintsFor(agentIds: string[]): Map<string, LayoutHint> {
    const map = new Map<string, LayoutHint>();
    if (agentIds.length === 0) return map;
    const placeholders = agentIds.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM layout_hints WHERE agent_id IN (${placeholders})`,
    ).all(...agentIds) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const hint = this.rowToHint(row);
      map.set(hint.agentId, hint);
    }
    return map;
  }

  /** All hint rows. Mostly for tests and admin tooling. */
  listAll(): LayoutHint[] {
    const rows = this.db.prepare(`SELECT * FROM layout_hints ORDER BY agent_id`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToHint(r));
  }

  /**
   * Patch one agent's hint. Behaviour:
   * - `undefined` field   → leave existing value untouched
   * - `null` field        → clear the field (NULL in SQLite)
   * - concrete value      → set / overwrite
   *
   * After applying the patch, if every field is NULL the row is deleted
   * entirely (no point storing an empty hint).
   */
  setHint(agentId: string, patch: LayoutHintPatch): void {
    if (!agentId) throw new Error('LayoutHintsStore.setHint: agentId is required');
    this.validatePatch(patch);

    const existing = this.getHint(agentId);
    const next = {
      size: this.mergeField(existing?.size, patch.size),
      tileFit: this.mergeField(existing?.tileFit, patch.tileFit),
      height: this.mergeField(existing?.height, patch.height),
    };

    if (next.size === null && next.tileFit === null && next.height === null) {
      this.db.prepare(`DELETE FROM layout_hints WHERE agent_id = ?`).run(agentId);
      return;
    }

    this.db.prepare(`
      INSERT INTO layout_hints (agent_id, size, tile_fit, height, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        size = excluded.size,
        tile_fit = excluded.tile_fit,
        height = excluded.height,
        updated_at = excluded.updated_at
    `).run(agentId, next.size, next.tileFit, next.height, Date.now());
  }

  /** Drop all hints for one agent. Idempotent. */
  deleteForAgent(agentId: string): void {
    this.db.prepare(`DELETE FROM layout_hints WHERE agent_id = ?`).run(agentId);
  }

  /** Drop all hints. Test / dev tooling. */
  clear(): void {
    this.db.exec(`DELETE FROM layout_hints`);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private mergeField<T>(existing: T | undefined, patch: T | null | undefined): T | null {
    if (patch === undefined) return (existing ?? null) as T | null;
    return patch;
  }

  private validatePatch(patch: LayoutHintPatch): void {
    if (patch.size !== undefined && patch.size !== null && !SIGNAL_SIZES.includes(patch.size)) {
      throw new Error(`LayoutHintsStore: invalid size "${patch.size}" — must be one of ${SIGNAL_SIZES.join(', ')}`);
    }
    if (patch.tileFit !== undefined && patch.tileFit !== null && !TILE_FITS.includes(patch.tileFit)) {
      throw new Error(`LayoutHintsStore: invalid tileFit "${patch.tileFit}" — must be one of ${TILE_FITS.join(', ')}`);
    }
    if (patch.height !== undefined && patch.height !== null) {
      if (!Number.isInteger(patch.height) || patch.height < HEIGHT_MIN || patch.height > HEIGHT_MAX) {
        throw new Error(`LayoutHintsStore: height ${patch.height} out of range — integer in [${HEIGHT_MIN}, ${HEIGHT_MAX}]`);
      }
    }
  }

  private rowToHint(row: Record<string, unknown>): LayoutHint {
    return {
      agentId: row.agent_id as string,
      size: (row.size as SignalSize | null) ?? undefined,
      tileFit: (row.tile_fit as TileFit | null) ?? undefined,
      height: (row.height as number | null) ?? undefined,
      updatedAt: row.updated_at as number,
    };
  }
}
