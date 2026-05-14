import type { Integration } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export type IntegrationsTab = 'all' | 'slack' | 'webhook' | 'file' | 'mcp-tool' | 'csv';

export interface SettingsIntegrationsArgs {
  integrations: Integration[];
  /** Active tab. Defaults to 'all' (overview table + no add form). */
  activeTab?: IntegrationsTab;
  /** Preserved form values + error after a failed add. Keyed by kind. */
  addError?: { kind: string; message: string; values: Record<string, string> };
  /** Optional flash banner (test-send result, etc.) rendered above the table. */
  inlineNote?: { kind: 'ok' | 'error' | 'info'; message: string };
  /** Connected MCP servers (enabled only) — populates the mcp-tool form's server dropdown. */
  mcpServers?: Array<{ id: string; name: string }>;
  /** Cached MCP tools — populates the mcp-tool form's tool dropdown, keyed by server id. */
  mcpToolsByServer?: Record<string, Array<{ name: string; description?: string }>>;
}

/**
 * Render the `/settings/integrations` body.
 *
 * Tabbed by kind so the page stays scannable as we add more kinds. The
 * "All" tab is the overview — every row, no add form. Per-kind tabs
 * show only rows of that kind plus the dedicated add form. The active
 * tab is selected via `?tab=` so the page is bookmarkable + reload-
 * stable; no client JS for the tab strip itself.
 */
export function renderSettingsIntegrations(args: SettingsIntegrationsArgs): SafeHtml {
  const tab = args.activeTab ?? 'all';
  const filtered = tab === 'all'
    ? args.integrations
    : args.integrations.filter((i) => i.kind === tab);
  return html`
    <div class="card">
      <p class="card__title">Integrations</p>
      <p class="dim">
        Named external-service configurations. Agents reference these by
        id in notify handlers (and later, connectors) instead of declaring
        raw secret names per-agent.
      </p>
      ${args.inlineNote ? html`<div class="flash flash--${args.inlineNote.kind} mb-3">${args.inlineNote.message}</div>` : unsafeHtml('')}
      ${renderTabStrip(tab, args.integrations)}
      ${renderIntegrationsTable(filtered, tab)}
    </div>

    ${tab === 'slack' ? renderSlackForm(args) : unsafeHtml('')}
    ${tab === 'webhook' ? renderWebhookForm(args) : unsafeHtml('')}
    ${tab === 'file' ? renderFileForm(args) : unsafeHtml('')}
    ${tab === 'mcp-tool' ? renderMcpToolForm(args) : unsafeHtml('')}
    ${tab === 'csv' ? renderCsvForm(args) : unsafeHtml('')}
  `;
}

function renderTabStrip(active: IntegrationsTab, integrations: Integration[]): SafeHtml {
  const counts: Record<string, number> = {};
  for (const i of integrations) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  const tab = (id: IntegrationsTab, label: string) => {
    const count = id === 'all' ? integrations.length : (counts[id] ?? 0);
    const countBadge = count > 0 ? html` <span class="dim" style="font-size: var(--font-size-xs);">(${String(count)})</span>` : html``;
    return html`<a href="/settings/integrations?tab=${id}" class="${active === id ? 'is-active' : ''}">${label}${countBadge}</a>`;
  };
  return html`
    <nav class="tab-strip" style="margin-top: var(--space-3);">
      ${tab('all', 'All')}
      ${tab('slack', 'Slack')}
      ${tab('webhook', 'Webhook')}
      ${tab('file', 'File')}
      ${tab('mcp-tool', 'MCP Tool')}
      ${tab('csv', 'CSV')}
    </nav>
  `;
}

