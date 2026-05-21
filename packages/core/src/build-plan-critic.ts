/**
 * Plan critic — second-pass structural validation for build-planner output.
 *
 * `buildPlanSchema` (Zod) catches obvious shape violations: wrong intent,
 * missing dashboard sections, agent IDs that aren't in survey.matchedAgents
 * or newAgents. The critic catches the next layer: things that *look*
 * structurally valid to the schema but don't survive contact with reality.
 *
 * Concretely:
 *  - newAgent YAMLs must round-trip through `parseAgent` (after autoFix).
 *    Real failure observed in the wild: planner emitted a `signal` node
 *    missing the required `title` field — schema-valid, parse-broken.
 *  - loopConfig.agentId / agentInvokeConfig.agentId inside newAgent YAMLs
 *    must reference either another newAgent or an existing catalog agent.
 *    Schema doesn't peek inside YAML strings.
 *  - newAgent.id collisions (the schema permits duplicates).
 *  - survey.matchedAgents.id must exist in the actual catalog. The schema's
 *    `knownIds` set trusts whatever the planner wrote; we need ground truth.
 *
 * Output shape is deliberately structured: each error has a path + message
 * so the caller can build a tight "Critic feedback:" block to feed back
 * into the planner for retry.
 */

import { parseAgent } from './agent-yaml.js';
import type { BuildPlan } from './build-plan-schema.js';

export interface PlanCriticError {
  /** Dotted path into the plan (e.g. `newAgents[0].yaml`, `dashboard.sections[1].agentIds[0]`). */
  path: string;
  /** Human-readable problem statement, written to be useful when fed back to the LLM. */
  message: string;
}

export interface PlanCriticResult {
  ok: boolean;
  errors: PlanCriticError[];
}

export interface PlanCriticContext {
  /** Set of agent IDs that exist in the local catalog. */
  existingAgentIds: Set<string>;
}

/**
 * Run the critic against a parsed BuildPlan. The plan is assumed to have
 * already passed `buildPlanSchema.safeParse` (so basic shape is sound).
 *
 * Caller is expected to have applied autoFixYaml to each newAgent.yaml
 * before invoking the critic — autoFix lives in the dashboard package
 * and is part of the extract step that runs upstream of this.
 */
