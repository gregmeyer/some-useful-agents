import type { Integration } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface SettingsIntegrationsArgs {
  integrations: Integration[];
  /** Preserved form values + error after a failed add. Keyed by kind. */
  addError?: { kind: string; message: string; values: Record<string, string> };
  /** Optional flash banner (test-send result, etc.) rendered above the table. */
  inlineNote?: { kind: 'ok' | 'error' | 'info'; message: string };
}

/**
 * Render the `/settings/integrations` body. Three "kinds" in PR 1 —
 * slack (incoming webhook), webhook (generic POST/PUT), file (local
 * append/overwrite). Each gets its own dedicated form to keep the
 * surface zero-JS; kinds with very different fields don't share a UI.
 *
 * The "ID" field is the slug agents will reference, prefixed with
 * `user:` server-side. Pack-installed integrations show up here too
 * but their Delete button is disabled (they belong to the pack).
 */
export function renderSettingsIntegrations(args: SettingsIntegrationsArgs): SafeHtml {
  return html`
    <div class="card">
      <p class="card__title">Integrations</p>
      <p class="dim">
        Named external-service configurations. Agents will reference
        these by id in notify handlers (and later, connectors) instead
        of declaring raw secret names per-agent. Today only the storage
        + UI exist — wiring agents to read them lands in the next PR.
      </p>
      ${args.inlineNote ? html`<div class="flash flash--${args.inlineNote.kind} mb-3">${args.inlineNote.message}</div>` : unsafeHtml('')}
      ${renderIntegrationsTable(args.integrations)}
    </div>

    ${renderSlackForm(args)}
    ${renderWebhookForm(args)}
    ${renderFileForm(args)}
  `;
}

function renderIntegrationsTable(integrations: Integration[]): SafeHtml {
  if (integrations.length === 0) {
    return html`<p class="settings-empty mt-3">No integrations yet. Add one below.</p>`;
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
