import type { AgentDefinition, AgentNode, Agent, SpawnResult, SpawnProgress, Run, DagExecutorDeps } from '@some-useful-agents/core';
import {
  buildAgentEnv,
  getTrustLevel,
  executeAgent,
  EncryptedFileStore,
  redactKnownSecrets,
  resolveInputs,
  spawnNodeReal,
  executeAgentDag,
  RunStore,
  AgentStore,
  ToolStore,
  IntegrationsStore,
  VariablesStore,
} from '@some-useful-agents/core';
import { Context } from '@temporalio/activity';

function quiet<T>(make: () => T): T | undefined {
  try { return make(); } catch { return undefined; }
}

export interface RunAgentActivityInput {
  agent: AgentDefinition;
  secretsPath: string;
  /**
   * Names of community shell agents the caller has explicitly allowed to run.
   * The executor refuses community shell by default; include this agent's
   * name here to permit it. Travels with the activity payload so a worker
   * running on a different host inherits the caller's trust decision rather
   * than applying its own.
   */
  allowUntrustedShell?: string[];
  /**
   * Caller-supplied input values keyed by name. Resolved against the agent's
   * declared `inputs:` (defaults applied, types validated) inside the
   * activity so a misconfigured submit fails the activity with a clear
   * error rather than surfacing halfway through execution.
   */
  inputs?: Record<string, string>;
}

export interface RunAgentActivityResult {
  result: string;
  exitCode: number;
  error?: string;
  warnings: string[];
}

/**
 * Activity: run an agent end-to-end.
 * This runs on the worker (host machine) with access to shell + claude CLI + secrets store.
 * Workflows call this activity; workflows themselves are deterministic and can't spawn processes.
 */
export async function runAgentActivity(input: RunAgentActivityInput): Promise<RunAgentActivityResult> {
  // Only open the secrets store when the agent actually declares secrets.
  // Parallels the local-provider fix: a v2 passphrase-protected store
  // should not gate agents that never ask for a secret.
  const needsSecrets = (input.agent.secrets?.length ?? 0) > 0;
  const secrets = needsSecrets
    ? await new EncryptedFileStore(input.secretsPath).getAll()
    : undefined;
  const trustLevel = getTrustLevel(input.agent);

  const { env, missingSecrets, warnings } = buildAgentEnv({
    agent: input.agent,
    trustLevel,
    secrets,
  });

  if (missingSecrets.length > 0) {
    return {
      result: '',
      exitCode: 1,
      error: `Missing secrets: ${missingSecrets.join(', ')}. Run: sua secrets set <name>`,
      warnings,
    };
  }

  // Resolve declared inputs (defaults, type validation, required checks).
  // `rejectUndeclared: false` here matches LocalProvider — the activity can
  // be invoked from chain / scheduler paths that share a single inputs map
  // across a fleet, so extras must be tolerated. The CLI layer does strict
  // pre-validation for the targeted-invocation case.
  let inputs: Record<string, string>;
  try {
    inputs = resolveInputs(input.agent.inputs, input.inputs ?? {}, {
      agentName: input.agent.name,
      rejectUndeclared: false,
    });
  } catch (err) {
    return {
      result: '',
      exitCode: 1,
      error: err instanceof Error ? err.message : String(err),
      warnings,
    };
  }

  const allowUntrustedShell = new Set(input.allowUntrustedShell ?? []);
  let handle;
  try {
    handle = executeAgent(input.agent, env, { allowUntrustedShell, inputs });
  } catch (err) {
    return {
      result: '',
      exitCode: 1,
      error: err instanceof Error ? err.message : String(err),
      warnings,
    };
  }
  const execResult = await handle.promise;

  const shouldRedact = input.agent.redactSecrets;
  return {
    result: shouldRedact ? redactKnownSecrets(execResult.result) : execResult.result,
    exitCode: execResult.exitCode,
    error: execResult.error
      ? shouldRedact
        ? redactKnownSecrets(execResult.error)
        : execResult.error
      : undefined,
    warnings,
  };
}

