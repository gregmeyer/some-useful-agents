import type { ToolDefinition, McpServerConfig } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export interface DiscoveredTool {
  name: string;
  description?: string;
  /** Raw JSON schema from the MCP server; used to map to tool inputs. */
  inputSchema?: unknown;
}

/** One row per server in the discover step, grouped for the checkbox picker. */
export interface DiscoveredServer {
  server: McpServerConfig;
  /** Populated on success; empty + `error` set on failure. */
  tools: DiscoveredTool[];
  error?: string;
}

export interface ImportFormState {
  /** Raw pasted config (JSON or YAML). Preserved across round-trips. */
  configBlob?: string;
  /** Quick-add URL (HTTP transport shortcut). Preserved across round-trips. */
  quickUrl?: string;
  /** Quick-add name. Preserved across round-trips. */
  quickName?: string;
  /** Root-level or per-entry parse errors from the paste. */
  parseErrors?: Array<{ key: string; message: string }>;
  /** Top-level connect/form error. */
  error?: string;
  /** Discovered servers + their tools (one section per server). */
  servers?: DiscoveredServer[];
  /** Existing tool ids in the store, for conflict highlighting. */
  existingIds?: Set<string>;
  /** Existing server ids, for "already imported" badges. */
  existingServerIds?: Set<string>;
}

export function renderMcpImport(state: ImportFormState): string {
  const body = html`
    ${pageHeader({
      title: 'Import MCP servers',
      description: 'Paste a Claude Desktop / Cursor mcpServers config and import its tools.',
      back: { href: '/tools', label: 'Back to tools' },
    })}

    ${state.error ? html`<div class="banner banner--err">${state.error}</div>` : html``}
    ${renderParseErrors(state.parseErrors)}

    <form method="POST" action="/tools/mcp/import" class="card" style="padding: var(--space-4); margin-bottom: var(--space-4);">
      <input type="hidden" name="step" value="discover" />
      <p class="card__title">Quick add by URL (HTTP servers)</p>
      <p class="dim">For servers that expose MCP over HTTP — just the endpoint URL, no JSON required. For stdio / docker servers, use the paste form below.</p>
      <div style="display: grid; gap: var(--space-3); grid-template-columns: 1fr 1fr auto; align-items: end; max-width: 56rem;">
        <label>
          <span style="display:block; font-weight:var(--weight-bold);">URL</span>
          <input type="text" name="quickUrl" value="${state.quickUrl ?? ''}" placeholder="http://127.0.0.1:4000/mcp"
            style="width:100%; font-family:var(--font-mono);">
        </label>
        <label>
          <span style="display:block; font-weight:var(--weight-bold);">Name (optional)</span>
          <input type="text" name="quickName" value="${state.quickName ?? ''}" placeholder="my-server"
            style="width:100%; font-family:var(--font-mono);">
        </label>
        <button type="submit" class="btn">Discover</button>
      </div>
    </form>

    <form method="POST" action="/tools/mcp/import" class="card" style="padding: var(--space-4);">
      <input type="hidden" name="step" value="discover" />
      <div style="display: grid; gap: var(--space-3); max-width: 56rem;">
        <label>
          <span style="display:block; font-weight:var(--weight-bold);">Paste full config (JSON or YAML)</span>
          <textarea name="configBlob" rows="12" required placeholder="${CONFIG_PLACEHOLDER}"
            style="width:100%; font-family:var(--font-mono); font-size: var(--font-size-sm);">${state.configBlob ?? ''}</textarea>
          <small class="dim">
            Accepts <code>{"mcpServers": {...}}</code>, a bare map like
            <code>{"my-server": {...}}</code>, or a single
            <code>{"command": ..., "args": [...]}</code> entry.
            Multiple servers in one paste are all imported together.
          </small>
        </label>
        <div>
          <button type="submit" class="btn">Discover tools</button>
          <a href="/settings/mcp-servers" class="btn btn--ghost">Manage imported servers</a>
        </div>
      </div>
    </form>

    ${state.servers ? renderServerPicker(state) : html``}
  `;

  return render(layout({ title: 'Import MCP servers', activeNav: 'tools' }, body));
}

const CONFIG_PLACEHOLDER = `{
  "mcpServers": {
    "modern-graphics": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "modern-graphics"],
      "env": {}
    }
  }
}`;

