import type { Agent, ServiceStatus } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface SettingsMcpArgs {
  /** Live status of the outbound MCP server (PID file + liveness probe). */
  status: ServiceStatus;
  /** First 8 hex chars of the bearer token. Full value never rendered here. */
  tokenFingerprint: string;
  /** Endpoint URL the MCP server (would) listen on, e.g. http://127.0.0.1:3003/mcp */
  endpoint: string;
  /** Agents that have `mcp: true` and are exposed by the server. */
  exposedAgents: Array<{ agent: Agent; runCount: number }>;
  /** Pre-rendered Claude Desktop config snippet with the user's actual values filled in. */
  claudeDesktopConfig: string;
  /** Inline error from a failed start/stop. */
  actionError?: string;
}

/**
 * Render the `/settings/mcp` body — the outbound MCP server (the one
 * Claude Desktop talks to). Distinct from `/settings/mcp-servers`, which
 * lists *imported* MCP servers whose tools sua can call.
 */
export function renderSettingsMcp(args: SettingsMcpArgs): SafeHtml {
  return html`
    ${args.actionError ? html`<div class="flash flash--error">${args.actionError}</div>` : unsafeHtml('')}

    <div class="card">
      <p class="card__title">Status</p>
      ${renderStatusBlock(args.status)}
      <div style="display: flex; gap: var(--space-2); margin-top: var(--space-3);">
        ${args.status.state === 'running'
          ? html`<form action="/settings/mcp/stop" method="post" style="margin: 0;"
              data-confirm="Stop the MCP server? Connected MCP clients (e.g. Claude Desktop) will lose access until you start it again.">
              <button type="submit" class="btn btn--warn">Stop server</button>
            </form>`
          : html`<form action="/settings/mcp/start" method="post" style="margin: 0;">
              <button type="submit" class="btn btn--primary">Start server</button>
            </form>`}
        <a class="btn btn--ghost" href="/settings/mcp">Refresh</a>
      </div>
    </div>

    <div class="card">
      <p class="card__title">Endpoint</p>
      <dl class="kv">
        <dt>URL</dt>
        <dd class="mono">${args.endpoint}</dd>
        <dt>Token fingerprint</dt>
        <dd class="mono">${args.tokenFingerprint}…</dd>
      </dl>
      <p class="dim" style="margin-top: var(--space-2);">
        Rotate the bearer token from <a href="/settings/general">Settings → General</a>.
        Rotating invalidates this snippet — paste the new value into your client config.
      </p>
    </div>

    <div class="card">
      <p class="card__title">Claude Desktop config</p>
      <p class="dim">
        Add this block to your Claude Desktop config (<code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
        on macOS, <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> on Windows), then restart Claude Desktop.
      </p>
      <pre style="font-size: var(--font-size-xs); margin-top: var(--space-2);"><code>${args.claudeDesktopConfig}</code></pre>
    </div>

    <div class="card">
      <p class="card__title">Exposed agents</p>
      ${args.exposedAgents.length === 0
        ? html`<p class="dim">
            No agents are currently exposed via MCP. Set <code>mcp: true</code>
            in an agent's YAML, or toggle the MCP flag from the agent's
            <a href="/agents">overview page</a>.
          </p>`
        : html`
          <table class="table">
            <thead><tr><th>Id</th><th>Description</th><th>Runs</th></tr></thead>
            <tbody>${renderAgentRows(args.exposedAgents) as unknown as SafeHtml[]}</tbody>
          </table>
        `}
    </div>

    <div class="card">
      <p class="card__title">Logs</p>
      <p class="dim">
        Runtime output from the MCP server is appended to
        <code>${args.status.logPath}</code>.
        The file rotates at 10 MB; one prior copy is kept as
        <code>${args.status.logPath}.1</code>.
      </p>
    </div>
  `;
}

function renderStatusBlock(status: ServiceStatus): SafeHtml {
  const badge = status.state === 'running'
    ? html`<span class="badge badge--ok">running</span>`
    : status.state === 'stale'
    ? html`<span class="badge badge--warn">stale (PID ${String(status.pid ?? '?')} dead)</span>`
    : html`<span class="badge badge--muted">stopped</span>`;
  const pidLine = status.pid !== undefined && status.state === 'running'
    ? html`<dd class="mono">PID ${String(status.pid)}</dd>`
    : html`<dd class="dim">—</dd>`;
  return html`
    <dl class="kv">
      <dt>State</dt><dd>${badge}</dd>
      <dt>Process</dt>${pidLine}
    </dl>
  `;
}

function renderAgentRows(rows: Array<{ agent: Agent; runCount: number }>): SafeHtml[] {
  return rows.map(({ agent, runCount }) => html`
    <tr>
      <td><a href="/agents/${agent.id}" class="mono">${agent.id}</a></td>
      <td class="dim">${agent.description ?? ''}</td>
      <td class="mono">${String(runCount)}</td>
    </tr>
  `) as unknown as SafeHtml[];
}
