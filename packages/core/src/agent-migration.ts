/**
 * v1 YAML → v2 DAG-agent migration. Reads the filesystem-loaded v1
 * `AgentDefinition` set (what `loadAgents()` returns today), groups agents
 * into connected components via transitive `dependsOn` closure, and
 * produces one v2 `Agent` per component.
 *
 * Migration is idempotent: running it twice yields the same result. The
 * importer uses `AgentStore.upsertAgent` under the hood — identical DAGs
 * skip the version bump, changed DAGs cut a new version. Callers hand us
 * the `loadAgents` output rather than a path, so this module stays pure
 * (no filesystem reads of its own) and is easy to unit-test.
 *
 * Rules (see ~/.claude/plans/eager-splashing-toast.md):
 *   - Isolated v1 agent (no `dependsOn`) → single-node DAG.
 *   - Chain of 2+ connected v1 agents → one DAG with nodes inline; the
 *     leaf (nothing depends on it) becomes the DAG's id/name.
 *   - `{{outputs.X.result}}` in a v1 `input:` or claude-code `prompt:`
 *     is rewritten to `{{upstream.X.result}}`.
 *   - v1 `input:` (the downstream-consumes-upstream chain field) is
 *     merged into the node's prompt for claude-code, dropped for shell
 *     (shell gets upstream via `$UPSTREAM_<NODEID>_RESULT` instead).
 *   - `.yaml.disabled` agents from v0.11 → `status: 'paused'`.
 *   - `source` is preserved from the participating v1 agents. Mixed-source
 *     components (e.g. a local agent depending on a community one) are
 *     refused — the user has to resolve manually, because the v2 model
 *     doesn't support mixed-trust within one DAG.
 */

import type { AgentDefinition } from './types.js';
import type {
  Agent,
  AgentNode,
  AgentSource,
  AgentStatus,
} from './agent-v2-types.js';
import type { AgentStore } from './agent-store.js';

/** A v1-agent-identified-as-disabled flag the caller can stamp before passing in. */
export interface V1Input {
  agent: AgentDefinition;
  /** True iff the YAML file was loaded from `<name>.yaml.disabled`. */
  disabled?: boolean;
}

export interface MigrationPlanAgent {
  id: string;
  name: string;
  description?: string;
  status: AgentStatus;
  schedule?: string;
  source: AgentSource;
  mcp: boolean;
  /** v1 agent names that became nodes in this DAG. */
  contributingV1Names: string[];
  nodes: AgentNode[];
  inputs?: Record<string, unknown>; // shape = AgentInputSpec; kept loose here for forwarding
}

export interface MigrationWarning {
  kind: 'mixed-source' | 'missing-dependency' | 'unresolvable-chain';
  message: string;
  /** v1 agent names involved. */
  agents: string[];
}

export interface MigrationPlan {
  agents: MigrationPlanAgent[];
  warnings: MigrationWarning[];
}

/**
 * Build a migration plan without writing anything. Pure function of the
 * input v1 agent set. Call `applyMigration(plan, store)` to commit.
 */
export function planMigration(inputs: V1Input[]): MigrationPlan {
  const byName = new Map<string, V1Input>();
  for (const i of inputs) byName.set(i.agent.name, i);

  const warnings: MigrationWarning[] = [];

  // Build bidirectional adjacency over `dependsOn` to find connected
  // components. A dependency edge from A → B means A needs B's output.
  const undirected = new Map<string, Set<string>>();
  for (const { agent } of inputs) undirected.set(agent.name, new Set());
  for (const { agent } of inputs) {
    for (const dep of agent.dependsOn ?? []) {
      if (!byName.has(dep)) {
        warnings.push({
          kind: 'missing-dependency',
          message: `Agent "${agent.name}" dependsOn "${dep}" but "${dep}" is not in the input set.`,
          agents: [agent.name, dep],
        });
        continue;
      }
      undirected.get(agent.name)!.add(dep);
      undirected.get(dep)!.add(agent.name);
    }
  }

  // Flood-fill to find components.
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const name of byName.keys()) {
    if (visited.has(name)) continue;
    const stack = [name];
    const component: string[] = [];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (visited.has(n)) continue;
      visited.add(n);
      component.push(n);
      for (const neighbour of undirected.get(n) ?? []) {
        if (!visited.has(neighbour)) stack.push(neighbour);
      }
    }
    components.push(component);
  }

  const plannedAgents: MigrationPlanAgent[] = [];
  for (const component of components) {
    const planned = planComponent(component, byName, warnings);
    if (planned) plannedAgents.push(planned);
  }

  // Deterministic output order (stable across runs).
  plannedAgents.sort((a, b) => a.id.localeCompare(b.id));

  return { agents: plannedAgents, warnings };
}

