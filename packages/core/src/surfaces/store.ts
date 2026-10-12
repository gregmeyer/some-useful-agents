/**
 * Surface documents, versioned. Every change is a new row carrying the doc,
 * the ops that made it, who made it and why, so a surface can list what
 * changed and undo it. Version 0 is the default (never stored).
 */
import type { DatabaseSync } from 'node:sqlite';
import { openStoreDb } from '../sqlite-open.js';
import { applySurfaceOps } from './ops.js';
import { defaultSurface } from './defaults.js';
import { surfaceDocSchema, type SurfaceActor, type SurfaceDoc, type SurfaceOp } from './schema.js';

export interface SurfaceVersion {
  surfaceId: string;
  version: number;
  doc: SurfaceDoc;
  actor: SurfaceActor | 'default';
  reason: string;
  ops: SurfaceOp[];
  at: string;
}

/** Someone else changed the surface since you read it. */
export class SurfaceVersionConflict extends Error {
  constructor(readonly expected: number, readonly current: number) {
    super(`The surface changed since you opened it (now v${String(current)}, you had v${String(expected)}).`);
    this.name = 'SurfaceVersionConflict';
  }
}

export class SurfaceStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): SurfaceStore {
    const store = Object.create(SurfaceStore.prototype) as SurfaceStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS surface_versions (
        surface_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        doc_json TEXT NOT NULL,
        ops_json TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (surface_id, version)
      );
    `);
  }

  /** Forget a surface and its history (its owner is gone). */
  remove(surfaceId: string): void {
    this.db.prepare('DELETE FROM surface_versions WHERE surface_id = ?').run(surfaceId);
  }

  /** The surface now (the default, as v0, before its first change). */
  current(surfaceId: string): SurfaceVersion {
    const row = this.db.prepare('SELECT * FROM surface_versions WHERE surface_id = ? ORDER BY version DESC LIMIT 1').get(surfaceId) as Record<string, unknown> | undefined;
    return row ? this.toVersion(row) : { surfaceId, version: 0, doc: defaultSurface(surfaceId), actor: 'default', reason: 'The default', ops: [], at: new Date(0).toISOString() };
  }

  get(surfaceId: string, version: number): SurfaceVersion | undefined {
    if (version === 0) return { ...this.current(surfaceId), version: 0, doc: defaultSurface(surfaceId), actor: 'default', reason: 'The default', ops: [] };
    const row = this.db.prepare('SELECT * FROM surface_versions WHERE surface_id = ? AND version = ?').get(surfaceId, version) as Record<string, unknown> | undefined;
    return row ? this.toVersion(row) : undefined;
  }

  /** Newest first. */
  history(surfaceId: string, limit = 50): SurfaceVersion[] {
    return (this.db.prepare('SELECT * FROM surface_versions WHERE surface_id = ? ORDER BY version DESC LIMIT ?').all(surfaceId, limit) as Array<Record<string, unknown>>).map((r) => this.toVersion(r));
  }

  /**
   * Apply ops as one new version. `expectedVersion` refuses a change made
   * against an older surface; `approved` lets an agent's structural change
   * through once you've said yes.
   */
  apply(surfaceId: string, ops: readonly unknown[], actor: SurfaceActor, reason: string, opts: { expectedVersion?: number; approved?: boolean; now?: Date } = {}): SurfaceVersion {
    const cur = this.current(surfaceId);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== cur.version) throw new SurfaceVersionConflict(opts.expectedVersion, cur.version);
    const doc = applySurfaceOps(cur.doc, ops, actor, { ...(opts.approved ? { approved: true } : {}), ...(opts.now ? { now: opts.now } : {}) });
    return this.write(surfaceId, cur.version + 1, doc, ops as SurfaceOp[], actor, reason, opts.now);
  }

  /** Undo: a new version whose doc is an earlier one's. */
  restore(surfaceId: string, toVersion: number, actor: SurfaceActor, opts: { now?: Date } = {}): SurfaceVersion {
    const target = this.get(surfaceId, toVersion);
    if (!target) throw new Error(`No version ${String(toVersion)} of "${surfaceId}".`);
    const cur = this.current(surfaceId);
    return this.write(surfaceId, cur.version + 1, target.doc, [], actor, `Back to v${String(toVersion)}`, opts.now);
  }

  private write(surfaceId: string, version: number, doc: SurfaceDoc, ops: SurfaceOp[], actor: SurfaceActor, reason: string, now?: Date): SurfaceVersion {
    const at = (now ?? new Date()).toISOString();
    const text = reason.trim().slice(0, 280) || 'No reason given';
    this.db.prepare('INSERT INTO surface_versions (surface_id, version, doc_json, ops_json, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(surfaceId, version, JSON.stringify(doc), JSON.stringify(ops), actor, text, at);
    return { surfaceId, version, doc, actor, reason: text, ops, at };
  }

  // A method, not an arrow field: fromHandle skips field initializers.
  private toVersion(r: Record<string, unknown>): SurfaceVersion {
    return {
      surfaceId: String(r.surface_id),
      version: Number(r.version),
      doc: surfaceDocSchema.parse(JSON.parse(String(r.doc_json))),
      actor: String(r.actor) as SurfaceActor,
      reason: String(r.reason),
      ops: JSON.parse(String(r.ops_json)) as SurfaceOp[],
      at: String(r.created_at),
    };
  }
}
