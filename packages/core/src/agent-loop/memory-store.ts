/**
 * Per-agent iteration log: one row per loop iteration, grouped by the
 * first iteration's run id. Lets a later iteration reach back to "what
 * did the previous attempt produce + which criteria failed" and lets the
 * dashboard show "this run was iteration 2 of 3" once a UI is wired.
 *
 * MVP: write-only from `AgentLoopRunner`. Reads come in a future PR
 * when we expose them in the dashboard / planner-side analytics.
 */

import { DatabaseSync } from 'node:sqlite';

export type AgentMemoryEvalStatus = 'passed' | 'failed' | 'no-criteria' | 'transient-error';

export interface AgentMemoryRow {
  agentId: string;
  rootRunId: string;
  iteration: number;
  runId: string;
  inputsJson: string | null;
  observationsJson: string | null;
  evalStatus: AgentMemoryEvalStatus;
  evalFailuresJson: string | null;
  createdAt: string;
}

export class AgentMemoryStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): AgentMemoryStore {
    const store = Object.create(AgentMemoryStore.prototype) as AgentMemoryStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        agent_id TEXT NOT NULL,
        root_run_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        run_id TEXT NOT NULL,
        inputs_json TEXT,
        observations_json TEXT,
        eval_status TEXT NOT NULL,
        eval_failures_json TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, root_run_id, iteration)
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_am_agent_time ON agent_memory(agent_id, created_at DESC)`);
  }

  recordIteration(row: Omit<AgentMemoryRow, 'createdAt'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_memory (
        agent_id, root_run_id, iteration, run_id,
        inputs_json, observations_json, eval_status, eval_failures_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      row.agentId,
      row.rootRunId,
      row.iteration,
      row.runId,
      row.inputsJson,
      row.observationsJson,
      row.evalStatus,
      row.evalFailuresJson,
    );
  }

  /** All iterations for one root run, ordered by iteration ASC. Used by tests + future UI surfaces. */
  listForRoot(agentId: string, rootRunId: string): AgentMemoryRow[] {
    const rows = this.db.prepare(`
      SELECT agent_id, root_run_id, iteration, run_id,
             inputs_json, observations_json, eval_status, eval_failures_json, created_at
      FROM agent_memory WHERE agent_id = ? AND root_run_id = ? ORDER BY iteration ASC
    `).all(agentId, rootRunId) as Array<Record<string, unknown>>;
    return rows.map(this.rowToMemory);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private rowToMemory = (r: Record<string, unknown>): AgentMemoryRow => ({
    agentId: r.agent_id as string,
    rootRunId: r.root_run_id as string,
    iteration: r.iteration as number,
    runId: r.run_id as string,
    inputsJson: (r.inputs_json as string | null) ?? null,
    observationsJson: (r.observations_json as string | null) ?? null,
    evalStatus: r.eval_status as AgentMemoryEvalStatus,
    evalFailuresJson: (r.eval_failures_json as string | null) ?? null,
    createdAt: r.created_at as string,
  });
}
