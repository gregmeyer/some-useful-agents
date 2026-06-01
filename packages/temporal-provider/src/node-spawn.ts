import { randomUUID } from 'node:crypto';
import type { Client } from '@temporalio/client';
import type { SpawnNodeFn, SpawnResult } from '@some-useful-agents/core';
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

  return async (node, env, spawnOpts, _onProgress, signal): Promise<SpawnResult> => {
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
          : `Temporal node workflow failed: ${err instanceof Error ? err.message : String(err)}`,
        category: cancelled ? 'cancelled' : 'exit_nonzero',
        usedWorkflowProvider: 'temporal',
      };
    } finally {
      if (signal && !signal.aborted) signal.removeEventListener('abort', onAbort);
    }
  };
}
