/**
 * Discovery catalog builder. Assembles a concise text catalog of node types,
 * signal templates, output widgets, available agents, and architecture patterns
 * for injection into the agent-builder and agent-analyzer LLM prompts.
 *
 * Built at runtime from live data (stores, registries) so it stays current
 * as tools and agents change.
 */

import type { Agent } from './agent-v2-types.js';
import type { ToolDefinition } from './tool-types.js';

export interface TemplateDef {
  name: string;
  displayName: string;
  slots: Array<{ name: string; required: boolean; type: string }>;
  defaultSize: string;
}

export interface DiscoveryCatalogOptions {
  agents: Agent[];
  tools: ToolDefinition[];
  templateRegistry: Record<string, TemplateDef>;
}

const EXCLUDED_AGENT_IDS = new Set(['agent-builder', 'agent-analyzer']);

// ── Static content ──────────────────────────────────────────────────────

const NODE_TYPES = `
## NODE TYPES
- shell: Run a shell command. Fields: command (required).
- claude-code: Multi-turn LLM. Fields: prompt (required), maxTurns (optional).
- conditional: Gate on upstream field. Needs conditionalConfig: { predicate: { field, equals/notEquals/exists } }. Outputs { matched, value }.
- switch: Multi-way branch on field value. Needs switchConfig: { field, cases: { caseName: matchValue } }. Outputs { case, value }.
- loop: Iterate over array, invoke sub-agent per item. Needs loopConfig: { over: "fieldName", agentId: "agent-id", maxIterations? }. Injects ITEM + ITEM_INDEX.
- agent-invoke: Call another agent as a node. Needs agentInvokeConfig: { agentId, inputMapping?: { INPUT_NAME: "upstream.nodeId.field" } }.
- branch: Merge node. Collects outputs from multiple dependsOn upstreams into { merged, count }.
- end: Terminate flow cleanly. Optional endMessage.
- break: Exit loop iteration early. Optional endMessage.
- Edge conditions: Any node can have onlyIf: { upstream, field, equals/notEquals/exists } to conditionally skip.
UPSTREAM DATA FLOW:
- Shell nodes: $UPSTREAM_<NODEID>_RESULT env var (full output). Field extraction: pipe through jq.
- Claude-code nodes: {{upstream.<nodeId>.result}} (full output) OR {{upstream.<nodeId>.<field>}} (JSON dot-path extraction).
  Example: {{upstream.fetch.headline}} extracts the "headline" field from fetch's JSON output.`.trim();

const OUTPUT_WIDGETS = `
## OUTPUT WIDGET TYPES (outputWidget: in agent YAML)
Use when the agent produces structured JSON. The widget renders on the agent detail page.
- dashboard: Hero metric + stats grid. Field types: metric (big number), stat (compact label+value), badge (pill), text.
- key-value: Labeled pairs as definition list. Field types: text, code, badge.
- diff-apply: Review/analysis with actions. Field types: text, code, badge. Supports actions (buttons that POST).
- raw: Sectioned fallback for mixed content. Field types: text, code.
Field type tips: Use metric for the single most important number. Use stat for supporting numbers. Use badge for status/category.`.trim();

const PATTERNS = `
## ARCHITECTURE PATTERNS
1. API Monitor: shell(curl) → signal(status + thresholds). Single node, schedule: "*/5 * * * *".
2. Data Pipeline: shell(fetch) → claude-code(analyze) → shell(output). Use dependsOn chaining.
3. Conditional Router: shell(classify) → conditional(check predicate) → shell(path-a, onlyIf: matched) + shell(path-b, onlyIf: !matched) → branch(merge).
4. Loop + Invoke: shell(read-source) → loop(over: "items", agentId: "processor-agent") → shell(compile-results).
5. Self-Correcting: claude-code(generate) → shell(validate) → claude-code(fix, onlyIf: validation failed).
6. Scheduled Digest: shell(gather-data) → claude-code(summarize). schedule: "0 8 * * *". Use story or text-headline template.`.trim();

const WIDGET_GUIDANCE = `
## WIDGET & SIGNAL DESIGN
- Always include BOTH signal: (for Pulse tiles) AND outputWidget: (for agent detail) when output is structured JSON.
- Signal template and outputWidget type are independent. Signal controls the Pulse tile. Widget controls the run detail view.
- Use size: "2x1" for templates with body text (text-headline, story, table, comparison).
- Use accent color to group related agents visually (teal, blue, green, orange, red, purple).
- Use thresholds on metric tiles to auto-color: thresholds: [{ above: 90, palette: accent-red }, { above: 50, palette: accent-orange }].
- Map JSON output fields precisely. Avoid mapping to "result" when the agent outputs structured JSON with named fields.
- For dashboard widgets: put the most important number as type: metric, supporting stats as type: stat, categories as type: badge.`.trim();

// ── Dynamic builders ────────────────────────────────────────────────────

function buildTemplateSection(registry: Record<string, TemplateDef>): string {
  const lines = Object.values(registry)
    .filter((t) => t.name !== 'widget') // meta-template, not user-facing
    .map((t) => {
      const required = t.slots.filter((s) => s.required).map((s) => `${s.name}(${s.type})`);
      const optional = t.slots.filter((s) => !s.required).map((s) => s.name);
      const reqStr = required.length > 0 ? `Required: ${required.join(', ')}.` : 'No required slots.';
      const optStr = optional.length > 0 ? `Optional: ${optional.join(', ')}.` : '';
      return `- ${t.name} (${t.defaultSize}): ${t.displayName}. ${reqStr}${optStr ? ' ' + optStr : ''}`;
    });
  return `## SIGNAL TEMPLATES (signal.template in agent YAML)\n${lines.join('\n')}`;
}

function buildAgentsSection(agents: Agent[]): string {
  const eligible = agents
    .filter((a) => a.status === 'active' && !EXCLUDED_AGENT_IDS.has(a.id))
    .slice(0, 20); // cap to keep catalog lean

  if (eligible.length === 0) {
    return '## AVAILABLE AGENTS (for agent-invoke / loop nodes)\nNo agents available yet.';
  }

  const lines = eligible.map((a) => {
    const inputNames = a.inputs ? Object.keys(a.inputs).join(', ') : '';
    const inputStr = inputNames ? ` Inputs: ${inputNames}.` : '';
    return `- ${a.id}: ${a.description ?? a.name}.${inputStr}`;
  });

  return `## AVAILABLE AGENTS (for agent-invoke / loop nodes)\n${lines.join('\n')}`;
}

// ── Public API ──────────────────────────────────────────────────────────

export function buildDiscoveryCatalog(opts: DiscoveryCatalogOptions): string {
  const sections = [
    NODE_TYPES,
    buildTemplateSection(opts.templateRegistry),
    OUTPUT_WIDGETS,
    buildAgentsSection(opts.agents),
    PATTERNS,
    WIDGET_GUIDANCE,
  ];

  return sections.join('\n\n');
}