export function critiquePlan(plan: BuildPlan, ctx: PlanCriticContext): PlanCriticResult {
  const errors: PlanCriticError[] = [];

  // Build the set of IDs known after this plan would land. Used both for
  // dashboard section validation and for cross-references inside newAgent
  // YAMLs (a newAgent may invoke another newAgent in the same plan).
  const newAgentIds = new Set<string>();
  const seenNew = new Set<string>();
  plan.newAgents.forEach((a, i) => {
    if (seenNew.has(a.id)) {
      errors.push({
        path: `newAgents[${i}].id`,
        message: `Duplicate newAgents.id "${a.id}" — each new agent needs a unique id.`,
      });
    }
    seenNew.add(a.id);
    newAgentIds.add(a.id);
  });

  // matchedAgents must reference catalog reality. Schema can't know what's
  // installed; we do.
  plan.survey.matchedAgents.forEach((m, i) => {
    if (!ctx.existingAgentIds.has(m.id)) {
      errors.push({
        path: `survey.matchedAgents[${i}].id`,
        message: `survey.matchedAgents references agent id "${m.id}" which is not installed. Drop it from matchedAgents (and add it to newAgents if you intended to create it).`,
      });
    }
  });

  // After-this-plan-lands universe of agent IDs.
  const allIds = new Set<string>([...ctx.existingAgentIds, ...newAgentIds]);

  // Dashboard section agentIds must resolve against the post-plan universe.
  // (Schema only checks against survey.matchedAgents + newAgents, which can
  // both lie. This is the ground-truth check.)
  if (plan.dashboard) {
    plan.dashboard.sections.forEach((s, sIdx) => {
      s.agentIds.forEach((id, aIdx) => {
        if (!allIds.has(id)) {
          errors.push({
            path: `dashboard.sections[${sIdx}].agentIds[${aIdx}]`,
            message: `Dashboard references agent id "${id}" but no installed agent or newAgent has that id. Either add a newAgent with id="${id}" or pick an installed agent.`,
          });
        }
      });
    });
  }

  // Walk each newAgent YAML: parse + check internal cross-refs.
  plan.newAgents.forEach((a, i) => {
    let agent;
    try {
      agent = parseAgent(a.yaml);
    } catch (e) {
      errors.push({
        path: `newAgents[${i}].yaml`,
        message: `newAgents[${i}] (id="${a.id}") YAML failed to parse: ${(e as Error).message}`,
      });
      return;
    }
    // YAML id must match the plan ref id — otherwise commit will skip.
    if (agent.id !== a.id) {
      errors.push({
        path: `newAgents[${i}].yaml`,
        message: `newAgents[${i}] declares id="${a.id}" but the YAML's id field is "${agent.id}". They must match.`,
      });
    }
    // loopConfig.agentId / agentInvokeConfig.agentId references.
    (agent.nodes ?? []).forEach((n, nIdx) => {
      const refs: Array<{ field: string; id: string | undefined }> = [
        { field: 'loopConfig.agentId', id: n.loopConfig?.agentId },
        { field: 'agentInvokeConfig.agentId', id: n.agentInvokeConfig?.agentId },
      ];
      for (const { field, id } of refs) {
        if (!id) continue;
        if (!allIds.has(id)) {
          errors.push({
            path: `newAgents[${i}].yaml.nodes[${nIdx}].${field}`,
            message: `Node "${n.id}" in newAgent "${a.id}" references agent id "${id}" via ${field}, but no installed agent or newAgent has that id.`,
          });
        }
      }
    });

    // ai-template path check: the placeholder substituter ONLY supports
    // single-level paths (`{{outputs.NAME}}`, `{{item.FIELD}}`). Nested
    // paths like `outputs.featured_duel.title` or `item.away_pitcher.name`
    // leak the literal placeholder into the rendered widget. Flag them so
    // the drafter can flatten on retry.
    const widget = (agent as { outputWidget?: { type?: string; template?: string } }).outputWidget;
    if (widget?.type === 'ai-template' && typeof widget.template === 'string') {
      const tpl = widget.template;
      // Outer outputs.X.Y — match anything past the first dot-segment.
      const outerNestedRe = /\{\{\{?\s*outputs\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*/g;
      let m: RegExpExecArray | null;
      const outerHits = new Set<string>();
      while ((m = outerNestedRe.exec(tpl)) !== null) outerHits.add(m[0]);
      for (const hit of outerHits) {
        errors.push({
          path: `newAgents[${i}].yaml.outputWidget.template`,
          message: `ai-template uses nested path "${hit.replace(/^\{\{\{?\s*/, '').trim()}…}}" — the substituter only supports single-level outputs.NAME. Flatten the value into a top-level scalar output (e.g. featured_duel_title) and reference it without nesting.`,
        });
      }
      // Inner item.X.Y inside #each blocks. Match across all #each bodies.
      const eachRe = /\{\{\s*#each\s+outputs\.[a-zA-Z_][a-zA-Z0-9_]*\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g;
      const innerHits = new Set<string>();
      while ((m = eachRe.exec(tpl)) !== null) {
        const itemName = m[1];
        const body = m[2];
        const innerRe = new RegExp(`\\{\\{\\{?\\s*${itemName}\\.[a-zA-Z_][a-zA-Z0-9_]*\\.[a-zA-Z_][a-zA-Z0-9_]*`, 'g');
        let im: RegExpExecArray | null;
        while ((im = innerRe.exec(body)) !== null) innerHits.add(im[0]);
      }
      for (const hit of innerHits) {
        errors.push({
          path: `newAgents[${i}].yaml.outputWidget.template`,
          message: `ai-template uses nested item path "${hit.replace(/^\{\{\{?\s*/, '').trim()}…}}" inside an #each block — only single-level item.FIELD is supported. Flatten the per-row value into a scalar (e.g. away_pitcher_name) on each array element.`,
        });
      }

      // CSP img-src check: every external <img> host referenced by the
      // template must be declared in the agent's permissions.imgSrc.
      // Otherwise the page CSP blocks the load and the widget renders
      // with broken images (browser console: "violates ... img-src").
      const declaredHosts = new Set<string>(
        ((agent as { permissions?: { imgSrc?: string[] } }).permissions?.imgSrc ?? []).map((h) => h.toLowerCase()),
      );
      // Wildcards (`*.example.com`) match any subdomain of `example.com`.
      const matchesDeclared = (host: string): boolean => {
        if (declaredHosts.has(host)) return true;
        for (const d of declaredHosts) {
          if (d.startsWith('*.') && host.endsWith(d.slice(1))) return true;
        }
        return false;
      };
      const imgRe = /<img\b[^>]*\bsrc\s*=\s*["']https?:\/\/([^/'"\s]+)/gi;
      const missingHosts = new Set<string>();
      while ((m = imgRe.exec(tpl)) !== null) {
        const host = m[1].toLowerCase();
        if (!matchesDeclared(host)) missingHosts.add(host);
      }
      for (const host of missingHosts) {
        errors.push({
          path: `newAgents[${i}].yaml.permissions.imgSrc`,
          message: `Template references <img src="https://${host}/..."> but "${host}" is not in permissions.imgSrc — the page CSP will block the image. Add "${host}" to the agent's permissions.imgSrc array (or "*.${host.split('.').slice(-2).join('.')}" for a wildcard if the host varies).`,
        });
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Format critic errors as a block suitable for appending to the planner
 * goal on retry. The planner prompt already knows about <plan>...</plan>;
 * this section gives it the specific structural problems to fix.
 */
export function formatCriticFeedback(errors: PlanCriticError[]): string {
  if (errors.length === 0) return '';
  const lines = errors.map((e) => `- ${e.path}: ${e.message}`);
  return [
    '',
    'Critic feedback on your previous plan (fix every item below; emit a complete revised <plan>...</plan>):',
    ...lines,
  ].join('\n');
}
