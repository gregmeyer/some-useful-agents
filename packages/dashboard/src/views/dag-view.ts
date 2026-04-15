import type { Agent, AgentNode, NodeExecutionRecord } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

/**
 * Render the DAG of an agent as a Cytoscape container + inline JSON +
 * script tags that pull cytoscape + our tiny bootstrap.
 *
 * The payload shape is the Cytoscape "elements" format. Node status (if
 * provided via `nodeExecs`) colors the node; without it, we color by
 * node type (shell vs claude-code).
 */
export function renderDagView(args: {
  agent: Agent;
  /** Optional — when rendering /runs/:id we know the per-node status. */
  nodeExecs?: NodeExecutionRecord[];
  /** Optional — makes nodes clickable to scroll to their detail section. */
  navBase?: string;
}): SafeHtml {
  const { agent, nodeExecs, navBase } = args;
  const execByNodeId = new Map<string, NodeExecutionRecord>();
  for (const e of nodeExecs ?? []) execByNodeId.set(e.nodeId, e);

  const elements = buildElements(agent.nodes, execByNodeId);
  const payload = JSON.stringify({ elements });
  const navAttr = navBase ? ` data-nav-base="${escapeAttr(navBase)}"` : '';

  // Wrap the canvas in <details open> so users can collapse the DAG viz
  // when a deep run detail has scrolled past the structural view they
  // already saw on /agents/:id. The summary mirrors the other
  // collapsible-section styling (.run-node, .agent-card__nodes).
  return html`
    <details class="dag-disclosure" open>
      <summary class="dag-disclosure__summary">
        <span>DAG</span>
        <span class="dim" style="font-size: var(--font-size-xs);">${String(agent.nodes.length)} node${agent.nodes.length === 1 ? '' : 's'}</span>
      </summary>
      <div class="dag-disclosure__body">
        <div id="dag-canvas" class="dag-frame__canvas"${unsafeHtml(navAttr)}></div>
        <script id="dag-data" type="application/json">${unsafeHtml(escapeScriptTag(payload))}</script>
        <script src="/assets/cytoscape.min.js"></script>
        <script src="/assets/graph-render.js"></script>
      </div>
    </details>
  `;
}

/**
 * Text-only fallback for when cytoscape fails to load (blocked, offline,
 * etc.) Renders the nodes as a simple list with their dependencies so the
 * page stays useful without JS.
 */
export function renderDagFallback(agent: Agent): SafeHtml {
  const rows = agent.nodes.map((n) => {
    const deps = n.dependsOn?.length ? ` ← ${n.dependsOn.join(', ')}` : '';
    return html`<li><code>${n.id}</code> <span class="dim">(${n.type})${deps}</span></li>`;
  });
  return html`
    <noscript>
      <div class="flash flash-info">
        DAG graph requires JavaScript. Node list:
        <ul>${rows as unknown as SafeHtml[]}</ul>
      </div>
    </noscript>
  `;
}

function buildElements(nodes: AgentNode[], execByNodeId: Map<string, NodeExecutionRecord>): unknown[] {
  const out: unknown[] = [];
  for (const n of nodes) {
    const exec = execByNodeId.get(n.id);
    out.push({
      data: {
        id: n.id,
        label: n.id,
        type: n.type,
        status: exec?.status,
      },
    });
    for (const dep of n.dependsOn ?? []) {
      out.push({
        data: {
          id: `${dep}->${n.id}`,
          source: dep,
          target: n.id,
        },
      });
    }
  }
  return out;
}

/**
 * Escape characters that would break out of a `<script type="application/json">`
 * tag. The payload is user-controlled via the DAG fields; `</script>` inside
 * would end the script block and let following HTML execute.
 */
function escapeScriptTag(json: string): string {
  return json.replace(/<\/script/gi, '<\\/script');
}

function escapeAttr(value: string): string {
  return value.replace(/["&<>]/g, (c) => ({ '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}
