/**
 * Append-only SQLite store for `LoopStepRecord` rows produced by
 * `PlannerLoopRunner`. One row per primitive invocation; rows are keyed
 * by `(run_id, attempt, sequence)` so a per-run "graph of what was done"
 * can be reconstructed by SELECT … ORDER BY attempt, id.
 *
 * Lives in the same SQLite database as the planner-telemetry-store, so
 * the same `DatabaseSync` handle is reused via `fromHandle`. The runner
 * doesn't talk to the store directly — it returns step records on the
 * outcome and the dashboard route persists them (keeps the runner
 * easily testable without a DB).
 */

import { DatabaseSync } from 'node:sqlite';
import type { LoopStepRecord } from './types.js';

export interface StoredLoopStep extends LoopStepRecord {
  id: number;
  attempt: number;
  /** Compact JSON for things too big for `summary` — critic errors, smoke errors. Null when empty. */
  payloadJson: string | null;
}

export class PlannerLoopStepLogStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): PlannerLoopStepLogStore {
    const store = Object.create(PlannerLoopStepLogStore.prototype) as PlannerLoopStepLogStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS planner_loop_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        phase TEXT NOT NULL,
        primitive TEXT NOT NULL,
        ok INTEGER NOT NULL,
        summary TEXT,
        payload_json TEXT,
        took_ms INTEGER,
        at TEXT NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pls_run ON planner_loop_steps(run_id, attempt, id)`);
  }

  /**
   * Append a batch of steps for a single attempt. `attempt` is the planner
   * attempt number (1-indexed). All-or-nothing within a single transaction
   * so a partial write doesn't leave the log half-populated on a crash.
   */
  appendSteps(args: { runId: string; attempt: number; steps: LoopStepRecord[]; payloadByIdx?: Map<number, unknown> }): void {
    if (args.steps.length === 0) return;
    const insert = this.db.prepare(`
      INSERT INTO planner_loop_steps (run_id, attempt, phase, primitive, ok, summary, payload_json, took_ms, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec('BEGIN');
    try {
      for (let i = 0; i < args.steps.length; i++) {
        const s = args.steps[i];
        const payload = args.payloadByIdx?.get(i);
        const payloadStr = payload != null ? JSON.stringify(payload).slice(0, 4096) : null;
        insert.run(
          args.runId,
          args.attempt,
          s.phase,
          s.primitive,
          s.ok ? 1 : 0,
          s.summary.slice(0, 1024),
          payloadStr,
          s.tookMs,
          s.at,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Read all step rows for a run, ordered by attempt then insert order. */
  listForRun(runId: string): StoredLoopStep[] {
    const rows = this.db.prepare(`
      SELECT id, run_id, attempt, phase, primitive, ok, summary, payload_json, took_ms, at
      FROM planner_loop_steps WHERE run_id = ?
      ORDER BY attempt, id
    `).all(runId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      runId: r.run_id as string,
      attempt: r.attempt as number,
      phase: r.phase as StoredLoopStep['phase'],
      primitive: r.primitive as string,
      ok: !!r.ok,
      summary: (r.summary as string | null) ?? '',
      payloadJson: (r.payload_json as string | null) ?? null,
      tookMs: r.took_ms as number,
      at: r.at as string,
    }));
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }
}
