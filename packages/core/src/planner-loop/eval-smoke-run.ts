/**
 * Smoke-run evaluator: a per-newAgent "would this actually load and run?"
 * check that runs AFTER the structural critic. Catches runtime gotchas
 * that the zod schema and critic can't see:
 *
 *  - shell `tool:` referencing an id not in the known-tools catalog
 *  - signal.mapping fields naming an output key the agent doesn't declare
 *  - typed-widget field names naming an output key the agent doesn't declare
 *
 * Each new agent goes through `parseAgent` (re-runs the strict zod schema
 * — surfaces issues with clearer per-agent paths than the critic's bulk
 * check) then through the cross-reference checks above.
 *
 * Returns a `{ agentId, errors[] }` per newAgent that flagged anything;
 * an empty array = clean smoke for the whole plan.
 */

import { parseAgent, AgentYamlParseError } from '../agent-yaml.js';
import type { Agent } from '../agent-v2-types.js';
import type { BuildPlan } from '../build-plan-schema.js';

export interface SmokeRunError {
  path: string;
  message: string;
}

export interface SmokeRunAgentResult {
  agentId: string;
  errors: SmokeRunError[];
}

export interface SmokeRunResult {
  ok: boolean;
  /** One entry per newAgent that failed smoke. Empty when ok. */
  perAgent: SmokeRunAgentResult[];
}

export interface SmokeRunContext {
  /**
   * Tool ids the dispatcher can resolve. When supplied, shell nodes
   * referencing tools outside this set get flagged. Pass an empty set to
   * skip the check (e.g. when running the planner in a test harness with
   * no tool registry).
   */
  knownToolIds?: Set<string>;
}

/**
 * Run the per-agent shape + cross-reference checks against a single agent
 * definition. Exported separately from `smokeRunNewAgents` so callers
 * (PR 4's AgentLoopRunner, future tools) can reuse it.
 */
export function validateOnly(agent: Agent, ctx: SmokeRunContext = {}): SmokeRunError[] {
  const errors: SmokeRunError[] = [];

  // Output keys the agent declares — used by signal/widget mapping checks.
  const declaredOutputs = new Set(Object.keys(agent.outputs ?? {}));

  // 1. Shell tool refs must resolve against the known-tools catalog.
  if (ctx.knownToolIds && ctx.knownToolIds.size > 0) {
    for (let i = 0; i < agent.nodes.length; i++) {
      const node = agent.nodes[i];
      if (node.type === 'shell' && node.tool && !ctx.knownToolIds.has(node.tool)) {
        errors.push({
          path: `nodes.${i}.tool`,
          message: `Shell node "${node.id}" references tool "${node.tool}" which isn't in the tools catalog.`,
        });
      }
    }
  }

  // 2. signal.mapping values that name an output key — must be declared.
  //    Mapping values are either a literal string (free text) or the name
  //    of a top-level output key. We can't tell the difference reliably,
  //    so we only flag when the value LOOKS like a key (matches /^[a-z_][a-z0-9_]*$/i)
  //    AND isn't in declaredOutputs AND declaredOutputs is non-empty.
  //    Conservative: when outputs is empty, skip the check entirely
  //    (probably an agent that doesn't declare its outputs yet).
  if (agent.signal?.mapping && declaredOutputs.size > 0) {
    for (const [slot, value] of Object.entries(agent.signal.mapping)) {
      if (typeof value !== 'string') continue;
      if (!/^[a-z_][a-z0-9_]*$/i.test(value)) continue; // looks like literal text, not a key
      if (!declaredOutputs.has(value)) {
        errors.push({
          path: `signal.mapping.${slot}`,
          message: `signal.mapping.${slot} references "${value}" which isn't a declared output key. Add to \`outputs:\` or use a literal string.`,
        });
      }
    }
  }

  // 3. Typed output-widget field names — must match a declared output key
  //    (ai-template widgets don't declare scalar fields, skip).
  if (agent.outputWidget && agent.outputWidget.type !== 'ai-template' && declaredOutputs.size > 0) {
    const fields = agent.outputWidget.fields ?? [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!declaredOutputs.has(f.name)) {
        errors.push({
          path: `outputWidget.fields.${i}.name`,
          message: `outputWidget field "${f.name}" doesn't match any declared output key on this agent.`,
        });
      }
    }
  }

  return errors;
}

/**
 * Smoke-run every newAgent in a plan. Each newAgent is parsed (zod
 * roundtrip) then validated. Parse failures and validation errors both
 * land in the result; a single parse failure for an agent skips its
 * validation pass (no point validating something that didn't parse).
 */
export function smokeRunNewAgents(plan: BuildPlan, ctx: SmokeRunContext = {}): SmokeRunResult {
  const perAgent: SmokeRunAgentResult[] = [];
  for (const newAgent of plan.newAgents) {
    const errs: SmokeRunError[] = [];
    let parsed: Agent | null = null;
    try {
      parsed = parseAgent(newAgent.yaml);
    } catch (e) {
      const message = e instanceof AgentYamlParseError ? e.message : `parse error: ${(e as Error).message}`;
      errs.push({ path: 'yaml', message });
    }
    if (parsed) {
      for (const v of validateOnly(parsed, ctx)) errs.push(v);
    }
    if (errs.length > 0) perAgent.push({ agentId: newAgent.id, errors: errs });
  }
  return { ok: perAgent.length === 0, perAgent };
}

/**
 * Render a smoke-run result as critic-style feedback the planner can
 * digest on retry. Mirrors `formatCriticFeedback` so the reflect-step
 * can hand both to the next compose invocation in one combined block.
 */
export function formatSmokeFeedback(result: SmokeRunResult): string {
  if (result.ok) return '';
  const lines: string[] = [];
  lines.push('Smoke-run feedback on your previous plan (each new agent failed to validate after parsing — fix every item below):');
  for (const a of result.perAgent) {
    lines.push(`- newAgent "${a.agentId}":`);
    for (const err of a.errors) {
      lines.push(`  - ${err.path}: ${err.message}`);
    }
  }
  return lines.join('\n');
}
