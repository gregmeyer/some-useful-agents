import type { McpServerConfig } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface SettingsMcpServersArgs {
  /** All MCP servers, sorted by id, with the count of imported tools. */
  rows: Array<{ server: McpServerConfig; toolCount: number }>;
  /** Inline error from a failed toggle/delete. */
  setError?: string;
}

/**
 * Render the `/settings/mcp-servers` body. Lists every MCP server that
 * has been imported and lets the user toggle it on/off (gates all its
 * tools at execution time) or delete it (cascades to its tools).
 *
 * New servers are added via the Tools page import flow, not here —
 * `/tools/mcp/import`. This keeps discovery (which needs to connect and
 * list tools) out of the settings surface.
 */
export function renderSettingsMcpServers(args: SettingsMcpServersArgs): SafeHtml {
  return html`
    <div class="card">
      <p class="card__title">MCP servers</p>
      <p class="dim">
        Servers imported via <a href="/tools/mcp/import">Tools \u2192 Import</a>.
        Disabling a server blocks every tool imported from it — runs that
        reach one of those tools fail with a clear "server disabled" error
        until you re-enable it. Deleting removes the server and every tool
        that was imported from it.
      </p>
      ${setErrorBlock(args.setError)}
      ${renderServersTable(args.rows)}
    </div>

    <div class="card">
      <p class="card__title">Add a server</p>
      <p class="dim">
        Paste a Claude Desktop / Cursor <code>mcpServers</code> config on the
        <a href="/tools/mcp/import">import page</a>. Multiple servers can be
        added in one paste.
      </p>
    </div>
  `;
}

function renderServersTable(rows: Array<{ server: McpServerConfig; toolCount: number }>): SafeHtml {
  if (rows.length === 0) {
    return html`<p class="settings-empty mt-3">No MCP servers imported yet. Use <a href="/tools/mcp/import">Tools \u2192 Import</a> to add one.</p>`;
  }
  const body = rows.map(({ server, toolCount }) => {
    const target = server.transport === 'http'
      ? server.url ?? ''
      : [server.command ?? '', ...(server.args ?? [])].join(' ');
    const toggleAction = server.enabled ? 'disable' : 'enable';
    const toggleLabel = server.enabled ? 'Disable' : 'Enable';
    return html`
      <tr>
        <td class="mono">${server.id}</td>
        <td>${server.transport}</td>
        <td class="mono dim" style="max-width: 28rem; overflow-wrap: anywhere;">${target}</td>
        <td>${String(toolCount)}</td>
        <td>${server.enabled ? html`<span class="badge badge--ok">enabled</span>` : html`<span class="badge badge--muted">disabled</span>`}</td>
        <td class="text-right" style="white-space: nowrap;">
          <form action="/settings/mcp-servers/toggle" method="post" style="display:inline;">
            <input type="hidden" name="id" value="${server.id}">
            <input type="hidden" name="action" value="${toggleAction}">
            <button type="submit" class="btn btn--sm btn--ghost">${toggleLabel}</button>
          </form>
          <form action="/settings/mcp-servers/delete" method="post" style="display:inline;"
            data-confirm="Delete server ${server.id}? This will also delete ${String(toolCount)} imported tool${toolCount === 1 ? '' : 's'}.">
            <input type="hidden" name="id" value="${server.id}">
            <button type="submit" class="btn btn--sm btn--ghost">Delete</button>
          </form>
        </td>
      </tr>
    `;
  });

  return html`
    <table class="table mt-3">
      <thead>
        <tr>
          <th>Id</th>
          <th>Transport</th>
          <th>Target</th>
          <th>Tools</th>
          <th>Status</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>${body as unknown as SafeHtml[]}</tbody>
    </table>
  `;
}

function setErrorBlock(err: string | undefined): SafeHtml {
  if (!err) return unsafeHtml('');
  return html`<div class="flash flash--error mb-3">${err}</div>`;
}
