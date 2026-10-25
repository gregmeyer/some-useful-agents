/**
 * How to write an agent's `view:`, for the agents that write agents (the
 * drafter, agent-builder, build-planner, sua's fixes): one text built from
 * the component catalog, injected through the discovery catalog. The human
 * version is docs/a2ui-views.md.
 */
import { suaComponentDocs } from './catalog.js';
import type { ViewComponent } from './view.js';

// Not listed for agent views (they still validate there): the notebook's own parts, and the briefing ones a notebook feeds.
const NOTEBOOK_ONLY = new Set(['OptionGrid', 'Coverage', 'Checklist', 'Steps', 'Timeline', 'QuoteList', 'Agenda', 'NotebookHeader']);

function firstSentence(text: string): string {
  const m = /^(.*?[.!?])(\s|$)/.exec(text);
  const s = m ? m[1] : text;
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

export function viewAuthoringGuide(): string {
  // General-purpose components, one short line each (the notebook ones aren't for agent views).
  const sua = suaComponentDocs()
    .filter((d) => !NOTEBOOK_ONLY.has(d.name))
    .map((d) => `- ${d.name}: ${firstSentence(d.summary)}`)
    .join('\n');
  return `## VIEWS (view: in agent YAML): how an agent's results look
A view is a flat list of A2UI components that draws every run: on the run page, the agent's board tile, inbox threads and chat. Write a view for every new agent whose result is structured JSON. Prefer it to outputWidget; when an agent has both, the view is shown. Keep outputWidget only for a capture-image control or diff-apply action buttons.

Shape (one component per line; \`root\` is the top; children/child name other ids):
view:
  components:
    - { id: root, component: Column, children: [top, trend, rows] }
    - { id: top, component: Metric, label: Open issues, value: { path: /outputs/open_count } }
    - { id: trend, component: Sparkline, label: "Open issues, run by run", values: { path: /series/open_count } }
    - { id: rows, component: Table, rows: { path: /outputs/issues }, columns: [{ key: title, label: Title }, { key: url, label: Link, format: link, linkText: title }], maxRows: 10 }

Data a view binds to (a prop is a literal, or { path: ... }):
- /outputs/<name>: the agent's JSON result fields (its last step's structured outputs, or its result parsed as JSON). Declare each one under the agent's outputs:.
- /series/<name>: a numeric output across runs, oldest first, ending with this run (for Sparkline values).
- /inputs/<NAME>, /result (the raw text), /run/completedAt, /history (earlier runs' outputs).

Components: Text (text, variant: h3 / body / caption), Row, Column, Card (child), Tabs (tabs: [{ title, child }]), Divider, Image (url), Button (child: a Text id, action), TextField (label, value), ChoicePicker, plus sua's:
${sua}

Rules:
- Lead with the one or two numbers or facts that matter (Metric, StatStrip), then the detail (Table, KeyValue, ChipList, Text).
- Bind values to paths; never type a sample value into the view: it is reused for every run.
- Tables: the 3–5 columns worth reading; links as format: link (linkText: the row field to show as the link's text); maxRows about 10.
- Inputs and a Run button (instead of outputWidget.interactive): a TextField per input with value: { path: /inputs/NAME }, then { id: run, component: Button, child: run_label, action: { event: { name: run-agent, context: { in_NAME: { path: /inputs/NAME } } } } } and { id: run_label, component: Text, text: Run }. It always runs this agent.
- Style through tones (neutral, ok, warn, err), never colours. Ids: short, unique, word characters. At most about 40 components.
- signal: still names the tile (title, icon, size, accent); with a view, the view draws it, so set signal.template: widget and no mapping.`;
}

/** Top-level `/outputs/<name>` bindings in a view (for checking them against an agent's declared outputs). */
export function viewOutputNames(components: readonly ViewComponent[]): string[] {
  const names = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    const path = (v as { path?: unknown }).path;
    if (typeof path === 'string') {
      const m = /^\/outputs\/([^/]+)/.exec(path);
      if (m) names.add(m[1].replace(/~1/g, '/').replace(/~0/g, '~'));
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(components);
  return [...names];
}
