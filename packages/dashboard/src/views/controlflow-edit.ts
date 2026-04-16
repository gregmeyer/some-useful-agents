import type { Agent, AgentNode } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

const CONTROL_FLOW_TYPES = new Set([
  'conditional', 'switch', 'loop', 'agent-invoke', 'branch', 'end', 'break',
]);

export function isControlFlowNode(node: AgentNode): boolean {
  return CONTROL_FLOW_TYPES.has(node.type);
}

/**
 * Render the control-flow-specific edit section for a node. Returns
 * empty SafeHtml for execution nodes (shell, claude-code). For control-
 * flow nodes, renders:
 *   1. An explainer describing what this node type does
 *   2. The type-specific config fields (predicate, cases, agentId, etc.)
 *   3. A "Goes to" forward-edge display showing downstream paths
 */
export function renderControlFlowSection(
  agent: Agent,
  node: AgentNode,
): SafeHtml {
  if (!isControlFlowNode(node)) return unsafeHtml('');

  const explainer = renderExplainer(node);
  const config = renderConfigFields(node);
  const goesTo = renderGoesToDisplay(agent, node);

  return html`
    <fieldset class="cf-section" style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4); background: var(--color-surface-raised);">
      <legend style="padding: 0 var(--space-2); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Flow control: ${node.type}</legend>
      ${explainer}
      ${config}
      ${goesTo}
    </fieldset>
  `;
}

function renderExplainer(node: AgentNode): SafeHtml {
  const desc = EXPLAINERS[node.type];
  if (!desc) return unsafeHtml('');
  return html`
    <div class="cf-explainer" style="margin-bottom: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--color-surface); border: 1px solid var(--color-border);">
      <p style="margin: 0; font-size: var(--font-size-sm); color: var(--color-text);">
        <strong>${desc.title}</strong>
      </p>
      <p class="dim" style="margin: var(--space-1) 0 0; font-size: var(--font-size-xs);">${desc.body}</p>
    </div>
  `;
}

const EXPLAINERS: Record<string, { title: string; body: string }> = {
  conditional: {
    title: 'Evaluates a predicate against upstream output.',
    body: 'Produces { matched: true/false }. Downstream nodes use onlyIf to run conditionally. No process is spawned — evaluation happens in the executor.',
  },
  switch: {
    title: 'Matches an upstream field against named cases.',
    body: 'Produces { case: "matched-case-name" }. Downstream nodes use onlyIf to handle specific cases. Unmatched values default to "default".',
  },
  loop: {
    title: 'Iterates over an array and invokes a sub-agent per item.',
    body: 'Reads an array field from upstream output. For each item, runs the configured sub-agent as a nested flow. Collects results into { items: [...], count: N }.',
  },
  'agent-invoke': {
    title: 'Runs another agent as a nested sub-flow.',
    body: 'Resolves the sub-agent from the store, maps inputs from upstream, and executes it as a child run. Parent node waits for the sub-flow to complete and captures its result.',
  },
  branch: {
    title: 'Merge point — collects outputs from all upstream paths.',
    body: 'Waits for all dependsOn nodes to complete (or be condition-skipped), then merges their outputs into { merged: { nodeId: output, ... }, count: N }.',
  },
  end: {
    title: 'Terminates the entire flow.',
    body: 'When reached, all remaining nodes are skipped with flow_ended. The run completes as "completed" (not failed). Use with onlyIf for conditional early exit.',
  },
  break: {
    title: 'Exits the current loop iteration or sub-flow.',
    body: 'Like end, but only affects the current flow level. In a loop body, the loop continues to the next item. In a top-level flow, behaves like end.',
  },
};