function renderIntegrationsTable(integrations: Integration[], tab: IntegrationsTab): SafeHtml {
  if (integrations.length === 0) {
    const msg = tab === 'all'
      ? 'No integrations yet. Pick a kind tab above to add one.'
      : `No ${tab} integrations yet. Add one below.`;
    return html`<p class="settings-empty mt-3">${msg}</p>`;
  }
  const rows = integrations.map((i) => html`
    <tr>
      <td class="mono">${i.id}</td>
      <td><span class="badge">${i.kind}</span></td>
      <td>${i.name}</td>
      <td class="dim mono" style="font-size: var(--font-size-xs);">${describeConfig(i)}</td>
      <td class="mono" style="font-size: var(--font-size-xs);">${i.secretRefs.join(', ') || html`<span class="dim">none</span>`}</td>
      <td class="text-right">
        ${i.packId
          ? html`<button type="button" class="btn btn--sm btn--ghost" disabled title="Pack-owned — uninstall the pack to remove">Delete</button>`
          : html`
            <form action="/settings/integrations/delete" method="post" style="display: inline;"
              data-confirm="Delete integration ${i.id}? Agents that reference it will fall back to inline handlers.">
              <input type="hidden" name="id" value="${i.id}">
              <button type="submit" class="btn btn--sm btn--ghost">Delete</button>
            </form>
          `}
      </td>
    </tr>
  `);
  return html`
    <table class="table mt-3">
      <thead>
        <tr>
          <th>ID</th>
          <th>Kind</th>
          <th>Name</th>
          <th>Config</th>
          <th>Secrets</th>
          <th class="text-right">Action</th>
        </tr>
      </thead>
      <tbody>${rows as unknown as SafeHtml[]}</tbody>
    </table>
  `;
}

function describeConfig(i: Integration): SafeHtml {
  switch (i.kind) {
    case 'slack': {
      const channel = typeof i.config.channel === 'string' ? i.config.channel : '';
      const mention = typeof i.config.mention === 'string' ? i.config.mention : '';
      const bits = [channel && `channel=${channel}`, mention && `mention=${mention}`].filter(Boolean) as string[];
      return unsafeHtml(escAll(bits.join(', ')) || '<span class="dim">webhook only</span>');
    }
    case 'webhook': {
      const url = typeof i.config.url === 'string' ? i.config.url : '';
      const method = typeof i.config.method === 'string' ? i.config.method : 'POST';
      return unsafeHtml(`${esc(method)} ${esc(url)}`);
    }
    case 'file': {
      const path = typeof i.config.path === 'string' ? i.config.path : '';
      const append = i.config.append !== false;
      return unsafeHtml(`${esc(path)} <span class="dim">(${append ? 'append' : 'overwrite'})</span>`);
    }
    case 'mcp-tool': {
      const server = typeof i.config.server_id === 'string' ? i.config.server_id : '';
      const tool = typeof i.config.tool_name === 'string' ? i.config.tool_name : '';
      return unsafeHtml(`<code>${esc(server)}</code> → <code>${esc(tool)}</code>`);
    }
    case 'csv': {
      const path = typeof i.config.path === 'string' ? i.config.path : '';
      const schema = i.config.schema as { columns?: Array<unknown>; rowCount?: number } | undefined;
      const cols = Array.isArray(schema?.columns) ? schema.columns.length : 0;
      const rows = typeof schema?.rowCount === 'number' ? schema.rowCount : 0;
      return unsafeHtml(`<code>${esc(path)}</code> <span class="dim">(${cols} col${cols === 1 ? '' : 's'}, ${rows} row${rows === 1 ? '' : 's'})</span>`);
    }
    default:
      return unsafeHtml('<span class="dim">—</span>');
  }
}

