import type { Agent, Provider } from '@some-useful-agents/core';

/**
 * Decide where a v2 DAG run should execute (B2). `'temporal'` means submit it as
 * a durable Temporal workflow; `'local'` means run it in-process.
 *
 *  - The provider must actually be Temporal AND expose `submitDagRun`, else local.
 *  - Then the agent's `runOn` decides: `'local'` opts out; `'temporal'` or
 *    undefined ⇒ durable (under a Temporal provider, durable is the default).
 *
 * Only the primary run paths (run-now, scheduler) consult this; inline sub-flows
 * always run in-process.
 */
export function resolveRunBackend(provider: Provider, agent: Pick<Agent, 'runOn'>): 'local' | 'temporal' {
  if (provider.name !== 'temporal' || typeof provider.submitDagRun !== 'function') return 'local';
  return agent.runOn === 'local' ? 'local' : 'temporal';
}
