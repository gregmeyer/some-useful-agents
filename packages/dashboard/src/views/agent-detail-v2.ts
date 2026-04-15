import type { Agent, Run, SecretsStore } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { sourceBadge, statusBadge, formatDuration, formatAge } from './components.js';
import { renderDagView, renderDagFallback } from './dag-view.js';

export async function renderAgentDetailV2(args: {
  agent: Agent;
  recentRuns: Run[];
  secretsStore: SecretsStore;
  flash?: { kind: 'error' | 'info'; message: string };
}): Promise<string> {
  const { agent, recentRuns, secretsStore, flash } = args;
  const source = agent.source;
  const hasCommunityShellNode = source === 'community' && agent.nodes.some((n) => n.type === 'shell');

  // Secrets status per-node; presence-only, never reveals values.
  const secretRows: SafeHtml[] = [];
  const seenSecrets = new Set<string>();
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) {
      const key = `${node.id}:${name}`;
      if (seenSecrets.has(key)) continue;
      seenSecrets.add(key);
      let present: 'ok' | 'missing' | 'unknown';
      try {
        present = (await secretsStore.has(name)) ? 'ok' : 'missing';
      } catch {
        present = 'unknown';
      }
      const badge = present === 'ok'
        ? html`<span class="badge badge-ok">set</span>`
        : present === 'missing'
        ? html`<span class="badge badge-err">missing</span>`
        : html`<span class="badge badge-warn">unknown (store locked)</span>`;
      secretRows.push(html`<tr><td class="mono">${node.id}</td><td class="mono">${name}</td><td>${badge}</td></tr>`);
    }
  }

  const runRows = recentRuns.map((r) => html`
    <tr>
      <td><a href="/runs/${r.id}" class="mono">${r.id.slice(0, 8)}</a></td>
      <td>${statusBadge(r.status)}</td>
      <td class="dim">${formatAge(r.startedAt)}</td>
      <td class="dim">${formatDuration(r.startedAt, r.completedAt)}</td>
      <td class="dim">${r.triggeredBy}</td>
    </tr>
  `);

  // Run-now button — the v1 view's community-shell modal is adequate; for
  // v0.13 we ship a simplified version: direct POST for non-community,
  // a warning banner + inline confirmation for community. Full modal
  // parity with v1 view can come in v0.14 once editing lands.
  const runNowButton = hasCommunityShellNode
    ? html`
        <form method="POST" action="/agents/${agent.id}/run">
          <input type="hidden" name="confirm_community_shell" value="yes">
          <button type="submit" class="run-now run-now-warn" onclick="return confirm('This agent contains community shell nodes. Run anyway?');">
            Run now (community — confirmation required)
          </button>
        </form>
      `
    : html`
        <form method="POST" action="/agents/${agent.id}/run" style="display: inline;">
          <button type="submit" class="run-now">Run now</button>
        </form>
      `;

  const warningBanner = source === 'community'
    ? html`<div class="community-banner">
        <strong>Community agent.</strong> Read the DAG below before running. See
        <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/SECURITY.md#trust-model">docs/SECURITY.md</a> for the trust model.
      </div>`
    : html``;

  // Describe each node in a compact table below the DAG viz.
  const nodeRows = agent.nodes.map((n) => {
    const body = n.type === 'shell' ? oneLine(n.command ?? '') : oneLine(n.prompt ?? '');
    const deps = n.dependsOn?.length ? n.dependsOn.join(', ') : html`<span class="dim">—</span>`;
    const secrets = n.secrets?.length ? n.secrets.join(', ') : html`<span class="dim">—</span>`;
    return html`
      <tr id="node-${n.id}">
        <td class="mono">${n.id}</td>
        <td>${n.type === 'shell' ? html`<span class="badge badge-ok">shell</span>` : html`<span class="badge badge-info">claude-code</span>`}</td>
        <td class="mono">${deps}</td>
        <td class="mono">${secrets}</td>
        <td class="dim">${body}</td>
      </tr>
    `;
  });

  const body = html`
    <h1>${agent.id} ${vStatusBadge(agent.status)} ${sourceBadge(source)}</h1>
    ${warningBanner}
    <p class="dim">${agent.description ?? 'No description.'}</p>

    <div style="margin: 1rem 0;">${runNowButton}</div>

    <h2>DAG</h2>
    ${renderDagFallback(agent)}
    ${renderDagView({ agent })}

    <h2>Nodes</h2>
    <table>
      <thead>
        <tr>
          <th>Id</th><th>Type</th><th>Depends on</th><th>Secrets</th><th>Body</th>
        </tr>
      </thead>
      <tbody>${nodeRows as unknown as SafeHtml[]}</tbody>
    </table>

    <h2>Metadata</h2>
    <dl class="kv">
      <dt>Version</dt><dd class="mono">${String(agent.version)}</dd>
      <dt>Schedule</dt><dd>${agent.schedule ?? html`<span class="dim">none</span>`}</dd>
      <dt>Exposed via MCP</dt><dd>${agent.mcp ? 'yes' : 'no'}</dd>
    </dl>

    ${secretRows.length > 0 ? html`
      <h2>Secrets</h2>
      <table>
        <thead><tr><th>Node</th><th>Secret</th><th>Status</th></tr></thead>
        <tbody>${secretRows}</tbody>
      </table>
    ` : html``}

    <h2>Recent runs</h2>
    ${recentRuns.length === 0
      ? html`<p class="dim">No runs yet.</p>`
      : html`<table>
          <thead><tr><th>ID</th><th>Status</th><th>Started</th><th>Duration</th><th>Triggered</th></tr></thead>
          <tbody>${runRows as unknown as SafeHtml[]}</tbody>
        </table>`}
  `;

  return render(layout({ title: agent.id, activeNav: 'agents', flash }, body));
}

function vStatusBadge(status: string): SafeHtml {
  const kind = status === 'active' ? 'badge-ok'
    : status === 'paused' ? 'badge-warn'
    : status === 'archived' ? 'badge-muted'
    : 'badge-info';
  return html`<span class="badge ${kind}">${status}</span>`;
}

function oneLine(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '…';
}