/**
 * Input for {@link runNodeActivity}: one v2 DAG node, executed on the worker.
 *
 * `env` is the SAFE env — the dashboard-side spawnNode already stripped
 * sensitive keys (`stripSensitiveEnv`) before this crossed the activity
 * boundary, since Temporal persists activity inputs in workflow history. The
 * node's DECLARED secrets are named in `declaredSecrets` and re-read here from
 * `secretsPath` on the worker, never travelling in the payload.
 */
export interface RunNodeActivityInput {
  node: AgentNode;
  /** Sensitive keys already removed; declared secrets re-injected on the worker. */
  env: Record<string, string>;
  agentId: string;
  agentSource: Agent['source'];
  /** LLM provider waterfall (names only; onFallback telemetry is not propagated). */
  llmProviders?: string[];
  /** Path to the encrypted secrets file, read on the worker. */
  secretsPath: string;
  /** Names of the node's declared secrets to re-inject from `secretsPath`. */
  declaredSecrets: string[];
}

/**
 * Activity: run ONE DAG node on the worker via the same `spawnNodeReal` the
 * in-process executor uses. Heartbeats each progress event so (a) the run is
 * cancellable — Temporal only delivers cancellation to activities that
 * heartbeat — and (b) the Temporal UI shows liveness. The dashboard keeps
 * owning DAG orchestration; this just offloads the node's shell/LLM spawn.
 */
export async function runNodeActivity(input: RunNodeActivityInput): Promise<SpawnResult> {
  // Resolve the activity context defensively: present on a real worker (where
  // heartbeat + cancellation matter), absent when invoked directly (unit tests).
  let ctx: ReturnType<typeof Context.current> | undefined;
  try { ctx = Context.current(); } catch { ctx = undefined; }

  // Re-inject declared secrets from the worker-local secrets store. Only opened
  // when the node actually declares secrets.
  const env = { ...input.env };
  if (input.declaredSecrets.length > 0) {
    const all = await new EncryptedFileStore(input.secretsPath).getAll();
    const missing: string[] = [];
    for (const name of input.declaredSecrets) {
      if (name in all) env[name] = all[name];
      else missing.push(name);
    }
    if (missing.length > 0) {
      return {
        result: '',
        exitCode: 1,
        error: `Missing secrets on worker for node "${input.node.id}": ${missing.join(', ')}. Run 'sua secrets set <name>'.`,
        category: 'setup',
        usedWorkflowProvider: 'temporal',
      };
    }
  }

  // Heartbeat the FULL accumulated progress trail (not just the latest event)
  // as a single { progress } detail. A single `describe()` read on the
  // dashboard side then sees every event so far, so the poll-rebroadcast can
  // diff by index and re-emit any it hasn't surfaced yet — even if it missed
  // intermediate heartbeats. The heartbeat also keeps the activity cancellable.
  const progressTrail: SpawnProgress[] = [];
  const onProgress = (event: SpawnProgress): void => {
    progressTrail.push(event);
    try { ctx?.heartbeat({ progress: progressTrail }); } catch { /* outside activity ctx — ignore */ }
  };

  // Keepalive heartbeat: a node that produces no progress event for longer than
  // the workflow's heartbeatTimeout (30s) — e.g. an LLM that thinks before its
  // first streamed token — would otherwise look dead to Temporal and get killed
  // with "activity Heartbeat timeout" even though the child is working fine. Beat
  // on an interval regardless of progress, re-sending the current trail so the
  // dashboard's describe-poll still sees every event. Mirrors runDagActivity.
  const keepalive = ctx
    ? setInterval(() => {
        try {
          ctx?.heartbeat(progressTrail.length ? { progress: progressTrail } : undefined);
        } catch { /* ignore */ }
      }, 10_000)
    : undefined;

  try {
    const result = await spawnNodeReal(
      input.node,
      env,
      {
        agentId: input.agentId,
        agentSource: input.agentSource,
        // Community-shell trust is enforced by executeAgentDag before the node
        // ever reaches a backend, so the worker needs no allowlist here.
        allowUntrustedShell: new Set<string>(),
        llmSettings: input.llmProviders ? { providers: input.llmProviders } : undefined,
      },
      onProgress,
      ctx?.cancellationSignal,
    );

    return { ...result, usedWorkflowProvider: 'temporal' };
  } finally {
    if (keepalive) clearInterval(keepalive);
  }
}

