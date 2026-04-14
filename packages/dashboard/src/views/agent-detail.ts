import type { AgentDefinition, Run, SecretsStore } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { typeBadge, sourceBadge, statusBadge, formatDuration, formatAge } from './components.js';

export async function renderAgentDetail(args: {
  agent: AgentDefinition;
  recentRuns: Run[];
  secretsStore: SecretsStore;
  flash?: { kind: 'error' | 'info'; message: string };
}): Promise<string> {
  const { agent, recentRuns, secretsStore, flash } = args;
  const source = agent.source ?? 'local';
  const isCommunityShell = source === 'community' && agent.type === 'shell';

  // Check each declared secret's presence. Never fetches the value.
  const secretRows: SafeHtml[] = [];
  for (const name of agent.secrets ?? []) {
    let present: 'ok' | 'missing' | 'unknown';
    try {
      present = (await secretsStore.has(name)) ? 'ok' : 'missing';
    } catch {
      // Store is passphrase-locked or legacy v1 — can't confirm.
      present = 'unknown';
    }
    const badge = present === 'ok'
      ? html`<span class="badge badge-ok">set</span>`
      : present === 'missing'
      ? html`<span class="badge badge-err">missing</span>`
      : html`<span class="badge badge-warn">unknown (store locked)</span>`;
    secretRows.push(html`<tr><td class="mono">${name}</td><td>${badge}</td></tr>`);
  }

  const inputRows: SafeHtml[] = [];
  for (const [name, spec] of Object.entries(agent.inputs ?? {})) {
    const required = spec.default === undefined && spec.required !== false;
    const kind = spec.type === 'enum' && spec.values?.length
      ? `enum: ${spec.values.join(', ')}`
      : spec.type;
    inputRows.push(html`
      <tr>
        <td class="mono">${name}</td>
        <td>${kind}</td>
        <td>${required ? html`<span class="badge badge-warn">required</span>` : html`<span class="dim">optional</span>`}</td>
        <td class="mono">${spec.default !== undefined ? String(spec.default) : ''}</td>
        <td class="dim">${spec.description ?? ''}</td>
      </tr>
    `);
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

  // "Run now" button: direct POST for non-community-shell, modal for community-shell.
  const runNowButton = isCommunityShell
    ? html`
        <button type="button" class="run-now run-now-warn" onclick="suaOpenModal('gate-${agent.name}')">
          Run now (community shell — audit required)
        </button>
        <div id="gate-${agent.name}" class="modal-backdrop">
          <div class="modal">
            <h3>⚠ Audit required</h3>
            <p><strong>${agent.name}</strong> is a community shell agent. It will run this command with your full user privileges:</p>
            <div class="command">${agent.command ?? ''}</div>
            <form method="POST" action="/agents/${agent.name}/run">
              <label style="display: flex; gap: 0.5rem; align-items: center; margin: 0.75rem 0;">
                <input type="checkbox" data-audit-checkbox="${agent.name}">
                I audited this command and take responsibility for running it.
              </label>
              <input type="hidden" name="confirm_community_shell" value="yes">
              <div class="modal-actions">
                <button type="button" onclick="suaCloseModal('gate-${agent.name}')" class="run-now" style="background: var(--muted)">Cancel</button>
                <button type="submit" class="run-now run-now-warn" data-audit-submit="${agent.name}" disabled>Run anyway</button>
              </div>
            </form>
          </div>
        </div>
      `
    : html`
        <form method="POST" action="/agents/${agent.name}/run" style="display: inline;">
          <button type="submit" class="run-now">Run now</button>
        </form>
      `;

  const warningBanner = source === 'community'
    ? html`<div class="community-banner">
        <strong>Community agent.</strong> Read the full YAML (below) before running. See
        <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/SECURITY.md#trust-model">docs/SECURITY.md</a> for the trust model.
      </div>`
    : html``;

  const body = html`
    <h1>${agent.name} ${typeBadge(agent.type)} ${sourceBadge(source)}</h1>
    ${warningBanner}
    <p class="dim">${agent.description ?? 'No description.'}</p>

    <div style="margin: 1rem 0;">${runNowButton}</div>

    ${agent.type === 'shell'
      ? html`<h2>Command</h2><pre>${agent.command ?? ''}</pre>`
      : html`<h2>Prompt</h2><pre>${agent.prompt ?? ''}</pre>`}

    <h2>Metadata</h2>
    <dl class="kv">
      <dt>Timeout</dt><dd>${String(agent.timeout ?? 300)}s</dd>
      <dt>Schedule</dt><dd>${agent.schedule ?? html`<span class="dim">none</span>`}</dd>
      <dt>Exposed via MCP</dt><dd>${agent.mcp === true ? 'yes' : 'no'}</dd>
      <dt>Redact secrets</dt><dd>${agent.redactSecrets === true ? 'yes' : 'no'}</dd>
      ${agent.allowedTools?.length ? html`<dt>Allowed tools</dt><dd class="mono">${agent.allowedTools.join(', ')}</dd>` : html``}
      ${agent.dependsOn?.length ? html`<dt>Depends on</dt><dd>${agent.dependsOn.map((n) => html`<a href="/agents/${n}" class="mono">${n}</a>`) as unknown as SafeHtml[]}</dd>` : html``}
    </dl>

    ${inputRows.length > 0 ? html`
      <h2>Inputs</h2>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>${inputRows}</tbody>
      </table>
    ` : html``}

    ${secretRows.length > 0 ? html`
      <h2>Secrets</h2>
      <table>
        <thead><tr><th>Name</th><th>Status</th></tr></thead>
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

  return render(layout({ title: agent.name, activeNav: 'agents', flash }, body));
}
