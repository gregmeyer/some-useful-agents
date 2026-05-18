/**
 * Agent-loop runner. Wraps `executeAgentWithRetry` with an
 * author-declared evaluation loop: after each DAG execution, check the
 * agent's `successCriteria`; if any fail and `maxLoopIterations` allows,
 * re-run with the failure list injected as `{{loop.feedback}}` (or
 * `$LOOP_FEEDBACK` for shell nodes — see node-env / node-templates).
 *
 * When the agent declares no `successCriteria`, the runner is a pure
 * pass-through to `executeAgentWithRetry` — no behaviour change for
 * existing agents.
 */

import type { Agent } from '../agent-v2-types.js';
import type { DagExecuteOptions, DagExecutorDeps } from '../dag-executor.js';
import type { Run } from '../types.js';
import { executeAgentWithRetry, type ExecuteAgentWithRetryHooks } from '../retry.js';
import { evaluateCriteria, formatCriterionFailures, type CriterionResult } from './eval-criteria.js';
import type { AgentMemoryStore, AgentMemoryEvalStatus } from './memory-store.js';

export interface AgentLoopHooks extends ExecuteAgentWithRetryHooks {
  /**
   * Fires when an iteration's eval failed and another iteration is about
   * to start. Mirrors `executeAgentWithRetry`'s `onRetry` shape for symmetry.
   */
  onEvalRetry?: (nextIteration: number, failures: CriterionResult[]) => void;
}

export interface AgentLoopRunnerDeps {
  /**
   * Optional. When supplied, each iteration writes one row recording
   * inputs / observations / eval status. Booting without it means the
   * loop still runs, just without persistent observability.
   */
  memoryStore?: AgentMemoryStore;
}

/**
 * Run an agent through the eval loop. Returns the LAST iteration's run
 * (pass or fail), so callers see the same shape they got from
 * `executeAgentWithRetry`. Iterations are separate Run rows in the run
 * store; the loop links them via `agent_memory.root_run_id`.
 *
 * The loop terminates when:
 *  - eval passes;
 *  - eval fails but `maxLoopIterations` is hit;
 *  - the underlying run fails transiently (the inner `executeAgentWithRetry`
 *    already exhausted its retry budget — re-running here wouldn't help);
 *  - `options.signal` is aborted.
 */
export async function executeAgentLoop(
  agent: Agent,
  options: DagExecuteOptions,
  deps: DagExecutorDeps,
  loopDeps: AgentLoopRunnerDeps = {},
  hooks: AgentLoopHooks = {},
): Promise<Run> {
  const maxIterations = Math.max(1, agent.maxLoopIterations ?? 1);
  const criteria = agent.successCriteria ?? [];

  // No criteria → single-shot pass-through. Preserves byte-equivalent
  // behaviour for every existing agent.
  if (criteria.length === 0) {
    return executeAgentWithRetry(agent, options, deps, hooks);
  }

  let rootRunId: string | null = null;
  let lastRun: Run | null = null;
  let lastFailures: CriterionResult[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (iteration > 1) {
      hooks.onEvalRetry?.(iteration, lastFailures);
    }

    // Inject the prior iteration's eval feedback as an extra input. Agents
    // opt in by referencing `{{inputs.LOOP_FEEDBACK}}` in their prompts
    // (claude-code) or `$LOOP_FEEDBACK` in their commands (shell). On
    // iteration 1 it's blank.
    const iterInputs: Record<string, string> = {
      ...(options.inputs ?? {}),
      LOOP_FEEDBACK: iteration > 1 ? formatCriterionFailures(lastFailures) : '',
    };

    const iterOptions: DagExecuteOptions = { ...options, inputs: iterInputs };

    const run = await executeAgentWithRetry(agent, iterOptions, deps, hooks);
    lastRun = run;
    if (rootRunId === null) rootRunId = run.id;

    // Transient failure (the inner retry wrapper already exhausted its
    // budget). Re-running the eval loop wouldn't help — abort and surface
    // the failed run.
    if (run.status === 'failed') {
      recordIteration(loopDeps.memoryStore, agent.id, rootRunId, iteration, run.id, iterInputs, null, 'transient-error', null);
      return run;
    }

    // Eval against the just-completed run's per-node executions.
    const nodeExecutions = deps.runStore.listNodeExecutions(run.id);
    const evalResult = evaluateCriteria({ criteria, run, nodeExecutions, inputs: iterInputs });
    const status: AgentMemoryEvalStatus = evalResult.passed ? 'passed' : 'failed';
    recordIteration(
      loopDeps.memoryStore,
      agent.id,
      rootRunId,
      iteration,
      run.id,
      iterInputs,
      summariseObservations(nodeExecutions),
      status,
      evalResult.passed ? null : evalResult.results.filter((r) => !r.passed),
    );

    if (evalResult.passed) return run;

    lastFailures = evalResult.results.filter((r) => !r.passed);
    if (options.signal?.aborted) return run;
  }

  // Loop budget exhausted with eval still failing. Surface the last run
  // — callers can inspect `agent_memory` to see what each iteration
  // produced, plus the per-iteration failure lists.
  return lastRun!;
}

function recordIteration(
  store: AgentMemoryStore | undefined,
  agentId: string,
  rootRunId: string,
  iteration: number,
  runId: string,
  inputs: Record<string, unknown>,
  observations: unknown,
  evalStatus: AgentMemoryEvalStatus,
  failures: CriterionResult[] | null,
): void {
  if (!store) return;
  try {
    store.recordIteration({
      agentId,
      rootRunId,
      iteration,
      runId,
      inputsJson: JSON.stringify(inputs).slice(0, 8192),
      observationsJson: observations != null ? JSON.stringify(observations).slice(0, 8192) : null,
      evalStatus,
      evalFailuresJson: failures ? JSON.stringify(failures).slice(0, 8192) : null,
    });
  } catch { /* swallow — memory is best-effort observability */ }
}

/**
 * Compact summary of node outputs used by `agent_memory.observations_json`.
 * Drops large fields (truncated) so memory rows stay manageable; reference
 * the runs table for the full output.
 */
function summariseObservations(execs: Array<{ nodeId: string; status: string; result?: string; exitCode?: number }>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of execs) {
    out[e.nodeId] = {
      status: e.status,
      ...(e.exitCode !== undefined ? { exitCode: e.exitCode } : {}),
      ...(e.result ? { resultPreview: e.result.slice(0, 240) } : {}),
    };
  }
  return out;
}
