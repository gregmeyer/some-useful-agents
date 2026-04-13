import { Connection, Client, WorkflowNotFoundError } from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import type { Provider, AgentDefinition, Run, RunStatus } from '@some-useful-agents/core';
import { RunStore } from '@some-useful-agents/core';
import { DEFAULT_TASK_QUEUE } from './worker.js';
import type { RunAgentWorkflowInput, RunAgentWorkflowResult } from './workflows.js';

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

  async submitRun(request: { agent: AgentDefinition; triggeredBy: Run['triggeredBy'] }): Promise<Run> {
    const run: Run = {
      id: randomUUID(),
      agentName: request.agent.name,
      status: 'pending',
      startedAt: new Date().toISOString(),
      triggeredBy: request.triggeredBy,
    };
    this.store.createRun(run);

    const input: RunAgentWorkflowInput = {
      agent: request.agent,
      secretsPath: this.options.secretsPath,
      allowUntrustedShell: [...this.allowUntrustedShell],
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
