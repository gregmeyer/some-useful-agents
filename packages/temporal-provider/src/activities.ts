import type { AgentDefinition } from '@some-useful-agents/core';
import { buildAgentEnv, getTrustLevel, executeAgent, EncryptedFileStore } from '@some-useful-agents/core';

export interface RunAgentActivityInput {
  agent: AgentDefinition;
  secretsPath: string;
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

  const handle = executeAgent(input.agent, env);
  const execResult = await handle.promise;

  return {
    result: execResult.result,
    exitCode: execResult.exitCode,
    error: execResult.error,
    warnings,
  };
}
