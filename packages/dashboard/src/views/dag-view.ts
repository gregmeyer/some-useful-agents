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
  /**
   * When set, the per-node action dialog includes "Replay from here",
   * POSTing `fromNodeId` to `/runs/<priorRunId>/replay`. Used on the
   * run-detail page (priorRunId = this run) and on the agent-detail
   * page (priorRunId = the most-recent completed run for this agent).
   */
  replay?: {
    priorRunId: string;
    /** When the agent has community shell nodes, the node-click replay
     *  needs the same audit-confirm flag as `POST /agents/:id/run`. */
    requiresCommunityConfirm?: boolean;
  };
  /**
   * When set, the per-node action dialog includes "Edit node"
   * (href = `${editBase}/${nodeId}/edit`). Used on the agent-detail
   * page so the user can jump straight from the DAG viz into the
   * node-edit form — replaces the misleading "click a node to
   * inspect it" hint the inspector used to show.
   */
  editBase?: string;
  /**
   * Turns on wiring edit mode: drag one node onto another to make the
   * second depend on the first, click an edge to remove it, then save the
   * whole rewiring as ONE new agent version.
   *
   * Deliberately a separate flag rather than inferred from `editBase`.
   * A run's DAG is a record of what happened and must never be editable,
   * and tying "can edit the wiring" to "has a link to the node form" would
   * make that a one-line change away from being wrong.
   */
  editable?: boolean;
}): SafeHtml {
  const { agent, nodeExecs, navBase, replay, editBase, editable } = args;
  const execByNodeId = new Map<string, NodeExecutionRecord>();
  for (const e of nodeExecs ?? []) execByNodeId.set(e.nodeId, e);

  const elements = buildElements(agent.nodes, execByNodeId);
  const payload = JSON.stringify({ elements });
  const navAttr = navBase ? ` data-nav-base="${escapeAttr(navBase)}"` : '';
  const replayAttr = replay
    ? ` data-replay-run-id="${escapeAttr(replay.priorRunId)}"${replay.requiresCommunityConfirm ? ' data-replay-community="1"' : ''}`
    : '';
  const editAttr = editBase ? ` data-edit-base="${escapeAttr(editBase)}"` : '';

  // Wrap the canvas in <details open> so users can collapse the DAG viz
  // when a deep run detail has scrolled past the structural view they
  // already saw on /agents/:id. The summary mirrors the other
  // collapsible-section styling (.run-node, .agent-card__nodes).
  const hintText = editable
    ? 'Click a node to see its actions \u2014 or Edit wiring to rearrange \u2192'
    : replay || editBase
      ? 'Click a node to see its actions \u2192'
      : '';
  const hint = hintText
    ? html`<span class="dag-disclosure__hint">${hintText}</span>`
    : unsafeHtml('');
  return html`
    <details class="dag-disclosure" open>
      <summary class="dag-disclosure__summary">
        <span>DAG</span>
        <span class="dim" style="font-size: var(--font-size-xs);">${String(agent.nodes.length)} node${agent.nodes.length === 1 ? '' : 's'}</span>
        ${hint}
      </summary>
      <div class="dag-disclosure__body">
        <!-- Wrapper hosts the cytoscape canvas + the floating zoom toolbar.
             Cytoscape replaces #dag-canvas's innerHTML on boot, so the
             toolbar lives as a SIBLING positioned over the canvas. -->
        <div class="dag-frame__wrap${agent.nodes.length <= 2 ? ' dag-frame__wrap--compact' : ''}">
          <div id="dag-canvas" class="dag-frame__canvas${agent.nodes.length <= 2 ? ' dag-frame__canvas--compact' : ''}"${unsafeHtml(navAttr)}${unsafeHtml(replayAttr)}${unsafeHtml(editAttr)}></div>
          <div class="dag-zoom-toolbar" aria-label="DAG zoom controls">
            <button type="button" class="dag-zoom-toolbar__btn" data-dag-zoom="in"  aria-label="Zoom in">+</button>
            <button type="button" class="dag-zoom-toolbar__btn" data-dag-zoom="fit" aria-label="Fit to view" title="Fit to view">⧇</button>
            <button type="button" class="dag-zoom-toolbar__btn" data-dag-zoom="out" aria-label="Zoom out">−</button>
          </div>
          ${editable ? editToolbar(agent.id) : unsafeHtml('')}
        </div>
        <script id="dag-data" type="application/json">${unsafeHtml(escapeScriptTag(payload))}</script>

        <!-- Dialog rendered BEFORE the scripts so the IIFE's initial
             getElementById lookup finds the element. Order matters:
             synchronous <script src> tags run at parse time, and any
             element declared after them is still invisible to the
             first lookup inside graph-render.js. -->
        <dialog id="dag-node-dialog" class="node-dialog">
          <form method="dialog" class="node-dialog__form">
            <header class="node-dialog__header">
              <span class="mono node-dialog__id" data-node-id></span>
              <span data-node-type></span>
              <span data-node-status></span>
              <button type="submit" class="node-dialog__close" aria-label="Close">\u00d7</button>
            </header>
            <dl class="kv node-dialog__meta">
              <dt>Depends on</dt><dd class="mono" data-node-deps></dd>
              <dt>Duration</dt><dd class="mono" data-node-duration></dd>
            </dl>
            <div class="node-dialog__explain" data-node-explain></div>
            <div class="node-dialog__actions" data-node-actions></div>
          </form>
        </dialog>

        <script src="/assets/cytoscape.min.js"></script>
        <script src="/assets/graph-render.js"></script>
        ${editable ? unsafeHtml('<script src="/assets/graph-edit.js"></script>') : unsafeHtml('')}
      </div>
    </details>
  `;
}

/**
 * Wiring-edit controls + the form that saves them. Rendered as a SIBLING of
 * `#dag-canvas` for the same reason the zoom toolbar is: cytoscape replaces
 * the canvas's innerHTML on boot, so anything inside it is wiped.
 *
 * The whole rewiring posts as one JSON blob in a hidden input rather than
 * through a fetch API — it reuses the form + 303 + flash path every other
 * mutation here uses, and keeps validation on the server where the schema's
 * cycle detection already lives.
 */
function editToolbar(agentId: string): SafeHtml {
  return html`
    <div class="dag-edit-toolbar" data-dag-edit-toolbar aria-label="Wiring editor">
      <button type="button" class="btn btn--sm" data-dag-edit="toggle" aria-pressed="false">Edit wiring</button>
      <span class="dag-edit-toolbar__hint" data-dag-edit-hint hidden>
        Drag one node onto another to connect them. Click an edge to remove it.
      </span>
      <form method="POST" action="/agents/${agentId}/graph" class="dag-edit-toolbar__form" data-dag-edit-form hidden>
        <input type="hidden" name="wiring" data-dag-edit-wiring value="">
        <button type="submit" class="btn btn--primary btn--sm" data-dag-edit="save" disabled>Save wiring</button>
        <button type="button" class="btn btn--ghost btn--sm" data-dag-edit="cancel">Cancel</button>
      </form>
    </div>
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
        // Per-node metadata surfaced by the node-click dialog. Kept on
        // the element so the client bootstrap can render without a
        // second fetch.
        dependsOn: (n.dependsOn ?? []).join(', '),
        startedAt: exec?.startedAt,
        completedAt: exec?.completedAt,
        exitCode: exec?.exitCode,
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
