import type { Agent, Run, SecretsStore } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { sourceBadge, statusBadge, formatDuration, formatAge } from './components.js';
import { renderDagView, renderDagFallback } from './dag-view.js';

export async function renderAgentDetailV2(args: {
  agent: Agent;
  recentRuns: Run[];
  secretsStore: SecretsStore;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}): Promise<string> {
  const { agent, recentRuns, secretsStore, flash } = args;
  const source = agent.source;
  const hasCommunityShellNode = source === 'community' && agent.nodes.some((n) => n.type === 'shell');

  // Secret presence lookup (never reveals values).
  let secretsSet = 0;
  let secretsMissing = 0;
  let secretsUnknown = 0;
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
      if (present === 'ok') secretsSet++;
      else if (present === 'missing') secretsMissing++;
      else secretsUnknown++;
      const badge = present === 'ok'
        ? html`<span class="badge badge--ok">set</span>`
        : present === 'missing'
        ? html`<span class="badge badge--err">missing</span>`
        : html`<span class="badge badge--warn">locked</span>`;
      secretRows.push(html`
        <tr>
          <td class="mono">${node.id}</td>
          <td class="mono">${name}</td>
          <td>${badge}</td>
        </tr>
      `);
    }
  }

  const runNowButton = hasCommunityShellNode
    ? html`
        <form method="POST" action="/agents/${agent.id}/run">
          <input type="hidden" name="confirm_community_shell" value="yes">
          <button type="submit" class="btn btn--warn"
            onclick="return confirm('This agent contains community shell nodes. Run anyway?');">
            Run now (community)
          </button>
        </form>
      `
    : html`
        <form method="POST" action="/agents/${agent.id}/run" style="display: inline;">
          <button type="submit" class="btn btn--primary">Run now</button>
        </form>
      `;

  const warningBanner = source === 'community'
    ? html`<div class="community-banner">
        <strong>Community agent.</strong> Read the DAG before running. See
        <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/SECURITY.md#trust-model">docs/SECURITY.md</a> for the trust model.
      </div>`
    : html``;

  // Per-node table below the DAG — preserves the v0.14 detail view.
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
      </tr>
    `;
  });

  const runRows = recentRuns.map((r) => html`
    <tr>
      <td><a href="/runs/${r.id}" class="mono">${r.id.slice(0, 8)}</a></td>
      <td>${statusBadge(r.status)}</td>
      <td class="dim">${formatAge(r.startedAt)}</td>
      <td class="dim">${formatDuration(r.startedAt, r.completedAt)}</td>
      <td class="dim">${r.triggeredBy}</td>
    </tr>
  `);

  const secretsSummary = seenSecrets.size === 0
    ? html`<span class="dim">No secrets declared.</span>`
    : html`
        <span class="badge badge--ok">${String(secretsSet)} set</span>
        ${secretsMissing > 0 ? html`<span class="badge badge--err">${String(secretsMissing)} missing</span>` : html``}
        ${secretsUnknown > 0 ? html`<span class="badge badge--warn">${String(secretsUnknown)} locked</span>` : html``}
      `;

  // Inspector (right-column) default state: agent-level summary card.
  // Editable inspector + node-selection states arrive in PR 3 (v0.15).
  const inspector = html`
    <aside class="inspector" id="inspector">
      <header class="inspector__header">
        <h2 class="inspector__title">Overview</h2>
        <span class="inspector__hint">Click a node to inspect it</span>
      </header>

      <section class="inspector__section">
        <h4>Metadata</h4>
        <dl class="kv">
          <dt>Version</dt><dd class="mono">v${String(agent.version)}</dd>
          <dt>Schedule</dt><dd>${agent.schedule ?? html`<span class="dim">none</span>`}</dd>
          <dt>MCP</dt><dd>${agent.mcp ? 'exposed' : html`<span class="dim">not exposed</span>`}</dd>
          <dt>Nodes</dt><dd>${String(agent.nodes.length)}</dd>
        </dl>
      </section>

      <section class="inspector__section">
        <h4>Secrets</h4>
        <div style="display:flex; gap:var(--space-2); flex-wrap:wrap;">
          ${secretsSummary}
        </div>
      </section>

      <div class="inspector__actions">
        <a class="btn btn--sm" href="#nodes">Jump to nodes</a>
        <a class="btn btn--sm" href="#runs">Recent runs</a>
      </div>
    </aside>
  `;

  const body = html`
    ${pageHeader({
      title: agent.id,
      meta: [vStatusBadge(agent.status), sourceBadge(source)],
      cta: runNowButton,
      description: agent.description ?? undefined,
    })}

    ${warningBanner}

    <div class="agent-detail">
      <div class="agent-detail__main">
        <section class="dag-frame">
          ${renderDagFallback(agent)}
          ${renderDagView({ agent })}
        </section>

        <section id="nodes">
          <h2>Nodes</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Id</th><th>Type</th><th>Depends on</th><th>Secrets</th><th>Body</th>
              </tr>
            </thead>
            <tbody>${nodeRows as unknown as SafeHtml[]}</tbody>
          </table>
        </section>

        ${secretRows.length > 0 ? html`
          <section>
            <h2>Secrets by node</h2>
            <table class="table">
              <thead><tr><th>Node</th><th>Secret</th><th>Status</th></tr></thead>
              <tbody>${secretRows}</tbody>
            </table>
          </section>
        ` : html``}

        <section id="runs">
          <h2>Recent runs</h2>
          ${recentRuns.length === 0
            ? html`<p class="dim">No runs yet.</p>`
            : html`<table class="table">
                <thead><tr><th>ID</th><th>Status</th><th>Started</th><th>Duration</th><th>Triggered</th></tr></thead>
                <tbody>${runRows as unknown as SafeHtml[]}</tbody>
              </table>`}
        </section>
      </div>

      <div class="agent-detail__aside">
        ${inspector}
      </div>
    </div>
  `;

  return render(layout({ title: agent.id, activeNav: 'agents', flash, wide: true }, body));
}

function vStatusBadge(status: string): SafeHtml {
  const kind = status === 'active' ? 'badge--ok'
    : status === 'paused' ? 'badge--warn'
    : status === 'archived' ? 'badge--muted'
    : 'badge--info';
  return html`<span class="badge ${kind}">${status}</span>`;
}

function oneLine(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '…';
}
