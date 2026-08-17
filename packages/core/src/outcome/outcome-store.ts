/**
 * Persistence for outcome records. One row per run.
 *
 * Follows the house pattern: schema in `ensureSchema()` applied
 * idempotently on open, additive columns only, no migrations directory
 * (ADR-0002), `fromHandle` to share a connection with the other stores.
 *
 * Writes are UPSERT by `run_id`, not INSERT. Two paths re-run the tail of
 * `executeAgentDag` against the same run id — `options.resume` (used by the
 * durable Temporal path) and a Temporal activity retry — so an insert would
 * throw on the second pass and lose the record.
 */

import type { DatabaseSync } from 'node:sqlite';
import { openStoreDb } from '../sqlite-open.js';
import type { OutcomeRecord, OutcomeVerdict } from './types.js';

export interface OutcomeRow {
  runId: string;
  agentId: string;
  agentVersion: number;
  satisfied: OutcomeVerdict;
  basis: OutcomeRecord['evaluation']['basis'];
  confidence: OutcomeRecord['evaluation']['confidence'];
  evidenceCount: number;
  unknownCount: number;
  detectedAt: string;
  record: OutcomeRecord;
}

export interface ListOutcomesQuery {
  agentId?: string;
  /** Only rows whose verdict is not `yes`. The interesting ones. */
  unsatisfiedOnly?: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export class OutcomeStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): OutcomeStore {
    const store = Object.create(OutcomeStore.prototype) as OutcomeStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    // The scalar columns are denormalized out of `record_json` purely so
    // `sua outcome list` can filter and sort without deserializing every
    // record. `record_json` stays the source of truth.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outcome_records (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_version INTEGER NOT NULL,
        satisfied TEXT NOT NULL,
        basis TEXT NOT NULL,
        confidence TEXT NOT NULL,
        evidence_count INTEGER NOT NULL,
        unknown_count INTEGER NOT NULL,
        detected_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_outcome_agent_time ON outcome_records(agent_id, detected_at DESC)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_outcome_satisfied ON outcome_records(satisfied, detected_at DESC)`,
    );
  }

  /** Upsert by run id. Safe to call twice for the same run (resume / activity retry). */
  record(rec: OutcomeRecord): void {
    this.db.prepare(`
      INSERT INTO outcome_records (
        run_id, agent_id, agent_version, satisfied, basis, confidence,
        evidence_count, unknown_count, detected_at, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        agent_version = excluded.agent_version,
        satisfied = excluded.satisfied,
        basis = excluded.basis,
        confidence = excluded.confidence,
        evidence_count = excluded.evidence_count,
        unknown_count = excluded.unknown_count,
        detected_at = excluded.detected_at,
        record_json = excluded.record_json
    `).run(
      rec.runId,
      rec.agentId,
      rec.agentVersion,
      rec.evaluation.satisfied,
      rec.evaluation.basis,
      rec.evaluation.confidence,
      rec.observation.evidence.length,
      rec.unknowns.length,
      rec.detectedAt,
      JSON.stringify(rec),
    );
  }

  get(runId: string): OutcomeRow | null {
    const row = this.db.prepare(
      `SELECT * FROM outcome_records WHERE run_id = ?`,
    ).get(runId) as Record<string, unknown> | undefined;
    return row ? this.rowToOutcome(row) : null;
  }

  list(query: ListOutcomesQuery = {}): OutcomeRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.agentId) {
      where.push('agent_id = ?');
      params.push(query.agentId);
    }
    if (query.unsatisfiedOnly) {
      where.push(`satisfied != 'yes'`);
    }
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const sql = `
      SELECT * FROM outcome_records
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY detected_at DESC
      LIMIT ${limit}
    `;
    const rows = this.db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToOutcome(r));
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private rowToOutcome = (r: Record<string, unknown>): OutcomeRow => ({
    runId: r.run_id as string,
    agentId: r.agent_id as string,
    agentVersion: r.agent_version as number,
    satisfied: r.satisfied as OutcomeVerdict,
    basis: r.basis as OutcomeRecord['evaluation']['basis'],
    confidence: r.confidence as OutcomeRecord['evaluation']['confidence'],
    evidenceCount: r.evidence_count as number,
    unknownCount: r.unknown_count as number,
    detectedAt: r.detected_at as string,
    record: JSON.parse(r.record_json as string) as OutcomeRecord,
  });
}
