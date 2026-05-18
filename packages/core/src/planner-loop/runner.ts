import { formatCriticFeedback, type PlanCriticError } from '../build-plan-critic.js';
import type { BuildPlan } from '../build-plan-schema.js';
import type { PlannerTelemetryStore } from '../planner-telemetry-store.js';
import { formatSmokeFeedback, smokeRunNewAgents, type SmokeRunContext, type SmokeRunResult } from './eval-smoke-run.js';
import { findSimilarCommittedPlans, type PriorPlanCandidate } from './memory-retrieval.js';
import type { PlannerMemoryStore } from './memory-store.js';
import { autofixPlanYamls, evaluatePlan, observePlan, reflectOnEval, step } from './primitives.js';
import type { LoopOutcome, LoopStepRecord } from './types.js';

/**
 * Join critic + smoke feedback into a single block the planner can read
 * on retry. When only one of the two failed, only that block is included.
 * The planner prompt is already trained to handle critic feedback, so
 * smoke feedback follows the same prefix-line convention.
 */
function combinedFeedback(criticErrors: PlanCriticError[], smoke: SmokeRunResult): string {
  const parts: string[] = [];
  if (criticErrors.length > 0) parts.push(formatCriticFeedback(criticErrors));
  if (!smoke.ok) parts.push(formatSmokeFeedback(smoke));
  return parts.join('\n\n');
}

/**
 * Drives one *post-run* iteration of the planner loop. The HTTP wizard
 * polls the planner run, and once it completes, calls `advance(...)` to
 * (a) observe what came back, (b) evaluate it, (c) reflect on whether to
 * retry, and (d) optionally spawn the retry. The "loop" plays out across
 * multiple HTTP polls — each advance() is one trip through the state
 * machine, not a synchronous until-done loop.
 *
 * Behaviour-equivalent to the inline block at run-now-build.ts:820-950
 * before this refactor. PRs 2-4 will extend this with smoke-run eval,
 * cross-run memory, and shared types with the generated-agent loop.
 */
export interface PlannerLoopRunnerDeps {
  /** Look up the root telemetry row (aliased-runId → root) to count attempts. */
  telemetryStore: PlannerTelemetryStore | undefined;
  /**
   * Spawn a fresh planner run; returns the new runId or null on failure.
   * Accepts `priorPlans` so the runner's compose step can re-inject memory
   * on retries (the initial kickoff retrieves on the dashboard route side
   * before the runner exists).
   */
  kickoffPlannerRun: (args: { goal: string; criticFeedback: string; priorPlans?: PriorPlanCandidate[] }) => Promise<string | null>;
  /** Apply the dashboard's YAML autofixer to a single newAgent YAML. */
  autoFixYaml: (yaml: string) => string;
  /** Snapshot of agent-ids the catalog knows about, for critic cross-ref checks. */
  loadExistingAgentIds: () => Set<string>;
  /**
   * Snapshot of tool-ids the dispatcher can resolve. Threaded into the
   * smoke-run eval (PR 2) so shell nodes referencing unknown tools fail
   * smoke even when the schema accepted the YAML. Optional — when omitted
   * the smoke eval skips its tool-id check.
   */
  loadKnownToolIds?: () => Set<string>;
  /**
   * Cross-run planner memory (PR 3). When supplied, the runner's compose
   * step re-retrieves similar prior plans for the retry — now that the
   * intent is known via telemetry, retrieval can filter by intent.
   * Optional — booting without it just skips the understand phase.
   */
  memoryStore?: PlannerMemoryStore;
  /** Max *additional* retries after the initial attempt. Default 2 (total 3 tries). */
  maxRetries?: number;
}

export class PlannerLoopRunner {
  private readonly deps: PlannerLoopRunnerDeps & { maxRetries: number };

  constructor(deps: PlannerLoopRunnerDeps) {
    this.deps = { ...deps, maxRetries: deps.maxRetries ?? 2 };
  }

