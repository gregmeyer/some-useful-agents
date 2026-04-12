import { DatabaseSync } from 'node:sqlite';

type SqlValue = string | number | null | bigint | Uint8Array;
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Run, RunStatus } from './types.js';

export class RunStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
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
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agentName);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    `);
  }

  createRun(run: Run): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, agentName, status, startedAt, completedAt, result, exitCode, error, triggeredBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(run.id, run.agentName, run.status, run.startedAt,
      run.completedAt ?? null, run.result ?? null, run.exitCode ?? null,
      run.error ?? null, run.triggeredBy);
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

  close(): void {
    this.db.close();
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
    };
  }
}