/**
 * Input for {@link runDagActivity}: a whole v2 DAG run, executed on the worker.
 * All fields are serializable. Secrets/variables/tools are reconstructed on the
 * worker from the shared paths — nothing sensitive travels in the payload.
 */
export interface RunDagActivityInput {
  agent: Agent;
  runId: string;
  inputs?: Record<string, string>;
  triggeredBy: Run['triggeredBy'];
  /** Shared SQLite path (run/agent/tool/integration stores). */
  dbPath: string;
  /** Encrypted secrets file path. */
  secretsPath: string;
  /** Global variables JSON path (optional). */
  variablesPath?: string;
  /** Agent-state base dir (optional). */
  dataRoot?: string;
  /** LLM provider waterfall (names only). */
  llmProviders?: string[];
  /** Community shell agents pre-allowed by the operator. */
  allowUntrustedShell?: string[];
  /**
   * Run-scoped experimental Apple gate (from config at submit time). Lets the
   * worker resolve apple tools regardless of its own process env — fixes the
   * intermittent "tool did not resolve" on the Temporal worker.
   */
  experimentalApple?: boolean;
}

export interface RunDagActivityResult {
  status: string;
  error?: string;
}

/**
 * Activity: run an ENTIRE v2 DAG on the worker via the existing in-process
 * executor (B2 durable path). The run row is pre-created by the provider, so we
 * always pass `resume: true` — on the first attempt that's a no-op (no completed
 * nodes), and on a Temporal retry after a worker crash it skips finished nodes
 * and picks up where it stopped.
 *
 * Returns normally for BOTH completed and failed runs — a failed agent is a
 * legitimate terminal outcome and must NOT be retried. Only a real crash (the
 * activity never returns → heartbeat timeout) triggers Temporal's retry, which
 * is the resume path. Nodes run with the local spawner (we're already on the
 * worker; no per-node round-trip).
 */
export async function runDagActivity(input: RunDagActivityInput): Promise<RunDagActivityResult> {
  let ctx: ReturnType<typeof Context.current> | undefined;
  try { ctx = Context.current(); } catch { ctx = undefined; }

  const runStore = new RunStore(input.dbPath);
  const deps: DagExecutorDeps = {
    runStore,
    secretsStore: new EncryptedFileStore(input.secretsPath),
    agentStore: quiet(() => new AgentStore(input.dbPath)),
    toolStore: quiet(() => new ToolStore(input.dbPath)),
    integrationsStore: quiet(() => new IntegrationsStore(input.dbPath)),
    variablesStore: input.variablesPath ? quiet(() => new VariablesStore(input.variablesPath as string)) : undefined,
    allowUntrustedShell: new Set(input.allowUntrustedShell ?? []),
    experimentalApple: input.experimentalApple,
    llmSettings: input.llmProviders ? { providers: input.llmProviders } : undefined,
    dataRoot: input.dataRoot,
    // spawnNode omitted → spawnNodeReal (local execution on this worker).
  };

  // Keep the long activity alive + cancellable: heartbeat on an interval while
  // the DAG runs. The executor also heartbeats via node progress, but a DAG can
  // sit between nodes; this is the floor.
  const hb = ctx ? setInterval(() => { try { ctx?.heartbeat(); } catch { /* ignore */ } }, 10_000) : undefined;
  try {
    const run = await executeAgentDag(
      input.agent,
      {
        runId: input.runId,
        inputs: input.inputs,
        triggeredBy: input.triggeredBy,
        resume: true,
        signal: ctx?.cancellationSignal,
      },
      deps,
    );
    return { status: run.status, error: run.error };
  } finally {
    if (hb) clearInterval(hb);
    runStore.close();
  }
}