function renderSlackForm(args: SettingsIntegrationsArgs): SafeHtml {
  const err = args.addError?.kind === 'slack' ? args.addError : undefined;
  const v = err?.values ?? {};
  return html`
    <div class="card">
      <p class="card__title">Add Slack</p>
      <p class="dim">
        Posts a Block Kit message to a Slack workspace via an
        <a href="https://api.slack.com/messaging/webhooks">incoming webhook URL</a>.
        The URL itself is stored in <a href="/settings/secrets">Secrets</a> —
        only the name is referenced here.
      </p>
      ${err ? html`<div class="flash flash--error mb-3">${err.message}</div>` : unsafeHtml('')}
      <form action="/settings/integrations/add" method="post" class="settings-form">
        <input type="hidden" name="kind" value="slack">
        ${idAndNameFields(v)}
        <label class="settings-form__label" for="slack-webhook-secret">Webhook secret name</label>
        <input id="slack-webhook-secret" name="webhook_secret" type="text" required
          pattern="[A-Z_][A-Z0-9_]*"
          placeholder="SLACK_WEBHOOK"
          value="${v.webhook_secret ?? ''}"
          autocapitalize="off" autocorrect="off" spellcheck="false">

        <label class="settings-form__label" for="slack-channel">Channel (optional)</label>
        <input id="slack-channel" name="channel" type="text"
          placeholder="#alerts"
          value="${v.channel ?? ''}">

        <label class="settings-form__label" for="slack-mention">Mention (optional)</label>
        <input id="slack-mention" name="mention" type="text"
          placeholder="@oncall"
          value="${v.mention ?? ''}">

        <div class="settings-form__actions">
          <button type="submit" class="btn btn--primary">Add Slack integration</button>
        </div>
      </form>
    </div>
  `;
}

function renderWebhookForm(args: SettingsIntegrationsArgs): SafeHtml {
  const err = args.addError?.kind === 'webhook' ? args.addError : undefined;
  const v = err?.values ?? {};
  return html`
    <div class="card">
      <p class="card__title">Add Webhook</p>
      <p class="dim">Generic HTTPS POST or PUT. Optional bearer token in <code>Authorization</code> header.</p>
      ${err ? html`<div class="flash flash--error mb-3">${err.message}</div>` : unsafeHtml('')}
      <form action="/settings/integrations/add" method="post" class="settings-form">
        <input type="hidden" name="kind" value="webhook">
        ${idAndNameFields(v)}
        <label class="settings-form__label" for="webhook-url">URL</label>
        <input id="webhook-url" name="url" type="url" required
          placeholder="https://hooks.example.com/incoming"
          value="${v.url ?? ''}">

        <label class="settings-form__label" for="webhook-method">Method</label>
        <select id="webhook-method" name="method">
          <option value="POST" ${(v.method ?? 'POST') === 'POST' ? 'selected' : ''}>POST</option>
          <option value="PUT" ${v.method === 'PUT' ? 'selected' : ''}>PUT</option>
        </select>

        <label class="settings-form__label" for="webhook-headers-secret">Bearer token secret (optional)</label>
        <input id="webhook-headers-secret" name="headers_secret" type="text"
          pattern="[A-Z_][A-Z0-9_]*"
          placeholder="WEBHOOK_TOKEN"
          value="${v.headers_secret ?? ''}"
          autocapitalize="off" autocorrect="off" spellcheck="false">

        <div class="settings-form__actions">
          <button type="submit" class="btn btn--primary">Add Webhook integration</button>
        </div>
      </form>
    </div>
  `;
}

