import type { Agent, AgentDefinition } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { typeBadge, sourceBadge } from './components.js';

export interface AgentsListInput {
  /** v1 YAML-loaded single-node agents, after removing any that were
   *  superseded by a v2 DAG with the same id. */
  v1: AgentDefinition[];
  /** v2 DAG agents from AgentStore. */
  v2: Agent[];
}

export function renderAgentsList(input: AgentsListInput): string {
  const hasV2 = input.v2.length > 0;

  const v2Rows = input.v2.map((a) => html`
    <tr>
      <td><a href="/agents/${a.id}">${a.id}</a></td>
      <td>${statusBadge(a.status)}</td>
      <td>${sourceBadge(a.source)}</td>
      <td>${String(a.nodes.length)} node${a.nodes.length === 1 ? '' : 's'}</td>
      <td>${a.schedule ?? html`<span class="dim">—</span>`}</td>
      <td>${a.mcp ? html`<span class="badge badge-info">mcp</span>` : html`<span class="dim">—</span>`}</td>
      <td class="dim">${a.description ?? ''}</td>
    </tr>
  `);

  const v1Rows = input.v1.map((a) => html`
    <tr>
      <td><a href="/agents/${a.name}">${a.name}</a></td>
      <td><span class="badge badge-muted">v1</span></td>
      <td>${sourceBadge(a.source ?? 'local')}</td>
      <td>${typeBadge(a.type)}</td>
      <td>${a.schedule ?? html`<span class="dim">—</span>`}</td>
      <td>${a.mcp ? html`<span class="badge badge-info">mcp</span>` : html`<span class="dim">—</span>`}</td>
      <td class="dim">${a.description ?? ''}</td>
    </tr>
  `);

  const v2Section = hasV2 ? html`
    <h2>DAG agents</h2>
    <table>
      <thead>
        <tr>
          <th>Id</th><th>Status</th><th>Source</th>
          <th>Nodes</th><th>Schedule</th><th>MCP</th><th>Description</th>
        </tr>
      </thead>
      <tbody>${v2Rows as unknown as SafeHtml[]}</tbody>
    </table>
  ` : html``;

  const v1Header = hasV2 ? html`<h2>v1 YAML agents</h2><p class="dim">Not yet migrated. Run <code>sua workflow import --apply</code> to merge into DAGs.</p>` : html``;
  const v1Section = input.v1.length === 0
    ? (hasV2 ? html`` : html`<p>No agents found. Run <code>sua init</code> to scaffold a starter.</p>`)
    : html`
      ${v1Header}
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Kind</th><th>Source</th>
            <th>Type</th><th>Schedule</th><th>MCP</th><th>Description</th>
          </tr>
        </thead>
        <tbody>${v1Rows as unknown as SafeHtml[]}</tbody>
      </table>
    `;

  return render(layout(
    { title: 'Agents', activeNav: 'agents' },
    html`<h1>Agents</h1>${v2Section}${v1Section}`,
  ));
}

function statusBadge(status: string): SafeHtml {
  const kind = status === 'active' ? 'badge-ok'
    : status === 'paused' ? 'badge-warn'
    : status === 'archived' ? 'badge-muted'
    : status === 'draft' ? 'badge-info'
    : 'badge-muted';
  return html`<span class="badge ${kind}">${status}</span>`;
}
