import { Connection, Client, WorkflowNotFoundError } from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { Provider, RunRequest, Run, RunStatus, SpawnNodeFn, Agent, SubmitDagRunOptions } from '@some-useful-agents/core';
import { RunStore } from '@some-useful-agents/core';
import { DEFAULT_TASK_QUEUE } from './worker.js';
import { createTemporalSpawnNode } from './node-spawn.js';
import type { RunAgentWorkflowInput, RunAgentWorkflowResult } from './workflows.js';
import type { RunDagActivityInput, RunDagActivityResult } from './activities.js';

export interface TemporalProviderOptions {
  dbPath: string;           // local SQLite run-store for fast CLI queries
  secretsPath: string;      // path to encrypted secrets file (read by worker)
  address?: string;
  namespace?: string;
  taskQueue?: string;
  /**
   * Community shell agents permitted to run. Propagated to the worker via
   * the workflow input so workers inherit the submitter's trust decision.
   */
  allowUntrustedShell?: ReadonlySet<string>;
  /** Retention window for the local run-store mirror, in days. Default 30. */
  retentionDays?: number;
}

export class TemporalProvider implements Provider {
  name = 'temporal';

  private store: RunStore;
  private client!: Client;
  private connection!: Connection;
  private readonly options: Required<Omit<TemporalProviderOptions, 'allowUntrustedShell' | 'retentionDays'>>;
  private readonly allowUntrustedShell: ReadonlySet<string>;

  constructor(options: TemporalProviderOptions) {
    this.store = new RunStore(options.dbPath, { retentionDays: options.retentionDays });
    this.options = {
      dbPath: options.dbPath,
      secretsPath: options.secretsPath,
      address: options.address ?? process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      namespace: options.namespace ?? 'default',
      taskQueue: options.taskQueue ?? DEFAULT_TASK_QUEUE,
    };
    this.allowUntrustedShell = options.allowUntrustedShell ?? new Set<string>();
  }

  async initialize(): Promise<void> {
    this.connection = await Connection.connect({ address: this.options.address });
    this.client = new Client({ connection: this.connection, namespace: this.options.namespace });
  }

  async shutdown(): Promise<void> {
    await this.connection?.close();
    this.store.close();
  }

  /**
   * Build a node-execution backend (SpawnNodeFn) bound to this provider's
   * client + task queue (B1b). The dashboard injects the result as
   * `deps.spawnNode` so v2 DAG nodes run on the Temporal worker while the
   * dashboard keeps orchestrating the DAG. Must be called after
   * `initialize()` (the client must exist).
   */
  createSpawnNode(): SpawnNodeFn {
    return createTemporalSpawnNode({
      client: this.client,
      secretsPath: this.options.secretsPath,
      taskQueue: this.options.taskQueue,
    });
  }

  async submitRun(request: RunRequest): Promise<Run> {
    const run: Run = {
      id: randomUUID(),
      agentName: request.agent.name,
      status: 'pending',
      startedAt: new Date().toISOString(),
      triggeredBy: request.triggeredBy,
      usedWorkflowProvider: 'temporal',
    };
    this.store.createRun(run);

    const input: RunAgentWorkflowInput = {
      agent: request.agent,
      secretsPath: this.options.secretsPath,
      allowUntrustedShell: [...this.allowUntrustedShell],
      inputs: request.inputs,
    };

    // Fire-and-forget start; poll for status later via workflow handle
    const handle = await this.client.workflow.start('runAgentWorkflow', {
      taskQueue: this.options.taskQueue,
      workflowId: `sua-run-${run.id}`,
      args: [input],
    });

    this.store.updateRun(run.id, { status: 'running' });

    // Track completion in the background so status queries reflect final state
    void this.trackCompletion(run.id, handle.workflowId);

    return { ...run, status: 'running' };
  }

