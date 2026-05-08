/**
 * Telemetry store for build-planner runs.
 *
 * The planner pipeline (`POST /agents/build` → poll → commit) was a black
 * box: we couldn't measure how often plans extracted cleanly, how often
 * autoFixYaml had to rescue an LLM mistake, or how the commit-on-first-attempt
 * rate moved as we shipped quality fixes. This store records one row per
 * planner run with timing + failure-class counters so `/metrics/planner`
 * can render aggregates and future critic-loop / catalog-filter PRs have
 * a baseline to compare against.
 *
 * One row per planner run, keyed by `run_id` (foreign-keyed to runs.id with
 * ON DELETE CASCADE so retention sweeps clean up telemetry too).
 *
 * Connection model mirrors PacksStore: own a connection (default) or share
 * via `fromHandle(db)`. Schema is created lazily on construction.
 */

import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { chmod600Safe } from './fs-utils.js';

/** A planner-run telemetry row. */
export interface PlannerTelemetryRow {
  runId: string;
  /** How many times the planner was invoked for this goal. PR1 always 1; PR2's critic-loop will increment. */
  planAttempts: number;
  /** Outcome of the JSON-extract + schema-validate step. */
  planExtractStatus: 'pending' | 'ok' | 'no-json' | 'schema-invalid';
  /** Number of structural-validation errors flagged (from PR2's critiquePlan). 0 in PR1. */
  planValidationErrors: number;
  /** Number of autoFixYaml rescues applied across the plan's newAgents. */
  planAutofixCount: number;
  /** End-to-end planner-agent run latency, ms. Set when the planner agent finishes. */
  timeToPlanMs: number | null;
  /** Time from planner-run start to user-clicked-Commit, ms. Set on commit. */
  timeToCommitMs: number | null;
  /** ISO timestamp of the commit click; null if the user abandoned the plan. */
  committedAt: string | null;
  /** Original goal text (truncated to 1KB). Useful for spotting failure clusters by intent. */
  goal: string | null;
  /** Plan's classified intent (`agent` / `dashboard-existing` / etc.); null until extract succeeds. */
  intent: string | null;
  /** ISO timestamp the row was first inserted. */
  createdAt: string;
}

/** Aggregate stats over a recent window — feeds the `/metrics/planner` view. */
export interface PlannerTelemetryStats {
  windowDays: number;
  totalAttempted: number;
  totalCommitted: number;
  commitRate: number;
  /** How often the very first extract attempt produced a schema-valid plan. The PR1 baseline metric. */
  firstAttemptCleanRate: number;
  averageAttempts: number;
  averageAutofixCount: number;
  averageValidationErrors: number;
  p50PlanMs: number | null;
  p95PlanMs: number | null;
  /** Histogram of plan_extract_status values (excluding `pending`). */
  extractStatusHistogram: Record<string, number>;
}

