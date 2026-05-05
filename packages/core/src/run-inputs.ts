/**
 * Recover an agent's user-provided agent-level inputs from a prior run.
 *
 * Agent-level inputs (the user-typed `input_NAME` form fields) aren't stored
 * directly on `runs` — they flow into per-node `inputsJson` after merging
 * with secrets, env, defaults, etc. This helper reads the first node
 * execution's `inputsJson` and intersects with the agent's declared
 * `inputs:` keys to recover the original agent-level values.
 *
 * Used by:
 *   - the Run Now modal pre-fill
 *   - one-click manual retry (POST /runs/:id/retry)
 *
 * Returns an empty object if the run has no node executions yet, the agent
 * declares no inputs, or `inputsJson` is malformed. Never throws.
 */

import type { Agent } from './agent-v2-types.js';
import type { RunStore } from './run-store.js';

export function extractPriorAgentInputs(
  agent: Pick<Agent, 'inputs'>,
  runId: string,
  runStore: RunStore,
): Record<string, string> {
  if (!agent.inputs || Object.keys(agent.inputs).length === 0) return {};
  try {
    const execs = runStore.listNodeExecutions(runId);
    if (execs.length === 0 || !execs[0].inputsJson) return {};
    const allEnv = JSON.parse(execs[0].inputsJson) as Record<string, string>;
    const declared = new Set(Object.keys(agent.inputs));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(allEnv)) {
      if (declared.has(k) && typeof v === 'string' && v !== '') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