function renderConfigFields(node: AgentNode): SafeHtml {
  if (node.type === 'conditional' && node.conditionalConfig) {
    const p = node.conditionalConfig.predicate;
    const comparison = p.equals !== undefined ? `equals ${JSON.stringify(p.equals)}`
      : p.notEquals !== undefined ? `not equals ${JSON.stringify(p.notEquals)}`
      : p.exists !== undefined ? (p.exists ? 'exists (is not null)' : 'does not exist (is null)')
      : 'is truthy';
    return html`
      <div style="margin-bottom: var(--space-3);">
        <p class="card__title" style="margin: 0 0 var(--space-1);">Predicate</p>
        <dl class="kv" style="grid-template-columns: 6rem 1fr;">
          <dt>Field</dt><dd class="mono">${p.field}</dd>
          <dt>Condition</dt><dd>${comparison}</dd>
        </dl>
      </div>
    `;
  }

  if (node.type === 'switch' && node.switchConfig) {
    const cases = Object.entries(node.switchConfig.cases).map(([name, val]) =>
      html`<li><code>${name}</code> \u2190 matches <code>${JSON.stringify(val)}</code></li>`,
    );
    return html`
      <div style="margin-bottom: var(--space-3);">
        <p class="card__title" style="margin: 0 0 var(--space-1);">Switch on field: <code class="mono">${node.switchConfig.field}</code></p>
        <ul style="margin: var(--space-1) 0 0; padding-left: var(--space-5); font-size: var(--font-size-sm);">
          ${cases as unknown as SafeHtml[]}
          <li class="dim">default \u2190 anything else</li>
        </ul>
      </div>
    `;
  }

  if (node.type === 'loop' && node.loopConfig) {
    return html`
      <div style="margin-bottom: var(--space-3);">
        <p class="card__title" style="margin: 0 0 var(--space-1);">Loop config</p>
        <dl class="kv" style="grid-template-columns: 8rem 1fr;">
          <dt>Iterate over</dt><dd class="mono">${node.loopConfig.over}</dd>
          <dt>Sub-agent</dt><dd><a href="/agents/${node.loopConfig.agentId}" class="mono">${node.loopConfig.agentId}</a></dd>
          <dt>Max iterations</dt><dd>${String(node.loopConfig.maxIterations ?? 1000)}</dd>
        </dl>
      </div>
    `;
  }

  if (node.type === 'agent-invoke' && node.agentInvokeConfig) {
    const mappings = node.agentInvokeConfig.inputMapping
      ? Object.entries(node.agentInvokeConfig.inputMapping).map(([k, v]) =>
          html`<li><code>${k}</code> \u2190 <code>${v}</code></li>`,
        )
      : [];
    return html`
      <div style="margin-bottom: var(--space-3);">
        <p class="card__title" style="margin: 0 0 var(--space-1);">Invoke config</p>
        <dl class="kv" style="grid-template-columns: 8rem 1fr;">
          <dt>Sub-agent</dt><dd><a href="/agents/${node.agentInvokeConfig.agentId}" class="mono">${node.agentInvokeConfig.agentId}</a></dd>
        </dl>
        ${mappings.length > 0 ? html`
          <p class="card__title" style="margin: var(--space-2) 0 var(--space-1);">Input mapping</p>
          <ul style="margin: 0; padding-left: var(--space-5); font-size: var(--font-size-sm);">
            ${mappings as unknown as SafeHtml[]}
          </ul>
        ` : html``}
      </div>
    `;
  }

  if (node.type === 'end' || node.type === 'break') {
    return node.endMessage
      ? html`<div style="margin-bottom: var(--space-3);"><p class="card__title" style="margin: 0 0 var(--space-1);">Message</p><p class="dim" style="margin: 0; font-size: var(--font-size-sm);">${node.endMessage}</p></div>`
      : unsafeHtml('');
  }

  return unsafeHtml('');
}

/**
 * "Goes to" display — shows which downstream nodes this control-flow
 * node feeds into, grouped by condition path when applicable.
 */
function renderGoesToDisplay(agent: Agent, node: AgentNode): SafeHtml {
  // Find all nodes that depend on this node.
  const downstream = agent.nodes.filter((n) =>
    n.dependsOn?.includes(node.id),
  );

  if (downstream.length === 0) {
    return html`
      <div style="margin-top: var(--space-2);">
        <p class="card__title" style="margin: 0 0 var(--space-1);">Goes to</p>
        <p class="dim" style="margin: 0; font-size: var(--font-size-xs);">No downstream nodes depend on this node yet.</p>
      </div>
    `;
  }

  // For conditional/switch nodes, group downstream by their onlyIf condition.
  if (node.type === 'conditional' || node.type === 'switch') {
    const paths: SafeHtml[] = [];
    const ungated: SafeHtml[] = [];

    for (const d of downstream) {
      if (d.onlyIf && d.onlyIf.upstream === node.id) {
        const condition = d.onlyIf.equals !== undefined
          ? `${d.onlyIf.field} = ${JSON.stringify(d.onlyIf.equals)}`
          : d.onlyIf.notEquals !== undefined
            ? `${d.onlyIf.field} \u2260 ${JSON.stringify(d.onlyIf.notEquals)}`
            : d.onlyIf.exists !== undefined
              ? `${d.onlyIf.field} ${d.onlyIf.exists ? 'exists' : 'absent'}`
              : d.onlyIf.field;

        paths.push(html`
          <div class="cf-path" style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0;">
            <span class="badge badge--info" style="font-size: var(--font-size-xs);">if ${condition}</span>
            <span>\u2192</span>
            <a href="/agents/${agent.id}/nodes/${d.id}/edit" class="mono">${d.id}</a>
            <span class="badge badge--${d.type === 'shell' ? 'ok' : d.type === 'claude-code' ? 'info' : 'muted'}">${d.type}</span>
          </div>
        `);
      } else {
        ungated.push(html`
          <div style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0;">
            <span class="badge badge--muted" style="font-size: var(--font-size-xs);">always</span>
            <span>\u2192</span>
            <a href="/agents/${agent.id}/nodes/${d.id}/edit" class="mono">${d.id}</a>
          </div>
        `);
      }
    }

    return html`
      <div style="margin-top: var(--space-2);">
        <p class="card__title" style="margin: 0 0 var(--space-1);">Goes to</p>
        ${paths as unknown as SafeHtml[]}
        ${ungated as unknown as SafeHtml[]}
      </div>
    `;
  }

  // For other control-flow types, simple downstream list.
  const items = downstream.map((d) => html`
    <div style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0;">
      <span>\u2192</span>
      <a href="/agents/${agent.id}/nodes/${d.id}/edit" class="mono">${d.id}</a>
      <span class="badge badge--${d.type === 'shell' ? 'ok' : d.type === 'claude-code' ? 'info' : 'muted'}">${d.type}</span>
    </div>
  `);

  return html`
    <div style="margin-top: var(--space-2);">
      <p class="card__title" style="margin: 0 0 var(--space-1);">Goes to</p>
      ${items as unknown as SafeHtml[]}
    </div>
  `;
}