export class PlannerTelemetryStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.ownsConnection = true;
    chmod600Safe(dbPath);
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): PlannerTelemetryStore {
    const store = Object.create(PlannerTelemetryStore.prototype) as PlannerTelemetryStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS planner_telemetry (
        run_id TEXT PRIMARY KEY,
        plan_attempts INTEGER NOT NULL DEFAULT 1,
        plan_extract_status TEXT NOT NULL DEFAULT 'pending',
        plan_validation_errors INTEGER NOT NULL DEFAULT 0,
        plan_autofix_count INTEGER NOT NULL DEFAULT 0,
        time_to_plan_ms INTEGER,
        time_to_commit_ms INTEGER,
        committed_at TEXT,
        goal TEXT,
        intent TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_planner_telemetry_created
        ON planner_telemetry(created_at DESC)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_planner_telemetry_committed
        ON planner_telemetry(committed_at) WHERE committed_at IS NOT NULL
    `);
  }

  /** Insert a row for a freshly-started planner run. Idempotent — re-runs no-op via INSERT OR IGNORE. */
  recordStart(runId: string, goal: string): void {
    const truncated = goal.length > 1024 ? goal.slice(0, 1024) : goal;
    this.db.prepare(`
      INSERT OR IGNORE INTO planner_telemetry (run_id, goal, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(runId, truncated);
  }

  /**
   * Record the outcome of the extract+validate+autofix step. Called from the
   * poll endpoint once the planner agent finishes. `intent` is the extracted
   * BuildPlan.intent (null when extract failed).
   */
  recordExtract(args: {
    runId: string;
    status: 'ok' | 'no-json' | 'schema-invalid';
    autofixCount: number;
    validationErrors?: number;
    timeToPlanMs: number;
    intent?: string | null;
  }): void {
    this.db.prepare(`
      UPDATE planner_telemetry
      SET plan_extract_status = ?,
          plan_autofix_count = ?,
          plan_validation_errors = COALESCE(?, plan_validation_errors),
          time_to_plan_ms = ?,
          intent = ?
      WHERE run_id = ?
    `).run(
      args.status,
      args.autofixCount,
      args.validationErrors ?? null,
      args.timeToPlanMs,
      args.intent ?? null,
      args.runId,
    );
  }

  /**
   * Increment plan_attempts (used by PR2's critic-retry loop). PR1 callers
   * leave it at the default 1.
   */
  incrementAttempts(runId: string): void {
    this.db.prepare(`
      UPDATE planner_telemetry SET plan_attempts = plan_attempts + 1 WHERE run_id = ?
    `).run(runId);
  }

  /** Record that the user clicked Commit on this plan. */
  recordCommit(runId: string, timeToCommitMs: number): void {
    this.db.prepare(`
      UPDATE planner_telemetry
      SET committed_at = datetime('now'),
          time_to_commit_ms = ?
      WHERE run_id = ?
    `).run(timeToCommitMs, runId);
  }

  /** Read a single row (mainly for tests + debugging). */
  get(runId: string): PlannerTelemetryRow | null {
    const row = this.db.prepare(`SELECT * FROM planner_telemetry WHERE run_id = ?`).get(runId) as Record<string, unknown> | undefined;
    return row ? this.rowToTelemetry(row) : null;
  }

  /** Most-recent rows, ordered newest first. Caps at `limit` (default 50). */
  listRecent(limit = 50): PlannerTelemetryRow[] {
    const rows = this.db.prepare(`
      SELECT * FROM planner_telemetry ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToTelemetry(r));
  }

  /** Aggregate stats over the last `windowDays` (default 7). */
  computeStats(windowDays = 7): PlannerTelemetryStats {
    const cutoff = `-${Math.max(1, Math.floor(windowDays))} days`;
    const rows = this.db.prepare(`
      SELECT * FROM planner_telemetry WHERE created_at >= datetime('now', ?)
    `).all(cutoff) as Array<Record<string, unknown>>;

    const total = rows.length;
    const committed = rows.filter((r) => r.committed_at != null).length;
    const cleanFirst = rows.filter((r) => r.plan_extract_status === 'ok' && Number(r.plan_attempts ?? 1) === 1).length;

    const sumAttempts = rows.reduce((acc, r) => acc + Number(r.plan_attempts ?? 1), 0);
    const sumAutofix = rows.reduce((acc, r) => acc + Number(r.plan_autofix_count ?? 0), 0);
    const sumValidation = rows.reduce((acc, r) => acc + Number(r.plan_validation_errors ?? 0), 0);

    const planMsValues = rows
      .map((r) => r.time_to_plan_ms)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
    const p50 = planMsValues.length ? planMsValues[Math.floor(planMsValues.length * 0.5)] : null;
    const p95 = planMsValues.length ? planMsValues[Math.min(planMsValues.length - 1, Math.floor(planMsValues.length * 0.95))] : null;

    const histogram: Record<string, number> = {};
    for (const r of rows) {
      const status = String(r.plan_extract_status ?? 'pending');
      if (status === 'pending') continue;
      histogram[status] = (histogram[status] ?? 0) + 1;
    }

    return {
      windowDays,
      totalAttempted: total,
      totalCommitted: committed,
      commitRate: total > 0 ? committed / total : 0,
      firstAttemptCleanRate: total > 0 ? cleanFirst / total : 0,
      averageAttempts: total > 0 ? sumAttempts / total : 0,
      averageAutofixCount: total > 0 ? sumAutofix / total : 0,
      averageValidationErrors: total > 0 ? sumValidation / total : 0,
      p50PlanMs: p50,
      p95PlanMs: p95,
      extractStatusHistogram: histogram,
    };
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private rowToTelemetry(r: Record<string, unknown>): PlannerTelemetryRow {
    return {
      runId: String(r.run_id),
      planAttempts: Number(r.plan_attempts ?? 1),
      planExtractStatus: String(r.plan_extract_status ?? 'pending') as PlannerTelemetryRow['planExtractStatus'],
      planValidationErrors: Number(r.plan_validation_errors ?? 0),
      planAutofixCount: Number(r.plan_autofix_count ?? 0),
      timeToPlanMs: r.time_to_plan_ms == null ? null : Number(r.time_to_plan_ms),
      timeToCommitMs: r.time_to_commit_ms == null ? null : Number(r.time_to_commit_ms),
      committedAt: r.committed_at == null ? null : String(r.committed_at),
      goal: r.goal == null ? null : String(r.goal),
      intent: r.intent == null ? null : String(r.intent),
      createdAt: String(r.created_at),
    };
  }
}
