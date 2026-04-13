import type { AgentDefinition } from './types.js';
import type { AgentSource } from './agent-loader.js';

export class CycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CycleError';
  }
}

export class MissingDependencyError extends Error {
  constructor(public readonly agent: string, public readonly missing: string) {
    super(`Agent "${agent}" depends on "${missing}" which does not exist`);
    this.name = 'MissingDependencyError';
  }
}

/**
 * A completed upstream agent's contribution to the chain's output map.
 * `source` propagates the upstream's trust level so downstream substitution
 * can wrap or block values from untrusted sources.
 */
export interface ChainOutput {
  result: string;
  exitCode: number;
  source: AgentSource;
}

/**
 * Delimiters used to wrap values substituted from untrusted (community)
 * upstream agents. Downstream claude-code prompts get the wrapped form so
 * the LLM can visually distinguish data from instructions.
 */
export const UNTRUSTED_BEGIN = '--- BEGIN UNTRUSTED INPUT';
export const UNTRUSTED_END = '--- END UNTRUSTED INPUT ---';

/**
 * Topological sort of agents based on dependsOn fields.
 * Returns agents in execution order (dependencies first).
 * Throws CycleError if circular dependencies exist.
 * Throws MissingDependencyError if a dependency doesn't exist.
 */
export function resolveExecutionOrder(agents: Map<string, AgentDefinition>): AgentDefinition[] {
  // Validate all dependencies exist
  for (const [name, agent] of agents) {
    for (const dep of agent.dependsOn ?? []) {
      if (!agents.has(dep)) {
        throw new MissingDependencyError(name, dep);
      }
    }
  }

  const sorted: AgentDefinition[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string, path: string[]) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const cycleStart = path.indexOf(name);
      throw new CycleError([...path.slice(cycleStart), name]);
    }

    visiting.add(name);
    path.push(name);

    const agent = agents.get(name)!;
    for (const dep of agent.dependsOn ?? []) {
      visit(dep, [...path]);
    }

    visiting.delete(name);
    visited.add(name);
    sorted.push(agent);
  }

  for (const name of agents.keys()) {
    visit(name, []);
  }

  return sorted;
}

/**
 * Resolve template strings like {{outputs.agent-name.result}}
 * against a map of completed agent outputs.
 *
 * Untrusted values (from `community` upstreams) are wrapped in BEGIN/END
 * UNTRUSTED INPUT delimiters so downstream prompts can distinguish them.
 */
export function resolveTemplate(
  template: string,
  outputs: Map<string, ChainOutput>,
): string {
  return resolveTemplateTagged(template, outputs).text;
}

/**
 * Like `resolveTemplate` but also returns the set of upstream sources whose
 * outputs contributed to the substitution. Callers use this to decide
 * whether to wrap the downstream prompt or refuse the run outright.
 */
export function resolveTemplateTagged(
  template: string,
  outputs: Map<string, ChainOutput>,
): { text: string; upstreamSources: Set<AgentSource> } {
  const upstreamSources = new Set<AgentSource>();
  const text = template.replace(
    /\{\{outputs\.([a-z0-9-]+)\.(result|exitCode)\}\}/g,
    (_, agentName, field) => {
      const output = outputs.get(agentName);
      if (!output) return '';
      upstreamSources.add(output.source);
      const raw = field === 'result' ? output.result : String(output.exitCode);
      if (output.source === 'community') {
        return (
          `\n${UNTRUSTED_BEGIN} FROM ${agentName} (source=community) ---\n` +
          `${raw}\n` +
          `${UNTRUSTED_END}\n`
        );
      }
      return raw;
    },
  );
  return { text, upstreamSources };
}

const MAX_CHAIN_DEPTH = 20;

export function validateChainDepth(agents: Map<string, AgentDefinition>): void {
  const order = resolveExecutionOrder(agents);
  if (order.length > MAX_CHAIN_DEPTH) {
    throw new Error(`Chain exceeds maximum depth of ${MAX_CHAIN_DEPTH} agents (has ${order.length})`);
  }
}
