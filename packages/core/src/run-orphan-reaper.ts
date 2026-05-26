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
 * PR C (this file): when the node row carries a persisted `childPid` +
 * `childStartedAtMs`, the reaper additionally SIGKILLs the orphan after
 * a ps-cross-check defends against PID reuse. This actually stops the
 * token burn instead of just closing the state-machine bleed.
 */

import { execSync } from 'node:child_process';
import type { RunStore } from './run-store.js';
import type { RunStatus } from './types.js';
import type { NodeExecutionRecord } from './agent-v2-types.js';

export interface ReapResult {
  /** Number of `runs` rows transitioned to `failed`. */
  runsReaped: number;
  /** Number of `node_executions` rows transitioned to `failed`. */
  nodesReaped: number;
  /** Number of orphaned child processes the reaper actually SIGKILLed. */
  pidsKilled: number;
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
  /**
   * `Date.now()` reference for the ps cross-check. Tests inject a fixed
   * clock so they can verify drift detection deterministically. Defaults
   * to the live wall clock.
   */
  nowMs?: number;
  /**
   * Hook the kill + ps subprocess for tests. Returns true iff the process
   * was killed (or didn't need to be). Production callers leave this
   * unset and get the real `killIfStillOurs`.
   */
  killProcess?: (pid: number, startedAtMs: number, nowMs: number) => boolean;
}

const DEFAULT_REASON =
  'Run abandoned: dashboard restarted while this run was in flight. ' +
  'The orphaned child process has been killed (if still running); the ' +
  'run record is being finalized so dashboards stop polling.';

/**
 * Kill an orphaned child process if we can verify it's still the one we
 * spawned. Defends against PID reuse on long-uptime machines by parsing
 * `ps -p <pid> -o etime=` and comparing the elapsed time against the
 * stored `startedAtMs`. Drift > max(5s, 10% of expected) → skip the kill.
 *
 * Returns true when the process was SIGKILLed (or already gone — which is
 * the desired end state anyway). Returns false when we declined to kill
 * because the PID belongs to something else now, or `ps` failed.
 */
export function killIfStillOurs(pid: number, startedAtMs: number, nowMs: number = Date.now()): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;

  let etimeRaw: string;
  try {
    // `ps -p <pid> -o etime=` works on macOS + Linux. Empty trailing `=`
    // suppresses the header. The format is `[[DD-]HH:]MM:SS`.
    etimeRaw = execSync(`ps -p ${pid} -o etime=`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    // ps returned non-zero (pid not found) or hung past timeout. Either way
    // the orphan is already gone — desired end state.
    return true;
  }

  const actualEtimeSec = parseEtime(etimeRaw);
  if (actualEtimeSec === null) {
    // Unparseable output — be conservative and skip the kill.
    return false;
  }

  const expectedSec = Math.max(0, (nowMs - startedAtMs) / 1000);
  const tolerance = Math.max(5, expectedSec * 0.1);
  if (Math.abs(actualEtimeSec - expectedSec) > tolerance) {
    // PID reuse: a different process is wearing this pid now. Do not kill.
    return false;
  }

  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    // ESRCH (already dead) or EPERM (not ours). Either way we're done.
    return true;
  }
}

/**
 * Parse `ps -o etime=` output into seconds.
 *
 * Accepted forms (any whitespace allowed around):
 *   `MM:SS`          →  MM * 60 + SS
 *   `HH:MM:SS`       →  HH * 3600 + MM * 60 + SS
 *   `DD-HH:MM:SS`    →  DD * 86400 + HH * 3600 + MM * 60 + SS
 *
 * Returns null on anything that doesn't match.
 */
export function parseEtime(raw: string): number | null {
  const s = raw.trim();
  // Day-prefixed form: `DD-HH:MM:SS`
  const dayMatch = s.match(/^(\d+)-(\d+):(\d+):(\d+)$/);
  if (dayMatch) {
    const [, d, h, m, sec] = dayMatch;
    return +d * 86400 + +h * 3600 + +m * 60 + +sec;
  }
  // Hour-prefixed form: `HH:MM:SS`
  const hourMatch = s.match(/^(\d+):(\d+):(\d+)$/);
  if (hourMatch) {
    const [, h, m, sec] = hourMatch;
    return +h * 3600 + +m * 60 + +sec;
  }
  // Bare minutes: `MM:SS`
  const minMatch = s.match(/^(\d+):(\d+)$/);
  if (minMatch) {
    const [, m, sec] = minMatch;
    return +m * 60 + +sec;
  }
  return null;
}

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
  const nowMs = options.nowMs ?? Date.now();
  const reason = options.reason ?? DEFAULT_REASON;
  const killFn = options.killProcess ?? killIfStillOurs;

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
  let pidsKilled = 0;
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
    // For each row that carries a persisted childPid + childStartedAtMs,
    // try to SIGKILL the orphan before transitioning the row — this is
    // what actually stops the token bleed (vs just closing the state-
    // machine bleed). PR-C addition.
    const nodeExecs: NodeExecutionRecord[] = runStore.listNodeExecutions(run.id);
    for (const exec of nodeExecs) {
      if (exec.status === 'running' || exec.status === 'pending') {
        if (typeof exec.childPid === 'number' && typeof exec.childStartedAtMs === 'number') {
          // killFn returns true when the process was killed OR was already
          // gone (both desired end states). False means PID reuse drift
          // declined the kill — orphan continues until it finishes
          // naturally, but the state machine is still closed.
          if (killFn(exec.childPid, exec.childStartedAtMs, nowMs)) {
            pidsKilled++;
          }
        }
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

  return { runsReaped, nodesReaped, pidsKilled, reapedRunIds };
}
