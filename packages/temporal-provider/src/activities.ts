import type { AgentDefinition } from '@some-useful-agents/core';
import {
  buildAgentEnv,
  getTrustLevel,
  executeAgent,
  EncryptedFileStore,
  redactKnownSecrets,
  resolveInputs,
} from '@some-useful-agents/core';

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
  const secretsStore = new EncryptedFileStore(input.secretsPath);
  const secrets = await secretsStore.getAll();
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