function renderMcpToolForm(args: SettingsIntegrationsArgs): SafeHtml {
  const err = args.addError?.kind === 'mcp-tool' ? args.addError : undefined;
  const v = err?.values ?? {};
  const servers = args.mcpServers ?? [];
  const toolsByServer = args.mcpToolsByServer ?? {};
  const selectedServer = v.server_id ?? (servers[0]?.id ?? '');
  const toolsForSelected = toolsByServer[selectedServer] ?? [];

  // Encode the cached tools-by-server map for the small inline script
  // that swaps the tool dropdown when the server changes.
  const toolsJson = JSON.stringify(toolsByServer).replace(/</g, '\\u003c');

  return html`
    <div class="card">
      <p class="card__title">Add MCP tool integration</p>
      <p class="dim">
        Bind an MCP server tool you've already connected at
        <a href="/settings/mcp-servers">Settings → MCP Servers</a> to a
        friendly id. Notify handlers and other agents can then say
        <code>integration: user:&lt;id&gt;</code> instead of repeating the server
        + tool name. Auth lives with the MCP server — sua never sees the
        underlying credentials.
      </p>
      ${err ? html`<div class="flash flash--error mb-3">${err.message}</div>` : unsafeHtml('')}
      ${servers.length === 0
        ? html`<div class="flash flash--info mb-3">No MCP servers connected. Add one at <a href="/settings/mcp-servers">Settings → MCP Servers</a> first.</div>`
        : unsafeHtml('')}
      <form action="/settings/integrations/add" method="post" class="settings-form">
        <input type="hidden" name="kind" value="mcp-tool">
        ${idAndNameFields(v)}

        <label class="settings-form__label" for="mcp-tool-server">MCP server</label>
        <select id="mcp-tool-server" name="server_id" required ${servers.length === 0 ? 'disabled' : ''}>
          ${servers.map((s) => html`<option value="${s.id}" ${s.id === selectedServer ? 'selected' : ''}>${s.name} (${s.id})</option>`) as unknown as SafeHtml[]}
        </select>

        <label class="settings-form__label" for="mcp-tool-name">Tool</label>
        <select id="mcp-tool-name" name="tool_name" required ${toolsForSelected.length === 0 ? 'disabled' : ''}>
          ${toolsForSelected.map((t) => html`<option value="${t.name}" ${t.name === (v.tool_name ?? '') ? 'selected' : ''}>${t.name}</option>`) as unknown as SafeHtml[]}
        </select>

        <label class="settings-form__label" for="mcp-tool-default-inputs">Default inputs (JSON, optional)</label>
        <textarea id="mcp-tool-default-inputs" name="default_inputs" rows="4"
          placeholder='{ "to": "alerts@example.com", "subject": "Run {{run.status}}: {{agent.name}}" }'
          style="font-family: var(--font-mono); font-size: var(--font-size-xs);">${v.default_inputs ?? ''}</textarea>
        <p class="dim" style="font-size: var(--font-size-xs); margin-top: var(--space-1);">
          Merged with any per-handler <code>inputs</code> at fire time;
          inline values win. Templates: <code>{{vars.X}}</code>,
          <code>{{agent.id}}</code>, <code>{{agent.name}}</code>, <code>{{run.id}}</code>,
          <code>{{run.status}}</code>, <code>{{run.error}}</code>.
        </p>

        <div class="settings-form__actions">
          <button type="submit" class="btn btn--primary" ${servers.length === 0 ? 'disabled' : ''}>Add MCP tool integration</button>
        </div>
      </form>
    </div>
    ${unsafeHtml(`<script>
      (function () {
        var byServer = ${toolsJson};
        var serverSel = document.getElementById('mcp-tool-server');
        var toolSel = document.getElementById('mcp-tool-name');
        if (!serverSel || !toolSel) return;
        function refresh() {
          var tools = byServer[serverSel.value] || [];
          toolSel.innerHTML = '';
          if (tools.length === 0) {
            toolSel.disabled = true;
            var opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(no tools imported for this server)';
            toolSel.appendChild(opt);
            return;
          }
          toolSel.disabled = false;
          tools.forEach(function (t) {
            var opt = document.createElement('option');
            opt.value = t.name;
            opt.textContent = t.name;
            toolSel.appendChild(opt);
          });
        }
        serverSel.addEventListener('change', refresh);
      })();
    </script>`)}
  `;
}