function renderParseErrors(errors: Array<{ key: string; message: string }> | undefined): SafeHtml {
  if (!errors || errors.length === 0) return unsafeHtml('');
  return html`
    <div class="banner banner--warn">
      <strong>Some entries in the config were skipped:</strong>
      <ul style="margin: var(--space-2) 0 0 var(--space-4);">
        ${errors.map((e) => html`<li class="mono">${e.key}: <span class="dim">${e.message}</span></li>`) as unknown as SafeHtml[]}
      </ul>
    </div>
  `;
}

function renderServerPicker(state: ImportFormState): SafeHtml {
  const servers = state.servers ?? [];
  const existingTools = state.existingIds ?? new Set<string>();
  const existingServers = state.existingServerIds ?? new Set<string>();
  if (servers.length === 0) {
    return html`<p class="dim" style="margin-top: var(--space-5);">No servers discovered.</p>`;
  }

  const sections = servers.map((ds) => {
    const s = ds.server;
    const alreadyImported = existingServers.has(s.id);
    if (ds.error) {
      return html`
        <section class="card" style="padding: var(--space-3); margin-top: var(--space-3);">
          <h3 class="mono">${s.id} <span class="badge badge--err">connect failed</span></h3>
          <p class="dim">${ds.error}</p>
        </section>
      `;
    }
    const rows = ds.tools.map((t) => {
      const localId = `${s.id}-${slug(t.name)}`;
      const conflict = existingTools.has(localId);
      const checkboxValue = `${s.id}|${t.name}`;
      return html`
        <tr>
          <td><input type="checkbox" name="select" value="${checkboxValue}"${conflict ? '' : ' checked'}></td>
          <td class="mono">${t.name}</td>
          <td class="mono">${localId}${conflict ? html` <span class="badge badge--warn">exists</span>` : html``}</td>
          <td class="dim">${t.description ?? ''}</td>
        </tr>
      `;
    });
    return html`
      <section class="card" style="padding: var(--space-3); margin-top: var(--space-3);">
        <h3 class="mono">${s.id} <span class="badge badge--info">${s.transport}</span>${alreadyImported ? html` <span class="badge badge--muted">already imported</span>` : html``}</h3>
        <p class="dim">${String(ds.tools.length)} tools — <span class="mono">${s.transport === 'http' ? (s.url ?? '') : [s.command ?? '', ...(s.args ?? [])].join(' ')}</span></p>
        <table class="table">
          <thead><tr><th></th><th>Remote name</th><th>Local id</th><th>Description</th></tr></thead>
          <tbody>${rows as unknown as SafeHtml[]}</tbody>
        </table>
      </section>
    `;
  });

  return html`
    <form method="POST" action="/tools/mcp/import" style="margin-top: var(--space-5);">
      <input type="hidden" name="step" value="create" />
      <input type="hidden" name="configBlob" value="${state.configBlob ?? ''}" />
      <input type="hidden" name="quickUrl" value="${state.quickUrl ?? ''}" />
      <input type="hidden" name="quickName" value="${state.quickName ?? ''}" />
      <h2>Review and create</h2>
      ${sections as unknown as SafeHtml[]}
      <div style="margin-top: var(--space-4);">
        <button type="submit" class="btn">Create selected tools</button>
      </div>
    </form>
  `;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function renderMcpImportResult(args: {
  created: ToolDefinition[];
  skipped: Array<{ name: string; reason: string }>;
  serversCreated: string[];
}): string {
  const body = html`
    ${pageHeader({
      title: 'MCP import complete',
      back: { href: '/tools', label: 'Back to tools' },
    })}

    ${args.serversCreated.length > 0 ? html`
      <section>
        <h2>Servers configured (${String(args.serversCreated.length)})</h2>
        <ul>
          ${args.serversCreated.map((id) => html`<li class="mono"><a href="/settings/mcp-servers">${id}</a></li>`) as unknown as SafeHtml[]}
        </ul>
      </section>
    ` : html``}

    ${args.created.length > 0 ? html`
      <section style="margin-top: var(--space-5);">
        <h2>Tools created (${String(args.created.length)})</h2>
        <ul>
          ${args.created.map((t) => html`<li><a href="/tools/${t.id}" class="mono">${t.id}</a></li>`) as unknown as SafeHtml[]}
        </ul>
      </section>
    ` : html``}

    ${args.skipped.length > 0 ? html`
      <section style="margin-top: var(--space-5);">
        <h2>Skipped (${String(args.skipped.length)})</h2>
        <ul>
          ${args.skipped.map((s) => html`<li class="mono">${s.name} — <span class="dim">${s.reason}</span></li>`) as unknown as SafeHtml[]}
        </ul>
      </section>
    ` : html``}
  `;

  return render(layout({ title: 'MCP import complete', activeNav: 'tools' }, body));
}
