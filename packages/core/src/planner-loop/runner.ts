import { formatCriticFeedback } from '../build-plan-critic.js';
import type { BuildPlan } from '../build-plan-schema.js';
import type { PlannerTelemetryStore } from '../planner-telemetry-store.js';
import { autofixPlanYamls, evaluatePlan, observePlan, reflectOnEval, step } from './primitives.js';
import type { LoopOutcome, LoopStepRecord } from './types.js';

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
  /** Spawn a fresh planner run; returns the new runId or null on failure. */
  kickoffPlannerRun: (args: { goal: string; criticFeedback: string }) => Promise<string | null>;
  /** Apply the dashboard's YAML autofixer to a single newAgent YAML. */
  autoFixYaml: (yaml: string) => string;
  /** Snapshot of agent-ids the catalog knows about, for critic cross-ref checks. */
  loadExistingAgentIds: () => Set<string>;
  /** Max *additional* retries after the initial attempt. Default 2 (total 3 tries). */
  maxRetries?: number;
}

export class PlannerLoopRunner {
  private readonly deps: Required<Pick<PlannerLoopRunnerDeps, 'telemetryStore' | 'kickoffPlannerRun' | 'autoFixYaml' | 'loadExistingAgentIds' | 'maxRetries'>>;

  constructor(deps: PlannerLoopRunnerDeps) {
    this.deps = {
      telemetryStore: deps.telemetryStore,
      kickoffPlannerRun: deps.kickoffPlannerRun,
      autoFixYaml: deps.autoFixYaml,
      loadExistingAgentIds: deps.loadExistingAgentIds,
      maxRetries: deps.maxRetries ?? 2,
    };
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

    // ── evaluate ─────────────────────────────────────────────────────
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

    // ── reflect (decide) ─────────────────────────────────────────────
    const rootRunId = this.deps.telemetryStore?.resolveOriginalRunId(input.runId) ?? input.runId;
    const rootRow = this.deps.telemetryStore?.get(rootRunId) ?? null;
    const attemptsSoFar = rootRow?.planAttempts ?? 1;
    const decision = reflectOnEval({ criticOk: critic.ok, attemptsSoFar, maxRetries: this.deps.maxRetries });
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
      const feedback = formatCriticFeedback(critic.errors);
      const composeStart = Date.now();
      const retryRunId = await this.deps.kickoffPlannerRun({ goal, criticFeedback: feedback });
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
      // Record THIS attempt's extract telemetry as ok (schema accepted; only critic rejected).
      this.recordExtractOk(input.runId, autofixCount, critic.errors.length, input.planMs, plan);

      if (!retryRunId) {
        // Couldn't spawn a retry — surface what we have with the critic errors.
        return {
          kind: 'done',
          plan,
          criticErrors: critic.errors,
          criticWarning: 'Plan has unresolved structural issues; retry could not be started. You can commit anyway or dismiss.',
          steps,
        };
      }
      return {
        kind: 'retrying',
        retryRunId,
        attempt: attemptsSoFar + 1,
        criticErrors: critic.errors,
        phase: `Refining plan (attempt ${attemptsSoFar + 1})...`,
        steps,
      };
    }

    // ── done (critic passed, or retries exhausted) ───────────────────
    this.recordExtractOk(input.runId, autofixCount, critic.ok ? 0 : critic.errors.length, input.planMs, plan);

    if (critic.ok) {
      return { kind: 'done', plan, steps };
    }
    return {
      kind: 'done',
      plan,
      criticErrors: critic.errors,
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
