import { DatabaseSync } from 'node:sqlite';

type SqlValue = string | number | null | bigint | Uint8Array;
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Run, RunStatus } from './types.js';
import type {
  NodeExecutionRecord,
  NodeExecutionStatus,
  NodeErrorCategory,
} from './agent-v2-types.js';
import { chmod600Safe } from './fs-utils.js';

export interface RunStoreOptions {
  /**
   * Retention window, in days. Rows older than this are deleted on startup.
   * Default 30. Set `Infinity` to disable. Run output can contain secrets that
   * agents accidentally echoed, so holding it forever is an ambient leak.
   */
  retentionDays?: number;
}

/** Default retention window for run rows. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Default + cap for queryRuns pagination. */
export const DEFAULT_RUNS_LIMIT = 50;
export const MAX_RUNS_LIMIT = 500;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RUNS_LIMIT;
  if (limit < 0) return 0;
  return Math.min(Math.floor(limit), MAX_RUNS_LIMIT);
}

/**
 * Set of `runs` column names (lowercased) — used for idempotent schema
 * migrations. If a v1 DB is missing a v2-era column like `workflow_id`, we
 * `ALTER TABLE` it in. `PRAGMA table_info` is the safe way to detect
 * presence without re-running CREATE statements.
 */
function columnNames(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name.toLowerCase()));
}

