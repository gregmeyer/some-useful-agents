import type { AgentDefinition, Run } from './types.js';
import type { Provider } from './types.js';
import { resolveExecutionOrder, resolveTemplate } from './chain-resolver.js';

export interface ChainResult {
  runs: Run[];
  outputs: Map<string, { result: string; exitCode: number }>;
  skipped: string[];
}

/**
 * Execute a chain of agents in dependency order.
 * Stops on first failure, marks downstream agents as skipped.
 */
export async function executeChain(
  agents: Map<string, AgentDefinition>,
  provider: Provider,
  triggeredBy: Run['triggeredBy'],
  pollInterval = 250,
): Promise<ChainResult> {
  const order = resolveExecutionOrder(agents);
  const outputs = new Map<string, { result: string; exitCode: number }>();
  const runs: Run[] = [];
  const skipped: string[] = [];
  let failed = false;

  for (const agent of order) {
    if (failed) {
      skipped.push(agent.name);
      continue;
    }

    // Resolve input template if present
    let resolvedAgent = agent;
    if (agent.input) {
      const resolvedInput = resolveTemplate(agent.input, outputs);
      // For claude-code agents, append to prompt. For shell agents, set as env var.
      if (agent.type === 'claude-code' && agent.prompt) {
        resolvedAgent = { ...agent, prompt: `${agent.prompt}\n\nInput: ${resolvedInput}` };
      } else if (agent.type === 'shell') {
        resolvedAgent = {
          ...agent,
          env: { ...(agent.env ?? {}), SUA_CHAIN_INPUT: resolvedInput },
        };
      }
    }

    const run = await provider.submitRun({ agent: resolvedAgent, triggeredBy });

    // Poll for completion
    let current = run;
    while (current.status === 'running' || current.status === 'pending') {
      await new Promise(r => setTimeout(r, pollInterval));
      const updated = await provider.getRun(run.id);
      if (updated) current = updated;
    }

    runs.push(current);

    if (current.status === 'completed') {
      outputs.set(agent.name, {
        result: current.result ?? '',
        exitCode: current.exitCode ?? 0,
      });
    } else {
      failed = true;
    }
  }

  return { runs, outputs, skipped };
}