  /**
   * Drive one iteration. Given a completed planner run, decide what's next.
   *
   * `planMs` is the planner run's wall-clock duration, threaded through
   * for telemetry. The caller already computed it from
   * run.completedAt − run.startedAt.
   */
  async advance(input: {
    runId: string;
    runResult: string;
    nodeExecResult?: string;
    planMs: number;
  }): Promise<LoopOutcome> {
    const steps: LoopStepRecord[] = [];

    // ── observe ──────────────────────────────────────────────────────
    const obsStart = Date.now();
    const obs = observePlan({ runResult: input.runResult, nodeExecResult: input.nodeExecResult });
    steps.push(step({
      phase: 'observe',
      primitive: 'observePlan',
      runId: input.runId,
      ok: obs.status === 'ok',
      summary: obs.status === 'ok' ? `plan extracted (intent=${obs.plan!.intent})` : `extract failed: ${obs.status}`,
      tookMs: Date.now() - obsStart,
    }));

    if (obs.status !== 'ok') {
      // Mirror existing telemetry shape: schema-invalid records validationErrors,
      // the other two record 'no-json' (the legacy code conflated json-parse-error with no-json).
      try {
        this.deps.telemetryStore?.recordExtract({
          runId: input.runId,
          status: obs.status === 'schema-invalid' ? 'schema-invalid' : 'no-json',
          autofixCount: 0,
          validationErrors: obs.validationErrors,
          timeToPlanMs: input.planMs,
        });
      } catch { /* swallow */ }
      return { kind: 'failed', error: obs.errorMessage!, rawPlan: obs.rawPlan, steps };
    }

    // ── observe (continued): autofix YAMLs ──────────────────────────
    const fixStart = Date.now();
    const { plan, autofixCount } = autofixPlanYamls(obs.plan!, this.deps.autoFixYaml);
    steps.push(step({
      phase: 'observe',
      primitive: 'autofixPlanYamls',
      runId: input.runId,
      ok: true,
      summary: `${autofixCount} of ${plan.newAgents.length} newAgent yaml(s) modified by autofix`,
      tookMs: Date.now() - fixStart,
    }));

    // ── evaluate (critic + smoke) ────────────────────────────────────
    const evalStart = Date.now();
    const critic = evaluatePlan(plan, this.deps.loadExistingAgentIds());
    steps.push(step({
      phase: 'evaluate',
      primitive: 'critiquePlan',
      runId: input.runId,
      ok: critic.ok,
      summary: critic.ok ? 'critic passed' : `critic flagged ${critic.errors.length} issue(s)`,
      tookMs: Date.now() - evalStart,
    }));

    // Smoke: per-newAgent "would this load & run cleanly" check beyond
    // what the structural critic flags. When the critic already failed
    // we still smoke — the planner gets a combined feedback block.
    const smokeStart = Date.now();
    const smokeCtx: SmokeRunContext = this.deps.loadKnownToolIds ? { knownToolIds: this.deps.loadKnownToolIds() } : {};
    const smoke = smokeRunNewAgents(plan, smokeCtx);
    const smokeErrorCount = smoke.perAgent.reduce((n, a) => n + a.errors.length, 0);
    steps.push(step({
      phase: 'evaluate',
      primitive: 'smokeRunNewAgents',
      runId: input.runId,
      ok: smoke.ok,
      summary: smoke.ok ? 'smoke passed' : `smoke flagged ${smokeErrorCount} issue(s) across ${smoke.perAgent.length} newAgent(s)`,
      tookMs: Date.now() - smokeStart,
    }));
    try {
      this.deps.telemetryStore?.recordSmoke({
        runId: input.runId,
        status: smoke.ok ? 'ok' : 'failed',
        errors: smokeErrorCount,
      });
    } catch { /* swallow */ }

    // ── reflect (decide) ─────────────────────────────────────────────
    const evalOk = critic.ok && smoke.ok;
    const rootRunId = this.deps.telemetryStore?.resolveOriginalRunId(input.runId) ?? input.runId;
    const rootRow = this.deps.telemetryStore?.get(rootRunId) ?? null;
    const attemptsSoFar = rootRow?.planAttempts ?? 1;
    const decision = reflectOnEval({ criticOk: evalOk, attemptsSoFar, maxRetries: this.deps.maxRetries });
    steps.push(step({
      phase: 'reflect',
      primitive: 'reflectOnEval',
      runId: input.runId,
      ok: true,
      summary: decision.kind === 'retry'
        ? `retry (attempt ${attemptsSoFar + 1} of ${this.deps.maxRetries + 1})`
        : critic.ok ? 'done — critic passed' : `done — out of retries (${attemptsSoFar} attempts)`,
      tookMs: 0,
    }));

    // ── compose (spawn retry if reflect said retry) ──────────────────
    if (decision.kind === 'retry') {
      try { this.deps.telemetryStore?.incrementAttempts(input.runId); } catch { /* swallow */ }
      const goal = rootRow?.goal ?? '';
      const feedback = combinedFeedback(critic.errors, smoke);

      // understand: pull prior committed plans for the *now-known* intent
      // and inject them on the retry. Skipped silently when memory store
      // wasn't supplied or no candidates pass the similarity floor.
      let priorPlans: PriorPlanCandidate[] = [];
      if (this.deps.memoryStore && goal) {
        const understandStart = Date.now();
        priorPlans = findSimilarCommittedPlans(this.deps.memoryStore, { goal, intent: plan.intent });
        steps.push(step({
          phase: 'understand',
          primitive: 'findSimilarCommittedPlans',
          runId: input.runId,
          ok: true,
          summary: priorPlans.length > 0
            ? `retrieved ${priorPlans.length} prior plan(s) for intent=${plan.intent}`
            : `no prior plans matched (intent=${plan.intent})`,
          tookMs: Date.now() - understandStart,
        }));
      }

      const composeStart = Date.now();
      const retryRunId = await this.deps.kickoffPlannerRun({ goal, criticFeedback: feedback, priorPlans });
      steps.push(step({
        phase: 'compose',
        primitive: 'kickoffPlannerRun',
        runId: input.runId,
        ok: !!retryRunId,
        summary: retryRunId ? `spawned retry runId=${retryRunId.slice(0, 8)}` : 'retry spawn failed',
        tookMs: Date.now() - composeStart,
      }));
      if (retryRunId && this.deps.telemetryStore) {
        try { this.deps.telemetryStore.recordRetrySpawn(rootRunId, retryRunId); } catch { /* swallow */ }
      }
      // Record THIS attempt's extract telemetry as ok (schema accepted; the
      // critic or smoke is what rejected). validationErrors counts critic
      // issues (smoke errors are tracked separately via recordSmoke above).
      this.recordExtractOk(input.runId, autofixCount, critic.errors.length, input.planMs, plan);

      if (!retryRunId) {
        // Couldn't spawn a retry — surface what we have with the critic errors.
        return {
          kind: 'done',
          plan,
          criticErrors: critic.errors,
          smoke,
          criticWarning: 'Plan has unresolved structural issues; retry could not be started. You can commit anyway or dismiss.',
          steps,
        };
      }
      return {
        kind: 'retrying',
        retryRunId,
        attempt: attemptsSoFar + 1,
        criticErrors: critic.errors,
        smoke,
        phase: `Refining plan (attempt ${attemptsSoFar + 1})...`,
        steps,
      };
    }

    // ── done (eval passed, or retries exhausted) ─────────────────────
    this.recordExtractOk(input.runId, autofixCount, evalOk ? 0 : critic.errors.length, input.planMs, plan);

    if (evalOk) {
      return { kind: 'done', plan, steps };
    }
    return {
      kind: 'done',
      plan,
      criticErrors: critic.errors,
      smoke,
      criticWarning: `Planner could not produce a clean plan after ${attemptsSoFar} attempts. Review the issues below and either fix the YAML inline or commit anyway.`,
      steps,
    };
  }

  private recordExtractOk(runId: string, autofixCount: number, validationErrors: number, planMs: number, plan: BuildPlan): void {
    try {
      this.deps.telemetryStore?.recordExtract({
        runId,
        status: 'ok',
        autofixCount,
        validationErrors,
        timeToPlanMs: planMs,
        intent: plan.intent,
      });
    } catch { /* swallow */ }
  }

}