  /**
   * Submit a v2 DAG agent as a DURABLE Temporal run (B2). Pre-creates the run
   * row, starts one `sua-run-<runId>` workflow that runs the whole executor on
   * the worker, and returns immediately. The activity owns the run-status
   * lifecycle in the shared store; if the worker crashes, Temporal re-dispatches
   * the activity and it resumes from the last completed node. The state root
   * defaults to the db path's directory.
   */
  async submitDagRun(agent: Agent, opts: SubmitDagRunOptions): Promise<Run> {
    const runId = opts.runId ?? randomUUID();
    const run: Run = {
      id: runId,
      agentName: agent.id,
      status: 'pending',
      startedAt: new Date().toISOString(),
      triggeredBy: opts.triggeredBy,
      usedWorkflowProvider: 'temporal',
      workflowId: agent.id,
      workflowVersion: agent.version,
    };
    this.store.createRun(run);

    const input: RunDagActivityInput = {
      agent,
      runId,
      inputs: opts.inputs,
      triggeredBy: opts.triggeredBy,
      dbPath: this.options.dbPath,
      secretsPath: this.options.secretsPath,
      variablesPath: opts.variablesPath,
      dataRoot: opts.dataRoot ?? dirname(this.options.dbPath),
      llmProviders: opts.llmProviders,
      allowUntrustedShell: opts.allowUntrustedShell ?? [...this.allowUntrustedShell],
      experimentalApple: opts.experimentalApple,
    };

    const handle = await this.client.workflow.start('runDagWorkflow', {
      taskQueue: this.options.taskQueue,
      workflowId: `sua-run-${runId}`,
      args: [input],
    });

    // Persist the Temporal execution runId so the dashboard can deep-link to
    // this durable workflow's history (`/workflows/sua-run-<id>/<runId>/history`).
    this.store.updateRun(runId, { status: 'running', temporalRunId: handle.firstExecutionRunId });
    void this.trackDagCompletion(runId, handle.workflowId);

    return { ...run, status: 'running' };
  }

  /**
   * Safety net for durable runs: the activity writes the final run status into
   * the shared store itself, so on success we leave it alone. We only act on the
   * reject path — workflow terminated or all crash-retries exhausted — to mark a
   * still-running run failed so the dashboard stops polling.
   */
  private async trackDagCompletion(runId: string, workflowId: string): Promise<void> {
    try {
      await (this.client.workflow.getHandle(workflowId).result() as Promise<RunDagActivityResult>);
      // Activity already finalized the run row; nothing to do on success.
    } catch (err) {
      const current = this.store.getRun(runId);
      if (current && (current.status === 'running' || current.status === 'pending')) {
        this.store.updateRun(runId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: `Durable run workflow ended without finalizing: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  private async trackCompletion(runId: string, workflowId: string): Promise<void> {
    try {
      const handle = this.client.workflow.getHandle(workflowId);
      const result = await handle.result() as RunAgentWorkflowResult;

      const status: RunStatus = result.exitCode === 0 ? 'completed' : 'failed';
      this.store.updateRun(runId, {
        status,
        completedAt: new Date().toISOString(),
        result: result.result,
        exitCode: result.exitCode,
        error: result.error,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.store.updateRun(runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: errorMsg,
      });
    }
  }

  async getRun(runId: string): Promise<Run | null> {
    return this.store.getRun(runId);
  }

  async listRuns(filter?: { agentName?: string; status?: RunStatus; limit?: number }): Promise<Run[]> {
    return this.store.listRuns(filter);
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.store.getRun(runId);
    if (!run) return;

    try {
      const handle = this.client.workflow.getHandle(`sua-run-${runId}`);
      await handle.cancel();
    } catch (err) {
      if (!(err instanceof WorkflowNotFoundError)) throw err;
    }

    this.store.updateRun(runId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
      error: 'Cancelled by user',
    });
  }

  async getRunLogs(runId: string): Promise<string> {
    const run = this.store.getRun(runId);
    if (!run) return '';
    const parts: string[] = [];
    if (run.result) parts.push(run.result);
    if (run.error) parts.push(`[ERROR] ${run.error}`);
    return parts.join('\n') || '(no output)';
  }
}
