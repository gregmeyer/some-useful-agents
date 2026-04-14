import type { AgentDefinition } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { typeBadge, sourceBadge } from './components.js';

export function renderAgentsList(agents: AgentDefinition[]): string {
  const rows = agents.map((a) => html`
    <tr>
      <td><a href="/agents/${a.name}">${a.name}</a></td>
      <td>${typeBadge(a.type)}</td>
      <td>${sourceBadge(a.source ?? 'local')}</td>
      <td>${a.schedule ?? html`<span class="dim">—</span>`}</td>
      <td>${a.mcp ? html`<span class="badge badge-info">mcp</span>` : html`<span class="dim">—</span>`}</td>
      <td class="dim">${a.description ?? ''}</td>
    </tr>
  `);

  const body = agents.length === 0
    ? html`<p>No agents found. Run <code>sua init</code> to scaffold a starter.</p>`
    : html`
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Source</th>
            <th>Schedule</th><th>MCP</th><th>Description</th>
          </tr>
        </thead>
        <tbody>${rows as unknown as SafeHtml[]}</tbody>
      </table>
    `;

  return render(layout(
    { title: 'Agents', activeNav: 'agents' },
    html`<h1>Agents</h1>${body}`,
  ));
}
