/**
 * Agent v2 YAML import/export. The DB is the runtime source of truth;
 * YAML is the lossless serialisation format used for git commits, sharing,
 * and "before I hit save, let me diff this" workflows.
 *
 * parse → validate → in-memory Agent object.
 * export → stable key order → YAML string that parse can round-trip.
 *
 * Round-trip fidelity is a test invariant: `parse(export(a)) ≈ a` for any
 * valid Agent. "Approximately equal" ignores insignificant whitespace the
 * YAML serialiser may reshape.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Agent, AgentNode, AgentStatus, AgentSource } from './agent-v2-types.js';
import { agentV2Schema, type AgentV2Parsed } from './agent-v2-schema.js';

export class AgentYamlParseError extends Error {
  constructor(message: string, public readonly issues?: unknown[]) {
    super(message);
    this.name = 'AgentYamlParseError';
  }
}

/**
 * Parse a YAML v2 agent document. Validates via the Zod schema and returns
 * a ready-to-insert-into-DB Agent object. Throws `AgentYamlParseError` on
 * validation failure with issue details for the CLI to surface.
 */
export function parseAgent(yamlText: string): Agent {
  if (!yamlText.trim()) {
    throw new AgentYamlParseError('Empty agent YAML document.');
  }

  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new AgentYamlParseError(`Invalid YAML: ${(err as Error).message}`);
  }

  const result = agentV2Schema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new AgentYamlParseError(`Agent schema validation failed: ${summary}`, result.error.issues);
  }

  return parsedToAgent(result.data);
}

function parsedToAgent(p: AgentV2Parsed): Agent {
  const nodes: AgentNode[] = p.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    ...(n.command !== undefined && { command: n.command }),
    ...(n.prompt !== undefined && { prompt: n.prompt }),
    ...(n.model !== undefined && { model: n.model }),
    ...(n.maxTurns !== undefined && { maxTurns: n.maxTurns }),
    ...(n.allowedTools && { allowedTools: n.allowedTools }),
    ...(n.provider !== undefined && { provider: n.provider }),
    ...(n.timeout !== undefined && { timeout: n.timeout }),
    ...(n.env && { env: n.env }),
    ...(n.envAllowlist && { envAllowlist: n.envAllowlist }),
    ...(n.secrets && { secrets: n.secrets }),
    ...(n.redactSecrets !== undefined && { redactSecrets: n.redactSecrets }),
    ...(n.workingDirectory !== undefined && { workingDirectory: n.workingDirectory }),
    ...(n.dependsOn && { dependsOn: n.dependsOn }),
    ...(n.position && { position: n.position }),
  }));

  return {
    id: p.id,
    name: p.name,
    ...(p.description !== undefined && { description: p.description }),
    status: p.status as AgentStatus,
    ...(p.schedule !== undefined && { schedule: p.schedule }),
    ...(p.allowHighFrequency !== undefined && { allowHighFrequency: p.allowHighFrequency }),
    source: p.source as AgentSource,
    mcp: p.mcp,
    version: p.version,
    ...(p.provider !== undefined && { provider: p.provider }),
    ...(p.model !== undefined && { model: p.model }),
    ...(p.inputs && { inputs: p.inputs }),
    nodes,
    ...(p.signal && { signal: p.signal }),
    ...(p.outputWidget && { outputWidget: p.outputWidget }),
    ...(p.notify && { notify: p.notify as Agent['notify'] }),
    ...(p.author !== undefined && { author: p.author }),
    ...(p.tags && { tags: p.tags }),
  };
}

/**
 * Field emission order for `exportAgent`. Stable. Keeps git diffs predictable
 * and matches the order used by `sua agent new` in v0.7. Fields that are
 * undefined on a given agent are simply omitted.
 */
const AGENT_KEY_ORDER = [
  'id', 'name', 'description',
  'status', 'schedule', 'allowHighFrequency',
  'source', 'mcp', 'version',
  'provider', 'model',
  'inputs',
  'nodes',
  'signal',
  'outputWidget',
  'notify',
  'author', 'tags',
] as const;

const NODE_KEY_ORDER = [
  'id', 'type',
  'command', 'prompt', 'model', 'maxTurns', 'allowedTools', 'provider',
  'timeout', 'env', 'envAllowlist', 'secrets', 'redactSecrets', 'workingDirectory',
  'dependsOn',
  'position',
] as const;

/**
 * Serialise an Agent to YAML with stable key order. Skips any field that is
 * `undefined` (vs leaving it as `~` / null). Round-trips cleanly through
 * `parseAgent`.
 */
export function exportAgent(agent: Agent): string {
  const ordered: Record<string, unknown> = {};
  for (const key of AGENT_KEY_ORDER) {
    if (key === 'nodes') {
      ordered.nodes = agent.nodes.map((n) => orderedNode(n));
    } else {
      const v = (agent as unknown as Record<string, unknown>)[key];
      if (v !== undefined) ordered[key] = v;
    }
  }
  return stringifyYaml(ordered, {
    // Block-style output for multi-line command / prompt fields; keeps
    // YAML readable when a prompt spans several lines.
    lineWidth: 0,
    minContentWidth: 0,
  });
}

function orderedNode(node: AgentNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of NODE_KEY_ORDER) {
    const v = (node as unknown as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * Export many agents as a directory-tree-ready map of `filename → YAML text`.
 * Used by `sua workflow export` to dump an entire workspace to disk.
 */
export function exportAgents(agents: Agent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of agents) {
    out.set(`${a.id}.yaml`, exportAgent(a));
  }
  return out;
}
