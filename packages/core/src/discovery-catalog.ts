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
import { NODE_CATALOG } from './node-catalog.js';

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

/** Build node-types section from the canonical NODE_CATALOG (PR A.7). */
function buildNodeTypesSection(): string {
  const lines = Object.values(NODE_CATALOG).map((c) => {
    const required = c.inputs.filter((f) => f.required).map((f) => f.name).join(', ') || '(none)';
    const outputs = c.outputs.map((f) => f.name).join(', ') || '(none)';
    return `- ${c.type}: ${c.description}\n    required: ${required}\n    outputs: ${outputs}`;
  });
  return `## NODE TYPES (canonical, from /api/nodes)
${lines.join('\n')}
- Edge conditions: Any node can have onlyIf: { upstream, field, equals/notEquals/contains/greaterThan/lessThan } to conditionally skip.
UPSTREAM DATA FLOW:
- Shell nodes: $UPSTREAM_<NODEID>_RESULT env var (full output). Field extraction: pipe through jq.
- Claude-code nodes: {{upstream.<nodeId>.result}} (full output) OR {{upstream.<nodeId>.<field>}} (JSON dot-path extraction). Example: {{upstream.fetch.headline}} extracts the "headline" field from fetch's JSON output.
- Browse the full per-type contract at /nodes (or GET /api/nodes for JSON).`;
}

const OUTPUT_WIDGETS = `
## OUTPUT WIDGET TYPES (outputWidget: in agent YAML)
Use when the agent produces structured JSON. The widget renders on the agent detail page.
- dashboard: Hero metric + stats grid. Field types: metric (big number), stat (compact label+value), badge (pill), text.
- key-value: Labeled pairs as definition list. Field types: text, code, badge.
- diff-apply: Review/analysis with actions. Field types: text, code, badge. Supports actions (buttons that POST).
- raw: Sectioned fallback for mixed content. Field types: text, code, preview.
- ai-template: AI-rendered HTML template. Supports {{outputs.X}} (escaped), {{{outputs.X}}} (unescaped), and {{#each outputs.X as item}}...{{/each}} iteration with {{item.field}} / {{@index}}. Use for list/card layouts.

CRITICAL — OUTPUT WIDGET FIELD SCHEMA:
Each entry in outputWidget.fields has EXACTLY these keys:
  name: string    ← THE JSON KEY TO LOOK UP in the agent's final-node JSON output
  type: string    ← one of: text | code | badge | action | metric | stat | preview
  label: string   ← OPTIONAL human-readable display label (defaults to name)
DO NOT use \`source:\`, \`path:\`, \`from:\`, or \`key:\` — these are silently dropped and the widget renders empty.
Example for a final node that emits {"file":"x.md","count":5}:
  fields:
    - name: file       # reads outputs.file → renders "x.md"
      type: code
      label: Saved to
    - name: count      # reads outputs.count → renders "5"
      type: metric
      label: Stories`.trim();

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
    const desc = a.description ?? a.name;
    const inputNames = a.inputs ? Object.keys(a.inputs).join(', ') : '';
    const outputNames = a.outputs ? Object.keys(a.outputs).join(', ') : '';
    const tools = a.capabilities?.tools_used?.join(', ') ?? '';
    const sideEffects = a.capabilities?.side_effects?.join(', ') ?? '';
    const parts: string[] = [`- ${a.id}: ${desc}`];
    if (inputNames) parts.push(`    inputs: ${inputNames}`);
    if (outputNames) parts.push(`    outputs: ${outputNames}`);
    if (tools) parts.push(`    tools: ${tools}`);
    if (sideEffects) parts.push(`    side effects: ${sideEffects}`);
    return parts.join('\n');
  });

  return `## AVAILABLE AGENTS (for agent-invoke / loop nodes)
Each agent's outputs are what its final-node JSON produces — use these field names when referencing the result via {{upstream.<id>.<field>}} or "$upstream.<id>.<field>" in inputMapping.
${lines.join('\n')}`;
}

// ── Public API ──────────────────────────────────────────────────────────

const DESIGN_DISCIPLINE = `
## DESIGN DISCIPLINE
1. DECOMPOSE. If the goal has 3+ logical stages (fetch / transform / write), emit 3+ nodes — one per stage. Don't pack everything into one giant shell or claude-code prompt. The dashboard's value is per-stage inspection and replay; collapsing into one node throws that away.
2. DECLARE OUTPUTS. If your final node emits structured JSON (anything beyond a single string), add a top-level outputs: block declaring the shape (lowercase_snake_case names). It's documentation for the planner, not enforcement.
3. TEMPLATE SYNTAX. Use {{var}} with NO SPACES inside the braces. Never \`{ {var}}\`. Same for upstream.X.field, inputs.X, item.X.
4. SHELL FOR DETERMINISM. If the work fits in jq/curl/sed, use shell — it's faster, cheaper, reproducible. Reach for claude-code only for free-form judgment (analysis, summarization, classification).
5. SOURCE FIELD. Always set source: local on new agents (the importer overrides anyway, but it's the convention).`.trim();

export function buildDiscoveryCatalog(opts: DiscoveryCatalogOptions): string {
  const sections = [
    buildNodeTypesSection(),
    buildTemplateSection(opts.templateRegistry),
    OUTPUT_WIDGETS,
    buildAgentsSection(opts.agents),
    PATTERNS,
    WIDGET_GUIDANCE,
    DESIGN_DISCIPLINE,
  ];

  return sections.join('\n\n');
}
