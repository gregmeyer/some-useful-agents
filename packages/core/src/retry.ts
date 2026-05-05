/**
 * Auto-retry orchestrator. Wraps `executeAgentDag` with the agent's
 * declared `retry:` policy: when a run fails with a retryable
 * `errorCategory`, sleep with backoff and spawn a fresh run linked to the
 * head of the chain via `retryOfRunId`. Each attempt is its own `runs`
 * row — the same flat-chain shape produced by one-click manual retry.
 *
 * Sits ABOVE the executor on purpose. Per the failed-runs-and-retry plan
 * (R2): orchestrator-level retry composes with R1's manual retry plumbing,
 * surfaces every attempt in the dashboard, and doesn't park the executor's
 * event loop on `setTimeout` between attempts.
 *
 * Callers (Run Now, manual retry, widget run, CLI workflow run) swap
 * `executeAgentDag` for `executeAgentWithRetry` — agents without a
 * `retry:` block fall through to a single executor call (zero overhead).
 */

import type { Agent, NodeErrorCategory, RetryPolicy } from './agent-v2-types.js';
import type { Run } from './types.js';
import { executeAgentDag, type DagExecuteOptions, type DagExecutorDeps } from './dag-executor.js';
import { dispatchNotify } from './notify-dispatcher.js';

/**
 * Default categories that trigger auto-retry when `retry.categories` is
 * unset. Conservative: only flake-shaped failures. Authors broaden by
 * declaring `categories: [exit_nonzero, ...]` on the agent.
 */
export const DEFAULT_RETRY_CATEGORIES: NodeErrorCategory[] = ['timeout', 'spawn_failure'];

/**
 * Categories that NEVER trigger a retry, regardless of the agent's
 * declared `retry.categories`. These are deterministic (`setup`,
 * `input_resolution`) or user-driven (`cancelled`) or already-skipped
 * states (`condition_not_met`, `flow_ended`) — retrying changes nothing.
 */
const NEVER_RETRY: ReadonlySet<NodeErrorCategory> = new Set([
  'setup', 'input_resolution', 'cancelled', 'condition_not_met', 'flow_ended',
]);

/** Cap a single backoff sleep to 1 hour. Above that, stop trying. */
const MAX_BACKOFF_SECONDS = 3600;

export function isRetryableCategory(
  category: NodeErrorCategory | undefined,
  policy: Pick<RetryPolicy, 'categories'>,
): boolean {
  if (!category) return false;
  if (NEVER_RETRY.has(category)) return false;
  const allowed = policy.categories ?? DEFAULT_RETRY_CATEGORIES;
  return allowed.includes(category);
}

/**
 * Compute the wait between attempts for a given attempt number.
 * `attempt` is 1-indexed; the wait FOLLOWS attempt N (i.e. before
 * attempt N+1). For exponential backoff, attempt 1 waits `delaySeconds`,
 * attempt 2 waits `delaySeconds * 2`, attempt 3 waits `delaySeconds * 4`.
 */
export function computeBackoffDelay(
  policy: Pick<RetryPolicy, 'backoff' | 'delaySeconds'>,
  attempt: number,
): number {
  const base = policy.delaySeconds ?? 30;
  const mode = policy.backoff ?? 'exponential';
  let delay = base;
  if (mode === 'exponential') delay = base * Math.pow(2, Math.max(0, attempt - 1));
  else if (mode === 'linear') delay = base * Math.max(1, attempt);
  // 'fixed' just returns base.
  return Math.min(delay, MAX_BACKOFF_SECONDS);
}

/**
 * Promise-based sleep that resolves early when an AbortSignal fires.
 * No-op when ms <= 0 (defensive — tests pass 0 to skip waits).
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => { clearTimeout(t); resolve(); };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Find the category of the first failed node in a run. The DAG executor
 * marks the first node that breaks the run's success path; downstream
 * skips inherit `upstream_failed`. We want the *root cause* category,
 * not the cascade — so prefer non-`upstream_failed` failures.
 */
