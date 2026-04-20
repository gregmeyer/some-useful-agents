import type { Agent, AgentNode } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

const CONTROL_FLOW_TYPES = new Set([
  'conditional', 'switch', 'loop', 'agent-invoke', 'branch', 'end', 'break',
]);

export function isControlFlowNode(node: AgentNode): boolean {
  return CONTROL_FLOW_TYPES.has(node.type);
}

export function renderControlFlowSection(
  agent: Agent,
  node: AgentNode,
): SafeHtml {
  if (!isControlFlowNode(node)) return unsafeHtml('');

  const explainer = renderExplainer(node);
  const config = renderConfigFields(node);
  const goesTo = renderGoesToDisplay(agent, node);

  return html`
    <fieldset class="fieldset" style="background: var(--color-surface-raised);">
      <legend class="fieldset__legend">Flow control: ${node.type}</legend>
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
    <div class="card mb-3" style="padding: var(--space-2) var(--space-3);">
      <p class="mb-0 text-sm"><strong>${desc.title}</strong></p>
      <p class="dim text-xs mt-0 mb-0">${desc.body}</p>
    </div>
  `;
}

const EXPLAINERS: Record<string, { title: string; body: string }> = {
  conditional: {
    title: 'Evaluates a predicate against upstream output.',
    body: 'Produces { matched: true/false }. Downstream nodes use onlyIf to run conditionally. No process is spawned.',
  },
  switch: {
    title: 'Matches an upstream field against named cases.',
    body: 'Produces { case: "matched-case-name" }. Downstream nodes use onlyIf to handle specific cases. Unmatched values default to "default".',
  },
  loop: {
    title: 'Iterates over an array and invokes a sub-agent per item.',
    body: 'Reads an array field from upstream output. For each item, runs the configured sub-agent as a nested flow.',
  },
  'agent-invoke': {
    title: 'Runs another agent as a nested sub-flow.',
    body: 'Resolves the sub-agent from the store, maps inputs from upstream, and executes it as a child run.',
  },
  branch: {
    title: 'Merge point \u2014 collects outputs from all upstream paths.',
    body: 'Waits for all dependsOn nodes to complete, then merges their outputs into { merged: { nodeId: output, ... } }.',
  },
  end: {
    title: 'Terminates the entire flow.',
    body: 'When reached, all remaining nodes are skipped with flow_ended. The run completes as "completed". Use with onlyIf for conditional early exit.',
  },
  break: {
    title: 'Exits the current loop iteration or sub-flow.',
    body: 'Like end, but only affects the current flow level. In a loop body, the loop continues to the next item.',
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
      <div class="mb-3">
        <p class="card__title mb-0">Predicate</p>
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
      <div class="mb-3">
        <p class="card__title mb-0">Switch on field: <code class="mono">${node.switchConfig.field}</code></p>
        <ul class="text-sm" style="margin: var(--space-1) 0 0; padding-left: var(--space-6);">
          ${cases as unknown as SafeHtml[]}
          <li class="dim">default \u2190 anything else</li>
        </ul>
      </div>
    `;
  }

  if (node.type === 'loop' && node.loopConfig) {
    return html`
      <div class="mb-3">
        <p class="card__title mb-0">Loop config</p>
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
      <div class="mb-3">
        <p class="card__title mb-0">Invoke config</p>
        <dl class="kv" style="grid-template-columns: 8rem 1fr;">
          <dt>Sub-agent</dt><dd><a href="/agents/${node.agentInvokeConfig.agentId}" class="mono">${node.agentInvokeConfig.agentId}</a></dd>
        </dl>
        ${mappings.length > 0 ? html`
          <p class="card__title mt-3 mb-0">Input mapping</p>
          <ul class="text-sm" style="margin: 0; padding-left: var(--space-6);">
            ${mappings as unknown as SafeHtml[]}
          </ul>
        ` : html``}
      </div>
    `;
  }

  if (node.type === 'end' || node.type === 'break') {
    return node.endMessage
      ? html`<div class="mb-3"><p class="card__title mb-0">Message</p><p class="dim text-sm mb-0">${node.endMessage}</p></div>`
      : unsafeHtml('');
  }

  return unsafeHtml('');
}

function renderGoesToDisplay(agent: Agent, node: AgentNode): SafeHtml {
  const downstream = agent.nodes.filter((n) => n.dependsOn?.includes(node.id));

  if (downstream.length === 0) {
    return html`
      <div class="mt-3">
        <p class="card__title mb-0">Goes to</p>
        <p class="dim text-xs mb-0">No downstream nodes depend on this node yet.</p>
      </div>
    `;
  }

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
            <span class="badge badge--info text-xs">if ${condition}</span>
            <span>\u2192</span>
            <a href="/agents/${agent.id}/nodes/${d.id}/edit" class="mono">${d.id}</a>
            <span class="badge badge--${d.type === 'shell' ? 'ok' : d.type === 'claude-code' ? 'info' : 'muted'}">${d.type}</span>
          </div>
        `);
      } else {
        ungated.push(html`
          <div style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0;">
            <span class="badge badge--muted text-xs">always</span>
            <span>\u2192</span>
            <a href="/agents/${agent.id}/nodes/${d.id}/edit" class="mono">${d.id}</a>
          </div>
        `);
      }
    }

    return html`
      <div class="mt-3">
        <p class="card__title mb-0">Goes to</p>
        ${paths as unknown as SafeHtml[]}
        ${ungated as unknown as SafeHtml[]}
      </div>
    `;
  }

  const items = downstream.map((d) => html`
    <div style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) 0;">
      <span>\u2192</span>
      <a href="/agents/${agent.id}/nodes/${d.id}/edit" class="mono">${d.id}</a>
      <span class="badge badge--${d.type === 'shell' ? 'ok' : d.type === 'claude-code' ? 'info' : 'muted'}">${d.type}</span>
    </div>
  `);

  return html`
    <div class="mt-3">
      <p class="card__title mb-0">Goes to</p>
      ${items as unknown as SafeHtml[]}
    </div>
  `;
}
