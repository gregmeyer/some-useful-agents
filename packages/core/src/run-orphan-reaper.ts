/**
 * Reap orphaned runs on dashboard boot.
 *
 * Symptom this protects against: when the dashboard process dies mid-run
 * (`daemon restart`, crash, OOM), any in-flight LLM child processes are
 * reparented to launchd/init and keep running — burning tokens — while
 * the in-memory `setTimeout(SIGTERM)` that node-spawner armed dies with
 * the parent. The new dashboard process has no `activeRuns` entry for
 * them and cannot abort them. The run row sits at `status='running'`
 * indefinitely; the node row never finalizes.
 *
 * Semantic this enforces: any run still flagged `running` (or `pending`)
 * at dashboard startup is, by definition, an orphan — the only process
 * that could be executing it is the dashboard, and the dashboard just
 * started fresh. Mark the run + every still-`running` node execution
 * as `failed` with category `abandoned` so dashboards stop polling them,
 * notify logic doesn't fire forever, and the audit trail explains the
 * gap.
 *
 * This DOES NOT kill the orphaned child process — that requires the
 * child PID, which isn't persisted yet (followup C). Tokens already
 * spent are gone; what this stops is the state-machine bleed.
 */

import type { RunStore } from './run-store.js';
import type { RunStatus } from './types.js';
import type { NodeExecutionRecord } from './agent-v2-types.js';

export interface ReapResult {
  /** Number of `runs` rows transitioned to `failed`. */
  runsReaped: number;
  /** Number of `node_executions` rows transitioned to `failed`. */
  nodesReaped: number;
  /** Run IDs that were reaped, in case the caller wants to log them. */
  reapedRunIds: string[];
}

export interface ReapOptions {
  /** ISO timestamp to record as `completedAt`. Defaults to `now`. Tests override. */
  now?: string;
  /**
   * Free-form reason recorded on the run/node `error` column. Defaults to a
   * message that names the daemon-restart race as the typical cause.
   */
  reason?: string;
}

const DEFAULT_REASON =
  'Run abandoned: dashboard restarted while this run was in flight. ' +
  'The child process was reparented and may have continued briefly; ' +
  'the run record is being finalized so dashboards stop polling.';

/**
 * Find every run in a non-terminal status (`running` or `pending`) and
 * transition it to `failed` with `errorCategory='abandoned'`. For each
 * such run, also transition any `running` node_execution rows so the
 * per-node table doesn't show a spinner forever.
 *
 * Returns counts for telemetry / boot-log surface. Safe to call multiple
 * times: a row already in a terminal status is left alone.
 */
export function reapOrphanedRuns(runStore: RunStore, options: ReapOptions = {}): ReapResult {
  const completedAt = options.now ?? new Date().toISOString();
  const reason = options.reason ?? DEFAULT_REASON;

  // Pull every non-terminal run. `queryRuns` with statuses=['running','pending']
  // captures both the actively-executing case and the rare "DB row written
  // but child not yet spawned" case the executor briefly produces.
  const { rows } = runStore.queryRuns({
    statuses: ['running', 'pending'] as RunStatus[],
    limit: 10_000,
    offset: 0,
  });

  let runsReaped = 0;
  let nodesReaped = 0;
  const reapedRunIds: string[] = [];

  for (const run of rows) {
    // Finalize the run row.
    runStore.updateRun(run.id, {
      status: 'failed' as RunStatus,
      completedAt,
      error: reason,
    });
    runsReaped++;
    reapedRunIds.push(run.id);

    // Finalize any still-running node executions. Skip terminal-status
    // node rows so a partially-completed run keeps its earlier history.
    const nodeExecs: NodeExecutionRecord[] = runStore.listNodeExecutions(run.id);
    for (const exec of nodeExecs) {
      if (exec.status === 'running' || exec.status === 'pending') {
        runStore.updateNodeExecution(run.id, exec.nodeId, {
          status: 'failed',
          errorCategory: 'abandoned',
          completedAt,
          error: reason,
        });
        nodesReaped++;
      }
    }
  }

  return { runsReaped, nodesReaped, reapedRunIds };
}
