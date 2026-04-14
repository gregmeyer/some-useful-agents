import { randomUUID } from 'node:crypto';
import type { Provider, RunRequest, Run, RunStatus } from './types.js';
import { RunStore, type RunStoreOptions } from './run-store.js';
import { executeAgent, type ExecutionHandle } from './agent-executor.js';
import { buildAgentEnv, getTrustLevel } from './env-builder.js';
import { redactKnownSecrets } from './secret-redactor.js';
import { resolveInputs } from './input-resolver.js';
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

  async submitRun(request: RunRequest): Promise<Run> {
    const run: Run = {
      id: randomUUID(),
      agentName: request.agent.name,
      status: 'running',
      startedAt: new Date().toISOString(),
      triggeredBy: request.triggeredBy,
    };

    this.store.createRun(run);

    // Resolve typed inputs (merge provided + YAML defaults, validate types).
    // Failures here (missing required, invalid type) surface as a failed run
    // in history AND rethrow so the caller sees it.
    //
    // `rejectUndeclared: false` — the provider is called from three places:
    // (1) per-agent `sua agent run` (one target), (2) chain execution
    // (shared inputs across a fleet), (3) scheduler daemon (daemon-wide
    // overrides across a mixed-declaration fleet). Only (1) can sensibly
    // know what the targeted agent declares; (2) and (3) pass a shared
    // map to every agent. Strict reject here would fail any agent in the
    // fleet that happens not to declare a given key. The CLI layer
    // pre-validates for case (1) before calling submitRun.
    let inputs: Record<string, string>;
    try {
      inputs = resolveInputs(request.agent.inputs, request.inputs ?? {}, {
        agentName: request.agent.name,
        rejectUndeclared: false,
      });
    } catch (err) {
      this.store.updateRun(run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const trustLevel = getTrustLevel(request.agent);
    // Only open the secrets store when the agent actually declares secrets.
    // Agents with no `secrets:` field never read from the store, and forcing
    // them to unlock a v2 passphrase-protected store is a v0.10 regression:
    // it coupled every run to the store's lock state even when no secret
    // was ever going to be injected.
    const needsSecrets = (request.agent.secrets?.length ?? 0) > 0;
    const secrets =
      needsSecrets && this.secretsStore ? await this.secretsStore.getAll() : undefined;
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
      handle = executeAgent(request.agent, env, {
        allowUntrustedShell: this.allowUntrustedShell,
        inputs,
      });
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
