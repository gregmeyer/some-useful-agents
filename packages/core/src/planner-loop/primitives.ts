import { buildPlanSchema, critiquePlan, extractPlanJson, type BuildPlan, type PlanCriticError } from '../index.js';
import type { LoopPhase, LoopStepRecord } from './types.js';

/**
 * Result of the `observe` primitive: take the raw planner-run output and
 * try to land on a validated `BuildPlan`. Reports a telemetry-friendly
 * status string so the caller (and PR 2's step log) can record the right
 * shape without re-walking the result.
 */
export type ObserveStatus = 'ok' | 'no-json' | 'json-parse-error' | 'schema-invalid';

export interface ObserveResult {
  status: ObserveStatus;
  /** Populated only when status === 'ok'. */
  plan?: BuildPlan;
  /** Raw parsed JSON (before schema validation) — surfaced on schema-invalid so the UI can show what came back. */
  rawPlan?: unknown;
  /** Human-readable error for failure surfaces. */
  errorMessage?: string;
  /** Count of zod issues (only meaningful on schema-invalid). */
  validationErrors: number;
}

/**
 * `observe` — extract + parse + schema-validate the planner's raw output.
 *
 * Mirrors the inline extract/parse/validate sequence in run-now-build.ts so
 * the loop runner can stay as the only caller after PR 1 lands. Does NOT
 * autofix YAML — the runner does that as a separate step so the autofix
 * count is independently observable for telemetry.
 *
 * `nodeExecResult` lets the caller fall back to the plan-node's per-node
 * output when the run's top-level result doesn't carry `<plan>…</plan>`
 * (matches the existing fallback at run-now-build.ts:828-830).
 */
export function observePlan(args: { runResult: string; nodeExecResult?: string }): ObserveResult {
  let resultText = args.runResult;
  if (!resultText.includes('<plan>') && args.nodeExecResult) {
    resultText = args.nodeExecResult;
  }
  const planText = extractPlanJson(resultText);
  if (!planText) {
    return { status: 'no-json', errorMessage: 'Planner did not produce a <plan>…</plan> block.', validationErrors: 0 };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(planText); }
  catch (e) {
    return { status: 'json-parse-error', errorMessage: `Plan JSON parse failed: ${(e as Error).message}`, validationErrors: 0 };
  }
  const result = buildPlanSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return {
      status: 'schema-invalid',
      rawPlan: parsed,
      errorMessage: `Plan validation failed: ${issues}`,
      validationErrors: result.error.issues.length,
    };
  }
  return { status: 'ok', plan: result.data, validationErrors: 0 };
}

/**
 * Walk `plan.newAgents`, apply `autoFixYaml` to each, return the cleaned
 * plan and a count of how many YAMLs were actually modified.
 *
 * `autoFixYaml` lives in the dashboard package (next to the route that
 * uses it), so the runner takes it as a constructor dependency rather
 * than importing it here.
 */
export function autofixPlanYamls(plan: BuildPlan, autoFixYaml: (yaml: string) => string): { plan: BuildPlan; autofixCount: number } {
  let autofixCount = 0;
  const cleanedNewAgents = plan.newAgents.map((a) => {
    const fixed = autoFixYaml(a.yaml);
    if (fixed !== a.yaml) autofixCount++;
    return { ...a, yaml: fixed };
  });
  return { plan: { ...plan, newAgents: cleanedNewAgents }, autofixCount };
}

/**
 * `evaluate` — run the critic against the validated plan. Trivial wrapper
 * today; PR 2 also runs `planSmokeRun` here and merges both error lists.
 */
export function evaluatePlan(plan: BuildPlan, existingAgentIds: Set<string>): { ok: boolean; errors: PlanCriticError[] } {
  return critiquePlan(plan, { existingAgentIds });
}

/**
 * `reflect` — decide what to do next given an eval result and the attempt
 * count. No retry-spawning here; the runner does the I/O. This stays a
 * pure function so it's trivial to unit-test the decision rules.
 */
export type ReflectDecision = { kind: 'done' } | { kind: 'retry'; reason: string };

export function reflectOnEval(args: {
  criticOk: boolean;
  attemptsSoFar: number;
  maxRetries: number;
}): ReflectDecision {
  if (args.criticOk) return { kind: 'done' };
  if (args.attemptsSoFar > args.maxRetries) return { kind: 'done' }; // out of retries, fall through to "done with criticWarning"
  return { kind: 'retry', reason: 'critic failed and retry budget remains' };
}

/** Convenience: build a `LoopStepRecord` with `at` filled in. */
export function step(args: {
  phase: LoopPhase;
  primitive: string;
  runId: string;
  ok: boolean;
  summary: string;
  tookMs: number;
}): LoopStepRecord {
  return { ...args, at: new Date().toISOString() };
}
