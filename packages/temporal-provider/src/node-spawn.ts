import { randomUUID } from 'node:crypto';
import type { Client } from '@temporalio/client';
import type { SpawnNodeFn, SpawnResult, SpawnProgress } from '@some-useful-agents/core';
import { stripSensitiveEnv } from '@some-useful-agents/core';
import { DEFAULT_TASK_QUEUE } from './worker.js';
import type { RunNodeActivityInput } from './activities.js';

export interface CreateTemporalSpawnNodeOptions {
  /** A connected Temporal client (reuse the provider's). */
  client: Client;
  /** Path to the encrypted secrets file, read on the worker. */
  secretsPath: string;
  /** Task queue the worker polls. Defaults to the provider's queue. */
  taskQueue?: string;
  /**
   * How often to poll the workflow for heartbeated progress, in ms. Defaults to
   * 1000. The worker heartbeats the full progress trail; the poll diffs by index
   * and re-emits new events through `onProgress`. Set 0 to disable polling.
   */
  progressPollMs?: number;
}

/**
 * Minimal shape of a Temporal workflow description we read for progress. The
 * worker heartbeats `{ progress: SpawnProgress[] }`; depending on SDK surfacing
 * `heartbeatDetails` may arrive as that object or wrapped in a details array.
 */
interface DescribeLike {
  pendingActivities?: Array<{ heartbeatDetails?: unknown }>;
}

/**
 * Pull the accumulated progress trail out of a workflow `describe()` result.
 * Defensive about how the data converter surfaces heartbeat details (single
 * object vs. array-of-details). Returns [] when there's no pending activity or
 * no heartbeat yet.
 */
export function extractHeartbeatProgress(description: DescribeLike): SpawnProgress[] {
  for (const act of description.pendingActivities ?? []) {
    const d = act.heartbeatDetails;
    const obj = Array.isArray(d) ? d[0] : d;
    const progress = (obj as { progress?: unknown } | undefined)?.progress;
    if (Array.isArray(progress)) return progress as SpawnProgress[];
  }
  return [];
}

/**
 * A Temporal `WorkflowFailedError`'s own `.message` is always the generic
 * "Workflow execution failed" — the real reason (activity error, heartbeat
 * timeout, etc.) lives in its `.cause` chain. Walk to the deepest cause with a
 * message so the run record shows something actionable instead of boilerplate.
 */
export function describeWorkflowError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let cur: Error = err;
  const seen = new Set<Error>();
  // Descend while a cause carries a usable message. Stop at the deepest one.
  while (cur.cause instanceof Error && !seen.has(cur.cause)) {
    seen.add(cur);
    const next = cur.cause;
    if (!next.message) break;
    cur = next;
  }
  return cur.message || err.message || String(err);
}

/**
 * Build a {@link SpawnNodeFn} that runs each DAG node on a Temporal worker
 * (B1b). The dashboard injects this as `deps.spawnNode` when the provider is
 * Temporal; `executeAgentDag` keeps orchestrating in-process and calls this per
 * node.
 *
 * Each node becomes its own one-shot `runNodeWorkflow` (clients can't invoke
 * activities directly). Secrets are stripped from `env` before they cross the
 * activity boundary — Temporal persists inputs in workflow history — and
 * re-injected on the worker from `secretsPath`. Abort → workflow cancel. Like
 * `spawnNodeReal`, this resolves to a SpawnResult for normal failures rather
 * than throwing, so the executor records the node outcome uniformly.
 */
export function createTemporalSpawnNode(opts: CreateTemporalSpawnNodeOptions): SpawnNodeFn {
  const taskQueue = opts.taskQueue ?? DEFAULT_TASK_QUEUE;

  const pollMs = opts.progressPollMs ?? 1000;

  return async (node, env, spawnOpts, onProgress, signal): Promise<SpawnResult> => {
    const { safe } = stripSensitiveEnv(env, node);
    const input: RunNodeActivityInput = {
      node,
      env: safe,
      agentId: spawnOpts.agentId,
      agentSource: spawnOpts.agentSource,
      llmProviders: spawnOpts.llmSettings?.providers,
      secretsPath: opts.secretsPath,
      declaredSecrets: node.secrets ?? [],
    };

    const workflowId = `sua-node-${spawnOpts.agentId}-${node.id}-${randomUUID().slice(0, 8)}`;

    let handle;
    try {
      handle = await opts.client.workflow.start('runNodeWorkflow', {
        taskQueue,
        workflowId,
        args: [input],
      });
    } catch (err) {
      return {
        result: '',
        exitCode: 1,
        error: `Failed to start Temporal node workflow: ${err instanceof Error ? err.message : String(err)}`,
        category: 'spawn_failure',
        usedWorkflowProvider: 'temporal',
      };
    }

    // Map the executor's abort signal onto workflow cancellation. The activity
    // heartbeats, so the worker receives the cancel and SIGTERMs the child.
    const onAbort = (): void => { void handle.cancel().catch(() => { /* already gone */ }); };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    // Live progress: poll the workflow's heartbeated progress trail and re-emit
    // any events not yet surfaced through the real onProgress. Because the
    // executor still orchestrates in-process, this drives the normal path —
    // node_executions.progressJson writes AND the inbox token stream — for
    // Temporal runs, at ~poll-interval granularity (not token-by-token).
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    let emitted = 0;
    let polling = false;
    const poll = async (): Promise<void> => {
      if (polling) return;
      polling = true;
      try {
        const desc = await handle.describe();
        const trail = extractHeartbeatProgress(desc as DescribeLike);
        for (let i = emitted; i < trail.length; i++) onProgress?.(trail[i]);
        emitted = Math.max(emitted, trail.length);
      } catch { /* describe races completion — ignore, the result settles below */ }
      finally { polling = false; }
    };
    if (onProgress && pollMs > 0) {
      progressTimer = setInterval(() => { void poll(); }, pollMs);
    }

    try {
      const result = await handle.result();
      // The activity stamps this too, but guarantee it from the factory so the
      // backend identity never depends on the activity remembering.
      return { ...result, usedWorkflowProvider: 'temporal' };
    } catch (err) {
      const cancelled = signal?.aborted === true;
      return {
        result: '',
        exitCode: cancelled ? 143 : 1,
        error: cancelled
          ? `Node "${node.id}" cancelled`
          : `Temporal node workflow failed: ${describeWorkflowError(err)}`,
        category: cancelled ? 'cancelled' : 'exit_nonzero',
        usedWorkflowProvider: 'temporal',
      };
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      if (signal && !signal.aborted) signal.removeEventListener('abort', onAbort);
    }
  };
}