/** Apply a pre-built plan to an AgentStore. Idempotent via upsertAgent. */
export function applyMigration(plan: MigrationPlan, store: AgentStore): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;
  for (const p of plan.agents) {
    const agent: Omit<Agent, 'version'> = {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      schedule: p.schedule,
      source: p.source,
      mcp: p.mcp,
      nodes: p.nodes,
      inputs: p.inputs as Record<string, never> | undefined,
    };
    const existingVersion = store.getAgent(p.id)?.version;
    const after = store.upsertAgent(agent, 'import', `Migrated from v1 YAML (contributing: ${p.contributingV1Names.join(', ')})`);
    if (existingVersion === after.version) {
      skipped += 1;
    } else {
      imported += 1;
    }
  }
  return { imported, skipped };
}

// -- internals --

function planComponent(
  memberNames: string[],
  byName: Map<string, V1Input>,
  warnings: MigrationWarning[],
): MigrationPlanAgent | undefined {
  const members = memberNames.map((n) => byName.get(n)!).filter(Boolean);
  if (members.length === 0) return undefined;

  // Mixed-source components are refused — v2 requires one source per DAG.
  const sources = new Set(members.map((m) => m.agent.source ?? 'local'));
  if (sources.size > 1) {
    warnings.push({
      kind: 'mixed-source',
      message:
        `Cannot merge connected v1 agents with differing source levels: ${memberNames.join(', ')}. ` +
        `Sources present: ${[...sources].join(', ')}. ` +
        `Resolve manually by re-authoring under one source before re-running the migration.`,
      agents: memberNames,
    });
    return undefined;
  }
  const source = [...sources][0] as AgentSource;

  // Pick the leaf: the single agent nothing depends on within this component.
  // Candidates are members that don't appear in any other member's dependsOn.
  const depTargets = new Set<string>();
  for (const m of members) {
    for (const dep of m.agent.dependsOn ?? []) depTargets.add(dep);
  }
  const leaves = members.filter((m) => !depTargets.has(m.agent.name));
  if (leaves.length === 0) {
    warnings.push({
      kind: 'unresolvable-chain',
      message:
        `Component ${memberNames.join(', ')} has no leaf (every agent is depended on). ` +
        `Most likely a cycle in v1 dependsOn that somehow escaped v1 validation.`,
      agents: memberNames,
    });
    return undefined;
  }

  // If multiple leaves, pick the first by name for determinism and warn —
  // means the user had a fan-out chain with multiple "final" agents, which
  // v2 doesn't directly support. They'll end up with one DAG named after
  // the alphabetically-first leaf. Not great, but workable; the user can
  // rename + split after reviewing.
  leaves.sort((a, b) => a.agent.name.localeCompare(b.agent.name));
  const leaf = leaves[0];
  if (leaves.length > 1) {
    warnings.push({
      kind: 'unresolvable-chain',
      message:
        `Component ${memberNames.join(', ')} has multiple leaves: ${leaves.map((l) => l.agent.name).join(', ')}. ` +
        `Merged DAG will take its identity from "${leaf.agent.name}"; review and rename if needed.`,
      agents: memberNames,
    });
  }

  // Build per-node config from each v1 agent. node.id = v1 name (safe: v1
  // names are lowercased-hyphened, which is node-id-compatible).
  const nodes: AgentNode[] = members.map((m) => v1ToNode(m));

  // Merge agent-level inputs: union across all members. Collisions (same
  // key in two members with different specs) resolve to the leaf's spec
  // and emit a warning.
  let inputs: Record<string, unknown> | undefined;
  for (const m of members) {
    if (!m.agent.inputs) continue;
    inputs = inputs ?? {};
    for (const [k, spec] of Object.entries(m.agent.inputs)) {
      if (k in inputs) {
        // Prefer the leaf's spec silently if it matches. If it differs,
        // issue a warning but still keep the leaf-or-first value.
        const existing = JSON.stringify((inputs as Record<string, unknown>)[k]);
        const incoming = JSON.stringify(spec);
        if (existing !== incoming) {
          warnings.push({
            kind: 'unresolvable-chain',
            message: `Input "${k}" is declared with conflicting specs across ${memberNames.join(', ')}; keeping the first seen.`,
            agents: memberNames,
          });
        }
      } else {
        (inputs as Record<string, unknown>)[k] = spec;
      }
    }
  }

  // Preserve schedule only from the leaf (closest to "when this DAG fires").
  const schedule = leaf.agent.schedule;

  // mcp: true if any participant was mcp-exposed. Community shell gating
  // is still per-agent; `mcp` here gates WHICH agent is callable from MCP.
  // The leaf usually makes sense as the MCP handle; treat union-true as
  // "leaf is exposed."
  const mcp = leaf.agent.mcp === true;

  // Status: paused if any contributing file was `.disabled`. Otherwise
  // start as 'active' so the import is immediately usable. Users can
  // archive via `sua workflow status <id> archived` if not desired live.
  const anyDisabled = members.some((m) => m.disabled === true);
  const status: AgentStatus = anyDisabled ? 'paused' : 'active';

  return {
    id: leaf.agent.name,
    name: leaf.agent.name,
    description: leaf.agent.description,
    status,
    schedule,
    source,
    mcp,
    contributingV1Names: memberNames.slice().sort(),
    nodes,
    inputs,
  };
}

