import { randomUUID } from 'node:crypto';
import type { Provider, AgentDefinition, Run, RunStatus } from './types.js';
import { RunStore, type RunStoreOptions } from './run-store.js';
import { executeAgent, type ExecutionHandle } from './agent-executor.js';
import { buildAgentEnv, getTrustLevel } from './env-builder.js';
import { redactKnownSecrets } from './secret-redactor.js';
import type { SecretsStore } from './secrets-store.js';

export interface LocalProviderOptions {
  /**
   * Community shell agents are refused at execution time unless their name
   * appears here. Per-agent and per-provider-instance so that each CLI
   * invocation carries its own trust set — a daemon does NOT inherit CLI
   * flags across runs.
   */
  allowUntrustedShell?: ReadonlySet<string>;
  /** Retention window for the run store in days. Default 30. */
  retentionDays?: number;
}

export class LocalProvider implements Provider {
  name = 'local';
  private store: RunStore;
  private secretsStore?: SecretsStore;
  private running = new Map<string, ExecutionHandle>();
  private readonly allowUntrustedShell: ReadonlySet<string>;

  constructor(dbPath: string, secretsStore?: SecretsStore, options: LocalProviderOptions = {}) {
    const runStoreOptions: RunStoreOptions = { retentionDays: options.retentionDays };
    this.store = new RunStore(dbPath, runStoreOptions);
    this.secretsStore = secretsStore;
    this.allowUntrustedShell = options.allowUntrustedShell ?? new Set<string>();
  }

  async initialize(): Promise<void> {
    // No-op for local provider
  }

  async shutdown(): Promise<void> {
    for (const [id, handle] of this.running) {
      handle.kill();
      this.store.updateRun(id, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
        error: 'Provider shutting down',
      });
    }
    this.running.clear();
    this.store.close();
  }

  async submitRun(request: { agent: AgentDefinition; triggeredBy: Run['triggeredBy'] }): Promise<Run> {
    const run: Run = {
      id: randomUUID(),
      agentName: request.agent.name,
      status: 'running',
      startedAt: new Date().toISOString(),
      triggeredBy: request.triggeredBy,
    };

    this.store.createRun(run);

    const trustLevel = getTrustLevel(request.agent);
    const secrets = this.secretsStore ? await this.secretsStore.getAll() : undefined;
    const { env, missingSecrets, warnings } = buildAgentEnv({
      agent: request.agent,
      trustLevel,
      secrets,
    });

    for (const w of warnings) {
      console.warn(`[warning] ${w}`);
    }

    if (missingSecrets.length > 0) {
      this.store.updateRun(run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: `Missing secrets: ${missingSecrets.join(', ')}. Run: sua secrets set <name>`,
      });
      return this.store.getRun(run.id) as Run;
    }

    let handle: ExecutionHandle;
    try {
      handle = executeAgent(request.agent, env, { allowUntrustedShell: this.allowUntrustedShell });
    } catch (err) {
      // Executor can throw synchronously for gate violations (e.g.
      // UntrustedCommunityShellError). Record the failure so the run
      // shows up in history rather than surfacing only as an uncaught.
      this.store.updateRun(run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    this.running.set(run.id, handle);

    handle.promise.then((result) => {
      this.running.delete(run.id);

      const status: RunStatus = result.exitCode === 0 ? 'completed' : 'failed';
      const scrubbed = request.agent.redactSecrets
        ? {
            result: redactKnownSecrets(result.result),
            error: result.error ? redactKnownSecrets(result.error) : undefined,
          }
        : { result: result.result, error: result.error };

      this.store.updateRun(run.id, {
        status,
        completedAt: new Date().toISOString(),
        result: scrubbed.result,
        exitCode: result.exitCode,
        error: scrubbed.error,
      });
    });

    return run;
  }

  async getRun(runId: string): Promise<Run | null> {
    return this.store.getRun(runId);
  }

  async listRuns(filter?: { agentName?: string; status?: RunStatus; limit?: number }): Promise<Run[]> {
    return this.store.listRuns(filter);
  }

  async cancelRun(runId: string): Promise<void> {
    const handle = this.running.get(runId);
    if (handle) {
      handle.kill();
      this.running.delete(runId);
      this.store.updateRun(runId, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
        error: 'Cancelled by user',
      });
    }
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
