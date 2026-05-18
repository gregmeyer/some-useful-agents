/**
 * Append-only SQLite store for committed planner outcomes. Feeds the
 * `understand` phase of `PlannerLoopRunner` (PR 3) — before composing a
 * new plan, retrieve up to N prior committed plans for goals with
 * similar intent/token-overlap and inject them as `<priorPlans>`
 * examples in the planner prompt.
 *
 * MVP: only committed plans are recorded (the user clicked Commit on the
 * wizard). Anti-examples (plans that exhausted retries and got dismissed)
 * are a follow-up — they need orchestrator-level tracking the wizard
 * doesn't surface yet.
 *
 * Lives in the same SQLite DB as planner-telemetry-store; reuses
 * `DatabaseSync` via `fromHandle` for compactness.
 */

import { DatabaseSync } from 'node:sqlite';
import type { BuildPlan } from '../build-plan-schema.js';

export interface PlannerMemoryRow {
  id: number;
  runId: string;
  goal: string;
  goalTokens: string;
  intent: string;
  plan: BuildPlan;
  committedAt: string;
  outcome: 'committed';
  attempts: number;
}

/**
 * Tokeniser: lowercase, strip punctuation, split on whitespace, drop very
 * short tokens. Used both at write time (cached in `goal_tokens`) and at
 * retrieval time (compared against the query goal). Deliberately simple —
 * embeddings come later when N grows and Jaccard stops being enough.
 */
export function tokeniseGoal(goal: string): string[] {
  return goal.toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export class PlannerMemoryStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): PlannerMemoryStore {
    const store = Object.create(PlannerMemoryStore.prototype) as PlannerMemoryStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS planner_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        goal_tokens TEXT NOT NULL,
        intent TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        outcome TEXT NOT NULL DEFAULT 'committed',
        attempts INTEGER NOT NULL DEFAULT 1
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_pm_intent_time ON planner_memory(intent, committed_at DESC)`);
  }

  /**
   * Record a committed plan. Called from the wizard's commit handler
   * after the agent(s) are persisted. `attempts` should come from
   * `planner_telemetry.plan_attempts` so retrieval can later rank by
   * "how clean was this attempt" (fewer attempts = better example).
   */
  recordCommit(args: { runId: string; goal: string; intent: string; plan: BuildPlan; attempts: number }): void {
    const tokens = tokeniseGoal(args.goal).join(' ');
    const goalTrimmed = args.goal.slice(0, 2048);
    this.db.prepare(`
      INSERT INTO planner_memory (run_id, goal, goal_tokens, intent, plan_json, committed_at, outcome, attempts)
      VALUES (?, ?, ?, ?, ?, datetime('now'), 'committed', ?)
    `).run(
      args.runId,
      goalTrimmed,
      tokens,
      args.intent,
      JSON.stringify(args.plan),
      args.attempts,
    );
  }

  /** All committed rows for a given intent, newest first. Used by retrieval to score candidates. */
  listByIntent(intent: string, limit = 50): PlannerMemoryRow[] {
    const rows = this.db.prepare(`
      SELECT id, run_id, goal, goal_tokens, intent, plan_json, committed_at, outcome, attempts
      FROM planner_memory WHERE intent = ? ORDER BY committed_at DESC, id DESC LIMIT ?
    `).all(intent, limit) as Array<Record<string, unknown>>;
    return rows.map(this.rowToMemory);
  }

  /** All committed rows regardless of intent, newest first. Used for first-attempt retrieval before intent is known. */
  listAll(limit = 50): PlannerMemoryRow[] {
    const rows = this.db.prepare(`
      SELECT id, run_id, goal, goal_tokens, intent, plan_json, committed_at, outcome, attempts
      FROM planner_memory ORDER BY committed_at DESC, id DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map(this.rowToMemory);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private rowToMemory = (r: Record<string, unknown>): PlannerMemoryRow => ({
    id: r.id as number,
    runId: r.run_id as string,
    goal: r.goal as string,
    goalTokens: r.goal_tokens as string,
    intent: r.intent as string,
    plan: JSON.parse(r.plan_json as string) as BuildPlan,
    committedAt: r.committed_at as string,
    outcome: r.outcome as 'committed',
    attempts: r.attempts as number,
  });
}