export class RunStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string, options: RunStoreOptions = {}) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.ownsConnection = true;
    // Lock the DB file down to user-only. Agent stdout can contain secrets
    // and the DB is unencrypted plaintext; the only at-rest protection is
    // POSIX perms. Safe on Windows / network mounts via chmod600Safe.
    chmod600Safe(dbPath);

    this.ensureSchema();
    this.sweepExpired(options.retentionDays ?? DEFAULT_RETENTION_DAYS);
  }

  /**
   * Construct a RunStore sharing an existing DatabaseSync handle (e.g. with
   * AgentStore against the same file). This variant does NOT close the
   * connection on `close()` — whoever opened the handle owns shutdown.
   * Skips retention sweep by default; pass `options.retentionDays` to opt in.
   */
  static fromHandle(db: DatabaseSync, options: RunStoreOptions = {}): RunStore {
    const store = Object.create(RunStore.prototype) as RunStore;
    // `db` and `ownsConnection` are `readonly` on the class but we're
    // constructing via Object.create so direct assignment is fine.
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    if (options.retentionDays !== undefined) {
      store.sweepExpired(options.retentionDays);
    }
    return store;
  }

  /**
   * Create + migrate the `runs` and `node_executions` schemas. Idempotent;
   * safe to call on an existing DB. Runs on construction and when
   * attaching to a shared handle.
   */
  private ensureSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        agentName TEXT NOT NULL,
        status TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        result TEXT,
        exitCode INTEGER,
        error TEXT,
        triggeredBy TEXT NOT NULL
      )
    `);

    // v2 additions to `runs`: workflow_id + workflow_version. Nullable so
    // pre-v0.13 rows stay valid. `PRAGMA table_info` avoids re-adding on
    // every boot once the migration has run.
    const runCols = columnNames(this.db, 'runs');
    if (!runCols.has('workflow_id')) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN workflow_id TEXT`);
    }
    if (!runCols.has('workflow_version')) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN workflow_version INTEGER`);
    }
    if (!runCols.has('replayed_from_run_id')) {
      // For v0.13's `sua workflow replay`: link a replay run back to the
      // original so the UI can show a "replayed from X" breadcrumb.
      this.db.exec(`ALTER TABLE runs ADD COLUMN replayed_from_run_id TEXT`);
    }
    if (!runCols.has('replayed_from_node_id')) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN replayed_from_node_id TEXT`);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agentName);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_triggeredBy ON runs(triggeredBy);
      -- DESC ordering is the dashboard's runs-list default; without this
      -- the ORDER BY scans the whole table.
      CREATE INDEX IF NOT EXISTS idx_runs_startedAt ON runs(startedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id) WHERE workflow_id IS NOT NULL;
    `);

    // node_executions: per-node record within a DAG run. Keyed by
    // (runId, nodeId). See agent-v2-types.ts NodeExecutionRecord.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_executions (
        runId TEXT NOT NULL,
        nodeId TEXT NOT NULL,
        workflowVersion INTEGER NOT NULL,
        status TEXT NOT NULL,
        errorCategory TEXT,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        result TEXT,
        exitCode INTEGER,
        error TEXT,
        inputsJson TEXT,
        upstreamInputsJson TEXT,
        PRIMARY KEY (runId, nodeId),
        FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_node_executions_run ON node_executions(runId);
      -- Partial index: only populated rows. Lets 'sua workflow logs
      -- --category=timeout' do an index seek rather than a table scan.
      CREATE INDEX IF NOT EXISTS idx_node_executions_category
        ON node_executions(errorCategory) WHERE errorCategory IS NOT NULL;
    `);
  }

  /**
   * Delete any rows older than `retentionDays`. No-op if retentionDays is
   * not finite. Called from the constructor on startup; safe to call again.
   */
  sweepExpired(retentionDays: number): number {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
    const stmt = this.db.prepare(
      `DELETE FROM runs WHERE startedAt < datetime('now', ?)`,
    );
    const result = stmt.run(`-${Math.floor(retentionDays)} days`);
    return Number(result.changes ?? 0);
  }

  createRun(run: Run & { workflowId?: string; workflowVersion?: number; replayedFromRunId?: string; replayedFromNodeId?: string }): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, agentName, status, startedAt, completedAt, result, exitCode, error, triggeredBy,
                        workflow_id, workflow_version, replayed_from_run_id, replayed_from_node_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.id, run.agentName, run.status, run.startedAt,
      run.completedAt ?? null, run.result ?? null, run.exitCode ?? null,
      run.error ?? null, run.triggeredBy,
      run.workflowId ?? null, run.workflowVersion ?? null,
      run.replayedFromRunId ?? null, run.replayedFromNodeId ?? null,
    );
  }

  getRun(id: string): Run | null {
    const stmt = this.db.prepare('SELECT * FROM runs WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToRun(row);
  }

  updateRun(id: string, updates: Partial<Pick<Run, 'status' | 'completedAt' | 'result' | 'exitCode' | 'error'>>): void {
    const fields: string[] = [];
    const values: SqlValue[] = [];

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.completedAt !== undefined) { fields.push('completedAt = ?'); values.push(updates.completedAt); }
    if (updates.result !== undefined) { fields.push('result = ?'); values.push(updates.result); }
    if (updates.exitCode !== undefined) { fields.push('exitCode = ?'); values.push(updates.exitCode); }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error); }

    if (fields.length === 0) return;

    values.push(id);
    const stmt = this.db.prepare(`UPDATE runs SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  listRuns(filter?: { agentName?: string; status?: RunStatus; limit?: number }): Run[] {
    let sql = 'SELECT * FROM runs';
    const conditions: string[] = [];
    const values: SqlValue[] = [];

    if (filter?.agentName) {
      conditions.push('agentName = ?');
      values.push(filter.agentName);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      values.push(filter.status);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY startedAt DESC';

    if (filter?.limit) {
      sql += ' LIMIT ?';
      values.push(filter.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as Record<string, unknown>[];
    return rows.map(row => this.rowToRun(row));
  }

  /**
   * Richer query for the dashboard. Supports filter composition (AND across
   * fields, OR within `statuses`), pagination, and returns a total count
   * alongside the rows so callers can render "Showing N–M of T" without a
   * second query from the caller.
   */
  queryRuns(filter: {
    agentName?: string;
    statuses?: RunStatus[];
    triggeredBy?: string;
    q?: string;
    limit?: number;
    offset?: number;
  } = {}): { rows: Run[]; total: number } {
    const clauses: string[] = [];
    const values: SqlValue[] = [];

    if (filter.agentName) {
      clauses.push('agentName = ?');
      values.push(filter.agentName);
    }
    if (filter.triggeredBy) {
      clauses.push('triggeredBy = ?');
      values.push(filter.triggeredBy);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      const placeholders = filter.statuses.map(() => '?').join(', ');
      clauses.push(`status IN (${placeholders})`);
      values.push(...filter.statuses);
    }
    if (filter.q && filter.q.length > 0) {
      // Prefix match on run id OR substring match on agent name.
      // Escape SQL LIKE metacharacters in the user-supplied value so "%foo"
      // doesn't match the literal "%" character by accident.
      const escaped = filter.q.replace(/([\\%_])/g, '\\$1');
      clauses.push(`(id LIKE ? ESCAPE '\\' OR LOWER(agentName) LIKE ? ESCAPE '\\')`);
      values.push(`${escaped}%`, `%${escaped.toLowerCase()}%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const limit = clampLimit(filter.limit);
    const offset = Math.max(0, filter.offset ?? 0);

    const rowStmt = this.db.prepare(
      `SELECT * FROM runs ${where} ORDER BY startedAt DESC LIMIT ? OFFSET ?`,
    );
    const rows = rowStmt.all(...values, limit, offset) as Record<string, unknown>[];

    const countStmt = this.db.prepare(`SELECT COUNT(*) as c FROM runs ${where}`);
    const countRow = countStmt.get(...values) as { c: number | bigint };
    const total = Number(countRow.c);

    return { rows: rows.map((r) => this.rowToRun(r)), total };
  }

  /**
   * Distinct values for a given indexed column. Used to populate the
   * dashboard's filter dropdowns without hardcoding the enum. Column name
   * is restricted to an allowlist to avoid any SQL injection surface.
   */
  distinctValues(column: 'agentName' | 'status' | 'triggeredBy'): string[] {
    const stmt = this.db.prepare(
      `SELECT DISTINCT ${column} AS v FROM runs WHERE ${column} IS NOT NULL ORDER BY v`,
    );
    const rows = stmt.all() as Array<{ v: string }>;
    return rows.map((r) => r.v);
  }

  // -- Node execution CRUD (v2 DAG runs) --

  /** Insert a node_executions row. Duplicate (runId, nodeId) pairs throw. */
  createNodeExecution(record: NodeExecutionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO node_executions (
        runId, nodeId, workflowVersion, status, errorCategory,
        startedAt, completedAt, result, exitCode, error,
        inputsJson, upstreamInputsJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.runId, record.nodeId, record.workflowVersion, record.status,
      record.errorCategory ?? null,
      record.startedAt, record.completedAt ?? null,
      record.result ?? null, record.exitCode ?? null, record.error ?? null,
      record.inputsJson ?? null, record.upstreamInputsJson ?? null,
    );
  }

  updateNodeExecution(
    runId: string,
    nodeId: string,
    updates: Partial<Pick<NodeExecutionRecord,
      'status' | 'errorCategory' | 'completedAt' | 'result' | 'exitCode' | 'error' | 'inputsJson' | 'upstreamInputsJson'
    >>,
  ): void {
    const fields: string[] = [];
    const values: SqlValue[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.errorCategory !== undefined) { fields.push('errorCategory = ?'); values.push(updates.errorCategory); }
    if (updates.completedAt !== undefined) { fields.push('completedAt = ?'); values.push(updates.completedAt); }
    if (updates.result !== undefined) { fields.push('result = ?'); values.push(updates.result); }
    if (updates.exitCode !== undefined) { fields.push('exitCode = ?'); values.push(updates.exitCode); }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error); }
    if (updates.inputsJson !== undefined) { fields.push('inputsJson = ?'); values.push(updates.inputsJson); }
    if (updates.upstreamInputsJson !== undefined) { fields.push('upstreamInputsJson = ?'); values.push(updates.upstreamInputsJson); }
    if (fields.length === 0) return;

    values.push(runId, nodeId);
    const stmt = this.db.prepare(
      `UPDATE node_executions SET ${fields.join(', ')} WHERE runId = ? AND nodeId = ?`,
    );
    stmt.run(...values);
  }

  getNodeExecution(runId: string, nodeId: string): NodeExecutionRecord | null {
    const stmt = this.db.prepare(
      `SELECT * FROM node_executions WHERE runId = ? AND nodeId = ?`,
    );
    const row = stmt.get(runId, nodeId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToNodeExecution(row);
  }

  /**
   * All node executions for a run, ordered by startedAt (i.e. topological
   * execution order). Used by `sua workflow logs <runId>` and the
   * dashboard's per-run node table.
   */
  listNodeExecutions(runId: string): NodeExecutionRecord[] {
    const stmt = this.db.prepare(
      `SELECT * FROM node_executions WHERE runId = ? ORDER BY startedAt ASC`,
    );
    const rows = stmt.all(runId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNodeExecution(r));
  }

  /**
   * Node executions that failed with a given category. Used by
   * `sua workflow logs --category=timeout`.
   */
  queryNodeExecutionsByCategory(
    category: NodeErrorCategory,
    limit = 100,
  ): NodeExecutionRecord[] {
    const stmt = this.db.prepare(
      `SELECT * FROM node_executions WHERE errorCategory = ? ORDER BY startedAt DESC LIMIT ?`,
    );
    const rows = stmt.all(category, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNodeExecution(r));
  }

  close(): void {
    if (this.ownsConnection) {
      this.db.close();
    }
  }

  private rowToRun(row: Record<string, unknown>): Run {
    return {
      id: row.id as string,
      agentName: row.agentName as string,
      status: row.status as RunStatus,
      startedAt: row.startedAt as string,
      completedAt: row.completedAt as string | undefined,
      result: row.result as string | undefined,
      exitCode: row.exitCode as number | undefined,
      error: row.error as string | undefined,
      triggeredBy: row.triggeredBy as Run['triggeredBy'],
      workflowId: (row.workflow_id as string | null) ?? undefined,
      workflowVersion: (row.workflow_version as number | null) ?? undefined,
      replayedFromRunId: (row.replayed_from_run_id as string | null) ?? undefined,
      replayedFromNodeId: (row.replayed_from_node_id as string | null) ?? undefined,
    };
  }

  private rowToNodeExecution(row: Record<string, unknown>): NodeExecutionRecord {
    return {
      runId: row.runId as string,
      nodeId: row.nodeId as string,
      workflowVersion: row.workflowVersion as number,
      status: row.status as NodeExecutionStatus,
      errorCategory: (row.errorCategory as NodeErrorCategory | null) ?? undefined,
      startedAt: row.startedAt as string,
      completedAt: (row.completedAt as string | null) ?? undefined,
      result: (row.result as string | null) ?? undefined,
      exitCode: (row.exitCode as number | null) ?? undefined,
      error: (row.error as string | null) ?? undefined,
      inputsJson: (row.inputsJson as string | null) ?? undefined,
      upstreamInputsJson: (row.upstreamInputsJson as string | null) ?? undefined,
    };
  }
}