function getFailureCategory(runId: string, deps: DagExecutorDeps): NodeErrorCategory | undefined {
  const execs = deps.runStore.listNodeExecutions(runId);
  // First pass: look for the genuine root-cause category.
  for (const e of execs) {
    if (e.status === 'failed' && e.errorCategory && e.errorCategory !== 'upstream_failed') {
      return e.errorCategory;
    }
  }
  // Fallback: any failed category (rare — the run failed without a typed
  // category, e.g. replay-mode setup failure).
  for (const e of execs) {
    if (e.status === 'failed' && e.errorCategory) return e.errorCategory;
  }
  return undefined;
}

export interface ExecuteAgentWithRetryHooks {
  /**
   * Optional sleep override. Production passes `setTimeout`-backed sleep;
   * tests pass `() => Promise.resolve()` to skip waits without faking
   * timers. The wrapper falls back to its own implementation when omitted.
   */
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Called before every retry attempt with the upcoming attempt number
   * and the sleep duration in ms. Useful for tests to assert ordering
   * and for production logs.
   */
  onRetry?: (attempt: number, delayMs: number, category: NodeErrorCategory) => void;
}

/**
 * Wrapper around `executeAgentDag` that honours the agent's `retry:` policy.
 * Falls through to a single executor call when no policy is declared or
 * `attempts <= 1` — zero overhead for agents that opt out.
 *
 * Manual retry interplay: when called with `options.retryOf` set (e.g. by
 * the `/runs/:id/retry` route), the wrapper starts at `options.retryOf.attempt`
 * and counts up from there. So a user clicking Retry on attempt 1 against
 * an agent with `attempts: 3` can still produce attempt 2 and 3
 * automatically if the manually-spawned run also fails transiently.
 */
export async function executeAgentWithRetry(
  agent: Agent,
  options: DagExecuteOptions,
  deps: DagExecutorDeps,
  hooks: ExecuteAgentWithRetryHooks = {},
): Promise<Run> {
  const policy = agent.retry;
  // No policy → single execution. The executor's existing return value is
  // exactly what we'd produce, so don't even iterate. Notify dispatch is
  // handled inside the executor as before — this path stays unchanged.
  if (!policy || policy.attempts <= 1) {
    return executeAgentDag(agent, options, deps);
  }

  const sleeper = hooks.sleepFn ?? sleep;

  // Internal attempts run with `suppressNotify: true` so the executor
  // doesn't fire a notify per attempt. We fire ONCE at the end of the
  // chain — see the dispatchNotify call after the loop.
  const internalOptions: DagExecuteOptions = { ...options, suppressNotify: true };

  let attempt = options.retryOf?.attempt ?? 1;
  let currentRun = await executeAgentDag(agent, internalOptions, deps);

  while (
    currentRun.status === 'failed' &&
    attempt < policy.attempts &&
    !options.signal?.aborted
  ) {
    const category = getFailureCategory(currentRun.id, deps);
    if (!isRetryableCategory(category, policy)) break;

    const delayMs = computeBackoffDelay(policy, attempt) * 1000;
    if (hooks.onRetry && category) hooks.onRetry(attempt + 1, delayMs, category);
    await sleeper(delayMs, options.signal);
    if (options.signal?.aborted) break;

    attempt += 1;
    const headRunId = currentRun.retryOfRunId ?? currentRun.id;
    currentRun = await executeAgentDag(agent, {
      ...internalOptions,
      retryOf: { originalRunId: headRunId, attempt },
    }, deps);
  }

  // R3: fire notify ONCE for the chain's terminal outcome. A 3-attempt
  // run that recovers on attempt 2 produces zero failure pages and one
  // success notify. A run that exhausts the budget produces one failure
  // notify, not three.
  if (agent.notify) {
    try {
      await dispatchNotify(agent.notify, {
        agent,
        run: currentRun,
        secretsStore: deps.secretsStore,
        variablesStore: deps.variablesStore,
        dashboardBaseUrl: deps.dashboardBaseUrl,
        fetchImpl: deps.notifyFetch,
        logger: deps.notifyLogger,
      });
    } catch (err) {
      // Defense-in-depth: dispatchNotify catches handler errors itself.
      const logger = deps.notifyLogger ?? { warn: (m: string) => console.warn(`[notify] ${m}`) };
      logger.warn(`dispatch failed: ${(err as Error).message}`);
    }
  }
  return currentRun;
}
