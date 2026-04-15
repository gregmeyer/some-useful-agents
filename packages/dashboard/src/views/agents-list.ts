import type { Agent, AgentDefinition } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
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
      <td>${a.mcp ? html`<span class="badge badge--info">mcp</span>` : html`<span class="dim">—</span>`}</td>
      <td class="dim">${a.description ?? ''}</td>
    </tr>
  `);

  const v1Rows = input.v1.map((a) => html`
    <tr>
      <td><a href="/agents/${a.name}">${a.name}</a></td>
      <td><span class="badge badge--muted">v1</span></td>
      <td>${sourceBadge(a.source ?? 'local')}</td>
      <td>${typeBadge(a.type)}</td>
      <td>${a.schedule ?? html`<span class="dim">—</span>`}</td>
      <td>${a.mcp ? html`<span class="badge badge--info">mcp</span>` : html`<span class="dim">—</span>`}</td>
      <td class="dim">${a.description ?? ''}</td>
    </tr>
  `);

  const v2Section = hasV2 ? html`
    <table class="table">
      <thead>
        <tr>
          <th>Id</th><th>Status</th><th>Source</th>
          <th>Nodes</th><th>Schedule</th><th>MCP</th><th>Description</th>
        </tr>
      </thead>
      <tbody>${v2Rows as unknown as SafeHtml[]}</tbody>
    </table>
  ` : html``;

  // v1 YAML that hasn't been imported as a DAG yet. Collapsed by default
  // so the migration banner and legacy table don't dominate the page for
  // users who have already migrated. If there's no v2, v1 is the whole
  // show and stays expanded.
  const v1Count = input.v1.length;
  const v1Disclosure = v1Count === 0
    ? html``
    : hasV2
      ? html`
          <details style="margin-top: var(--space-6);">
            <summary>Show ${String(v1Count)} legacy v1 agent${v1Count === 1 ? '' : 's'}</summary>
            <p class="dim" style="margin-top: var(--space-2);">
              Not yet migrated. Run <code>sua workflow import --apply</code> to merge these into DAG agents.
            </p>
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th><th>Kind</th><th>Source</th>
                  <th>Type</th><th>Schedule</th><th>MCP</th><th>Description</th>
                </tr>
              </thead>
              <tbody>${v1Rows as unknown as SafeHtml[]}</tbody>
            </table>
          </details>
        `
      : html`
          <p class="dim">
            No DAG agents yet. These v1 YAML files will migrate on
            <code>sua workflow import --apply</code>.
          </p>
          <table class="table">
            <thead>
              <tr>
                <th>Name</th><th>Kind</th><th>Source</th>
                <th>Type</th><th>Schedule</th><th>MCP</th><th>Description</th>
              </tr>
            </thead>
            <tbody>${v1Rows as unknown as SafeHtml[]}</tbody>
          </table>
        `;

  const emptyState = !hasV2 && v1Count === 0
    ? html`<p>No agents found. Run <code>sua init</code> to scaffold a starter.</p>`
    : html``;

  return render(layout(
    { title: 'Agents', activeNav: 'agents' },
    html`
      ${pageHeader({ title: 'Agents' })}
      ${v2Section}
      ${v1Disclosure}
      ${emptyState}
    `,
  ));
}

function statusBadge(status: string): SafeHtml {
  const kind = status === 'active' ? 'badge--ok'
    : status === 'paused' ? 'badge--warn'
    : status === 'archived' ? 'badge--muted'
    : status === 'draft' ? 'badge--info'
    : 'badge--muted';
  return html`<span class="badge ${kind}">${status}</span>`;
}
