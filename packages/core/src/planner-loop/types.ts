import type { BuildPlan, PlanCriticError } from '../index.js';

/**
 * Phases of the planner loop, matching the refactor principles
 * (understand → compose → observe → evaluate → reflect → done|failed).
 * PR 1 wires compose/observe/evaluate/reflect/done/failed; `understand`
 * lights up in PR 3 when cross-run memory retrieval is added.
 */
export type LoopPhase = 'understand' | 'compose' | 'observe' | 'evaluate' | 'reflect' | 'done' | 'failed';

/**
 * One row in the loop's step log. The shape is uniform across primitives so
 * a per-run "graph of what was done" can be reconstructed from a single
 * append-only table (added as a SQLite store in PR 2). PR 1 just collects
 * the records on the outcome — no persistence yet.
 */
export interface LoopStepRecord {
  phase: LoopPhase;
  /** Name of the primitive that produced this step (e.g. "observe", "critique"). */
  primitive: string;
  /** The planner run-id this step ran against. For retries the new (retry) runId. */
  runId: string;
  ok: boolean;
  /** One-line summary, ≤ ~200 chars. */
  summary: string;
  tookMs: number;
  /** ISO timestamp. */
  at: string;
}

/**
 * The terminal output of one `runner.advance()` call. Maps 1:1 to the JSON
 * response the wizard polls for. Naming mirrors the existing status strings
 * (done / retrying / failed) so the dashboard route is a straight passthrough.
 */
export type LoopOutcome =
  | {
      kind: 'done';
      plan: BuildPlan;
      criticErrors?: PlanCriticError[];
      criticWarning?: string;
      steps: LoopStepRecord[];
    }
  | {
      kind: 'failed';
      error: string;
      rawPlan?: unknown;
      steps: LoopStepRecord[];
    }
  | {
      kind: 'retrying';
      retryRunId: string;
      attempt: number;
      criticErrors: PlanCriticError[];
      phase: string;
      steps: LoopStepRecord[];
    };
