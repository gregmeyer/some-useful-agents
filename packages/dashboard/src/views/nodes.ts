/**
 * /nodes page renderer. Browseable catalog of every node type sua
 * exposes. Same data the planner-fronted agent-builder queries via
 * /api/nodes — this page is the human-readable view.
 */

import type { NodeContract, NodeContractField } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export function renderNodes(opts: { catalog: NodeContract[] }): string {
  const cards = opts.catalog.map(renderContractCard);

  const body = html`
    ${pageHeader({
      title: 'Nodes',
      description:
        'Every first-class node type sua’s executor knows. Hand-authored contracts: what each ' +
        'node takes in, what it emits, when to reach for it. The planner-fronted agent-builder reads ' +
        'this same catalog via /api/nodes when designing new agents.',
    })}

    <p class="dim" style="font-size: var(--font-size-xs); margin: var(--space-4) 0 var(--space-6);">
      ${opts.catalog.length === 1 ? '1 node type' : `${opts.catalog.length} node types`} ·
      <a href="/api/nodes">JSON API</a>
    </p>

    ${cards as unknown as SafeHtml[]}
  `;

  return render(layout({ title: 'Nodes', activeNav: 'nodes' }, body));
}

function renderContractCard(c: NodeContract): SafeHtml {
  return html`
    <section id="${c.type}" class="card" style="margin-bottom: var(--space-5); padding: var(--space-5);">
      <header style="margin-bottom: var(--space-3);">
        <h2 style="margin: 0 0 var(--space-1); font-family: var(--font-mono); font-size: var(--font-size-lg);">${c.type}</h2>
        <p class="dim" style="margin: 0; line-height: 1.5;">${c.description}</p>
      </header>

      <div class="config-grid" style="margin-top: var(--space-4); gap: var(--space-4);">
        <div class="config-grid__col">
          <h3 style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">Inputs</h3>
          ${renderFieldsTable(c.inputs)}
        </div>
        <div class="config-grid__col">
          <h3 style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">Outputs</h3>
          ${c.outputs.length === 0
            ? html`<p class="dim" style="font-size: var(--font-size-xs); margin: 0;">This node emits no result fields.</p>`
            : renderFieldsTable(c.outputs)}
        </div>
      </div>

      <div style="margin-top: var(--space-4);">
        <h3 style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">Use when</h3>
        <ul style="margin: 0 0 0 var(--space-4); padding: 0; font-size: var(--font-size-sm); line-height: 1.6;">
          ${c.use_when.map((line) => html`<li>${line}</li>`) as unknown as SafeHtml[]}
        </ul>
      </div>

      <div style="margin-top: var(--space-4);">
        <h3 style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">Example</h3>
        <pre style="margin: 0; padding: var(--space-3); background: var(--color-surface); border-radius: var(--radius-sm); overflow-x: auto; font-size: var(--font-size-xs); line-height: 1.5;"><code>${c.example}</code></pre>
      </div>
    </section>
  `;
}

function renderFieldsTable(fields: NodeContractField[]): SafeHtml {
  if (fields.length === 0) {
    return html`<p class="dim" style="font-size: var(--font-size-xs); margin: 0;">None.</p>`;
  }
  return html`
    <table class="table" style="font-size: var(--font-size-xs);">
      <tbody>
        ${fields.map((f) => html`
          <tr>
            <td style="white-space: nowrap; vertical-align: top; padding-right: var(--space-3);">
              <code class="mono">${f.name}</code>
              ${f.required ? html`<br><span class="badge badge--ok" style="margin-top: var(--space-1);">required</span>` : html``}
            </td>
            <td style="vertical-align: top; padding-right: var(--space-3);">
              <code class="mono dim">${f.type}</code>
            </td>
            <td style="vertical-align: top; line-height: 1.5;">${f.description}</td>
          </tr>
        `) as unknown as SafeHtml[]}
      </tbody>
    </table>
  `;
}