function renderCsvForm(args: SettingsIntegrationsArgs): SafeHtml {
  const err = args.addError?.kind === 'csv' ? args.addError : undefined;
  const v = err?.values ?? {};
  return html`
    <div class="card">
      <p class="card__title">Add CSV integration</p>
      <p class="dim">
        Point at a CSV file on disk. On save, sua reads the header + a
        sample of rows to infer column types, then exposes two
        auto-generated tools per CSV:
      </p>
      <ul class="dim" style="margin: var(--space-1) 0 var(--space-3) var(--space-5); font-size: var(--font-size-sm);">
        <li><code>csv.&lt;id&gt;.read</code> — fetch rows, optionally filtered by <code>where</code>, capped by <code>limit</code>.</li>
        <li><code>csv.&lt;id&gt;.count</code> — count matching rows without fetching them.</li>
      </ul>
      ${err ? html`<div class="flash flash--error mb-3">${err.message}</div>` : unsafeHtml('')}
      <form action="/settings/integrations/add" method="post" class="settings-form">
        <input type="hidden" name="kind" value="csv">
        ${idAndNameFields(v)}
        <label class="settings-form__label" for="csv-path">Path</label>
        <input id="csv-path" name="path" type="text" required
          placeholder="data/customers.csv (or an absolute path)"
          value="${v.path ?? ''}"
          autocapitalize="off" autocorrect="off" spellcheck="false">

        <label class="settings-form__label" for="csv-has-header">First row is a header?</label>
        <select id="csv-has-header" name="has_header">
          <option value="true" ${(v.has_header ?? 'true') === 'true' ? 'selected' : ''}>Yes (recommended)</option>
          <option value="false" ${v.has_header === 'false' ? 'selected' : ''}>No — synthesise col_0, col_1, …</option>
        </select>

        <label class="settings-form__label" for="csv-delimiter">Delimiter</label>
        <input id="csv-delimiter" name="delimiter" type="text" maxlength="1"
          placeholder=","
          value="${v.delimiter ?? ','}">

        <div class="settings-form__actions">
          <button type="submit" class="btn btn--primary">Add CSV integration</button>
        </div>
      </form>
    </div>
  `;
}

function renderFileForm(args: SettingsIntegrationsArgs): SafeHtml {
  const err = args.addError?.kind === 'file' ? args.addError : undefined;
  const v = err?.values ?? {};
  return html`
    <div class="card">
      <p class="card__title">Add File</p>
      <p class="dim">Append a JSON line (or overwrite a JSON document) to a local file each time the trigger fires.</p>
      ${err ? html`<div class="flash flash--error mb-3">${err.message}</div>` : unsafeHtml('')}
      <form action="/settings/integrations/add" method="post" class="settings-form">
        <input type="hidden" name="kind" value="file">
        ${idAndNameFields(v)}
        <label class="settings-form__label" for="file-path">Path</label>
        <input id="file-path" name="path" type="text" required
          placeholder="logs/notifications.jsonl"
          value="${v.path ?? ''}">

        <label class="settings-form__label" for="file-mode">Mode</label>
        <select id="file-mode" name="mode">
          <option value="append" ${(v.mode ?? 'append') === 'append' ? 'selected' : ''}>Append (JSONL)</option>
          <option value="overwrite" ${v.mode === 'overwrite' ? 'selected' : ''}>Overwrite</option>
        </select>

        <div class="settings-form__actions">
          <button type="submit" class="btn btn--primary">Add File integration</button>
        </div>
      </form>
    </div>
  `;
}

function idAndNameFields(v: Record<string, string>): SafeHtml {
  return html`
    <label class="settings-form__label" for="i-id">ID slug</label>
    <input id="i-id" name="id" type="text" required
      pattern="[a-z0-9][a-z0-9_-]*"
      placeholder="oncall"
      value="${v.id ?? ''}"
      autocapitalize="off" autocorrect="off" spellcheck="false">

    <label class="settings-form__label" for="i-name">Display name</label>
    <input id="i-name" name="name" type="text" required
      placeholder="Oncall channel"
      value="${v.name ?? ''}">
  `;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAll(s: string): string {
  return esc(s);
}