/**
 * Convert one v1 `AgentDefinition` to a v2 `AgentNode`. Rewrites
 * `{{outputs.X.result}}` templates in the prompt (claude-code) to
 * `{{upstream.X.result}}`. Drops the v1 `input:` field — in the v2
 * model upstream outputs reach claude-code via the prompt template and
 * shell via `$UPSTREAM_<NODEID>_RESULT` env vars, both assembled by the
 * executor.
 */
function v1ToNode({ agent }: V1Input): AgentNode {
  const node: AgentNode = {
    id: agent.name,
    type: agent.type,
  };

  if (agent.type === 'shell' && agent.command) {
    node.command = agent.command;
  }
  if (agent.type === 'claude-code' && agent.prompt) {
    let prompt = agent.prompt;
    // If the v1 agent had `input: "{{outputs.X.result}}"`, stitch that
    // value into the prompt at the end. Otherwise Claude would never see
    // the upstream output, since v1's input: was a separate field.
    if (agent.input) {
      const rewrittenInput = rewriteOutputsToUpstream(agent.input);
      prompt = `${prompt}\n\n${rewrittenInput}`;
    }
    node.prompt = rewriteOutputsToUpstream(prompt);
    if (agent.model) node.model = agent.model;
    if (agent.maxTurns) node.maxTurns = agent.maxTurns;
    if (agent.allowedTools?.length) node.allowedTools = agent.allowedTools;
  }

  if (agent.timeout !== undefined) node.timeout = agent.timeout;
  if (agent.env) node.env = agent.env;
  if (agent.envAllowlist?.length) node.envAllowlist = agent.envAllowlist;
  if (agent.secrets?.length) node.secrets = agent.secrets;
  if (agent.redactSecrets !== undefined) node.redactSecrets = agent.redactSecrets;
  if (agent.workingDirectory) node.workingDirectory = agent.workingDirectory;
  if (agent.dependsOn?.length) node.dependsOn = agent.dependsOn;

  return node;
}

function rewriteOutputsToUpstream(text: string): string {
  return text.replace(
    /\{\{\s*outputs\.([a-z0-9][a-z0-9-]*)\.result\s*\}\}/g,
    (_match, name: string) => `{{upstream.${name}.result}}`,
  );
}
