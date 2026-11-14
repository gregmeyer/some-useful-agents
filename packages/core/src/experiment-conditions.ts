/**
 * A condition of an experiment (ADR-0078) as something to run: a copy of
 * the task agent with the condition's provider and model applied, and the
 * inputs the condition sets. The copy is never saved; it runs under its own
 * id so its runs stay out of the agent's own history, spend and state.
 */
import type { Agent, AgentNode } from './agent-v2-types.js';
import type { ExperimentLevel } from './experiments.js';

/** The id an experiment's runs of an agent are filed under (never an agent in the catalog). */
export function experimentAgentId(agentId: string): string {
  return `experiment--${agentId}`;
}

/** Whether a run's agent name is an experiment's copy, and of which agent. */
export function experimentAgentOf(agentName: string): string | undefined {
  return agentName.startsWith('experiment--') ? agentName.slice('experiment--'.length) : undefined;
}

const isLlm = (n: AgentNode) => n.type === 'llm-prompt' || n.type === 'claude-code' || n.tool === 'llm-prompt' || n.tool === 'claude-code';

/** What a condition's levels set between them (a later factor's level wins where two set the same thing). */
export function conditionSettings(levels: readonly ExperimentLevel[]): { version?: number; provider?: string; model?: string; inputs: Record<string, string> } {
  const out: { version?: number; provider?: string; model?: string; inputs: Record<string, string> } = { inputs: {} };
  for (const l of levels) {
    if (l.version !== undefined) out.version = l.version;
    if (l.provider) out.provider = l.provider;
    if (l.model) out.model = l.model;
    if (l.instructions) out.inputs.INSTRUCTIONS = l.instructions;
    Object.assign(out.inputs, l.inputs ?? {});
  }
  return out;
}

/**
 * The agent to run for a condition: `agent` (already the version the
 * condition names) with the condition's provider and model on the agent and
 * on every model node, under an experiment's id, never scheduled. Pure.
 */
export function agentForCondition(agent: Agent, levels: readonly ExperimentLevel[]): Agent {
  const { provider, model } = conditionSettings(levels);
  const pin = <T extends { provider?: Agent['provider']; model?: string }>(x: T): T => ({ ...x, ...(provider ? { provider } : {}), ...(model ? { model } : {}) });
  const { schedule: _schedule, ...rest } = agent;
  return {
    ...pin(rest),
    id: experimentAgentId(agent.id),
    nodes: agent.nodes.map((n) => (isLlm(n) && (provider || model) ? pin(n) : n)),
  };
}
