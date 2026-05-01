import { html, type SafeHtml } from '../html.js';
import { oneLine } from '../agent-detail-helpers.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';

export async function renderAgentNodes(args: AgentDetailArgs): Promise<string> {
  const { agent, secretsStore } = args;

  const nodeRows = agent.nodes.map((n) => {
    const body = n.type === 'shell' ? oneLine(n.command ?? '') : oneLine(n.prompt ?? '');
    const deps = n.dependsOn?.length ? n.dependsOn.join(', ') : html`<span class="dim">—</span>`;
    const secrets = n.secrets?.length ? n.secrets.join(', ') : html`<span class="dim">—</span>`;
    return html`
      <tr id="node-${n.id}">
        <td class="mono">${n.id}</td>
        <td>${n.type === 'shell' ? html`<span class="badge badge--ok">shell</span>` : html`<span class="badge badge--info">claude-code</span>`}</td>
        <td class="mono">${deps}</td>
        <td class="mono">${secrets}</td>
        <td class="dim">${body}</td>
        <td style="white-space: nowrap;">
          <a class="btn btn--sm" href="/agents/${agent.id}/nodes/${n.id}/edit">Edit</a>
          <form method="POST" action="/agents/${agent.id}/nodes/${n.id}/delete" style="display: inline; margin: 0;"
                data-confirm="Delete node '${n.id}'?">
            <button type="submit" class="btn btn--sm btn--ghost" style="color: var(--color-err);">Delete</button>
          </form>
        </td>
      </tr>
    `;
  });

  // Secrets by node
  const secretRows: SafeHtml[] = [];
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) {
      let present: 'ok' | 'missing' | 'unknown';
      try { present = (await secretsStore.has(name)) ? 'ok' : 'missing'; } catch { present = 'unknown'; }
      const badge = present === 'ok' ? html`<span class="badge badge--ok">set</span>`
        : present === 'missing' ? html`<span class="badge badge--err">missing</span>`
        : html`<span class="badge badge--warn">locked</span>`;
      secretRows.push(html`<tr><td class="mono">${node.id}</td><td class="mono">${name}</td><td>${badge}</td></tr>`);
    }
  }

  const content = html`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4);">
      <h2 style="margin: 0;">Nodes</h2>
      <a class="btn btn--primary btn--sm" href="/agents/${agent.id}/add-node">+ Add node</a>
    </div>
    <table class="table">
      <thead><tr><th>Id</th><th>Type</th><th>Depends on</th><th>Secrets</th><th>Body</th><th></th></tr></thead>
      <tbody>${nodeRows as unknown as SafeHtml[]}</tbody>
    </table>

    ${secretRows.length > 0 ? html`
      <section style="margin-top: var(--space-6);">
        <h2>Secrets by node</h2>
        <table class="table">
          <thead><tr><th>Node</th><th>Secret</th><th>Status</th></tr></thead>
          <tbody>${secretRows}</tbody>
        </table>
      </section>
    ` : html``}
  `;

  return agentPageShell({ ...args, activeTab: 'nodes' }, content);
}
