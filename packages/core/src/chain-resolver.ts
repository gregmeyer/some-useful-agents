import type { AgentDefinition } from './types.js';

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
 */
export function resolveTemplate(
  template: string,
  outputs: Map<string, { result: string; exitCode: number }>
): string {
  return template.replace(/\{\{outputs\.([a-z0-9-]+)\.(result|exitCode)\}\}/g, (_, agentName, field) => {
    const output = outputs.get(agentName);
    if (!output) return '';
    if (field === 'result') return output.result;
    if (field === 'exitCode') return String(output.exitCode);
    return '';
  });
}

const MAX_CHAIN_DEPTH = 20;

export function validateChainDepth(agents: Map<string, AgentDefinition>): void {
  const order = resolveExecutionOrder(agents);
  if (order.length > MAX_CHAIN_DEPTH) {
    throw new Error(`Chain exceeds maximum depth of ${MAX_CHAIN_DEPTH} agents (has ${order.length})`);
  }
}
