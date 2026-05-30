import { PROVIDERS, PROVIDER_IDS, detectLlms, type Agent, type LlmProvider } from '@some-useful-agents/core';

/**
 * One row in the "LLM Providers" section of the tools page. Derived from
 * `detectLlms()` + a walk of every active agent's nodes. The intent is
 * read-only discoverability: which CLIs are on PATH, how many agents
 * actually use each one, and what to do if a provider is missing.
 */
export interface ProviderUsageRow {
  id: LlmProvider;
  displayName: string;
  binary: string;
  installed: boolean;
  version?: string;
  /** Number of agents that have at least one LLM-prompt node resolving to this provider. */
  agentCount: number;
}

/** True when the node runs an LLM prompt. Matches `isLlmPromptType` in core. */
function isLlmPromptNode(type: string | undefined): boolean {
  return type === 'llm-prompt' || type === 'claude-code';
}

/**
 * Walk the agent list and compute per-provider usage. Provider resolution:
 * `node.provider ?? agent.provider ?? 'claude'` (the same default the
 * dispatcher uses). An agent is counted once per distinct provider it
 * uses, regardless of how many LLM-prompt nodes it has.
 */
export function computeProviderUsage(agents: Agent[]): ProviderUsageRow[] {
  const availability = detectLlms();
  const counts: Record<LlmProvider, number> = { claude: 0, codex: 0, 'apple-foundation-models': 0 };

  for (const agent of agents) {
    const agentDefault = (agent.provider ?? 'claude') as LlmProvider;
    const seen = new Set<LlmProvider>();
    for (const node of agent.nodes ?? []) {
      if (!isLlmPromptNode(node.type)) continue;
      const effective = (node.provider ?? agentDefault) as LlmProvider;
      if (effective in counts) seen.add(effective);
    }
    for (const id of seen) counts[id] += 1;
  }

  return PROVIDER_IDS.map((id) => {
    const def = PROVIDERS[id];
    const av = availability[id];
    return {
      id,
      displayName: def.displayName,
      binary: def.binary,
      installed: av.installed,
      version: av.version,
      agentCount: counts[id],
    };
  });
}
