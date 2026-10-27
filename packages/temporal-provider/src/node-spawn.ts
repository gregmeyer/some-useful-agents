import { randomUUID } from 'node:crypto';
import type { Client } from '@temporalio/client';
import type { SpawnNodeFn, SpawnResult, SpawnProgress } from '@some-useful-agents/core';
import { newLiveCursor, stripSensitiveEnv, takeNewProgress } from '@some-useful-agents/core';
import { DEFAULT_TASK_QUEUE } from './worker.js';
import type { RunNodeActivityInput } from './activities.js';
import { extractLiveProgress, heartbeatDetails, type DescribeLike } from './live-progress.js';

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
  /**
   * Same-host paths the worker opens itself, so a node gets the tool,
   * integration and variables stores and the full LLM settings (custom
   * providers, disabled list) it would get locally. Paths, not contents:
   * custom providers carry API keys and inputs land in workflow history.
   */
  dbPath?: string;
  variablesPath?: string;
  llmSettingsPath?: string;
}

/**
 * Pull the accumulated progress trail (an older worker's `{ progress }`
 * heartbeat) out of a workflow `describe()` result. Returns [] when there's
 * no pending activity or no heartbeat yet.
 */
export function extractHeartbeatProgress(description: DescribeLike): SpawnProgress[] {
  for (const obj of heartbeatDetails(description)) {
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
      // Forwarded so behavior conditioning survives the activity boundary. The
      // worker rebuilds spawn opts from this input alone.
      behaviorPreamble: spawnOpts.behaviorPreamble,
      dbPath: opts.dbPath,
      variablesPath: opts.variablesPath,
      llmSettingsPath: opts.llmSettingsPath,
      experimentalApple: spawnOpts.experimentalApple,
      agentCallInfo: spawnOpts.agentCallInfo,
      memoryRunId: spawnOpts.memoryRunId,
      runFiles: spawnOpts.runFiles,
      spendBudgetUsd: spawnOpts.spendBudgetUsd,
      askRunId: spawnOpts.askRunId,
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

    // Live progress: poll the workflow's heartbeated progress and re-emit
    // whatever isn't yet surfaced through the real onProgress. Because the
    // executor still orchestrates in-process, this drives the normal path —
    // node_executions.progressJson writes AND the inbox token stream — for
    // Temporal runs, a second's worth of text at a time (the worker's
    // heartbeat throttle, worker.ts).
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    let emitted = 0;
    const cursor = newLiveCursor();
    let polling = false;
    const poll = async (): Promise<void> => {
      if (polling) return;
      polling = true;
      try {
        const desc = await handle.describe();
        // A worker reports { live } (text folded per node, live-progress.ts);
        // an older one, the { progress } trail of every event.
        const live = extractLiveProgress(desc as DescribeLike);
        if (live) {
          for (const { event } of takeNewProgress(live, cursor)) onProgress?.(event);
        } else {
          const trail = extractHeartbeatProgress(desc as DescribeLike);
          for (let i = emitted; i < trail.length; i++) onProgress?.(trail[i]);
          emitted = Math.max(emitted, trail.length);
        }
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
