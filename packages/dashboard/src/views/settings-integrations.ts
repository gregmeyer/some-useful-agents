import type { Integration } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export type IntegrationsTab = 'all' | 'slack' | 'webhook' | 'file' | 'gmail';

export interface SettingsIntegrationsArgs {
  integrations: Integration[];
  /** Active tab. Defaults to 'all' (overview table + no add form). */
  activeTab?: IntegrationsTab;
  /** Preserved form values + error after a failed add. Keyed by kind. */
  addError?: { kind: string; message: string; values: Record<string, string> };
  /** Optional flash banner (test-send result, etc.) rendered above the table. */
  inlineNote?: { kind: 'ok' | 'error' | 'info'; message: string };
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
    ${tab === 'gmail' ? renderGmailForm(args) : unsafeHtml('')}
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
      ${tab('gmail', 'Gmail')}
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
    case 'gmail': {
      const connected = typeof i.config.connected_account === 'string' && i.config.connected_account.length > 0;
      const account = typeof i.config.connected_account === 'string' ? i.config.connected_account : '';
      if (connected) {
        const form = `<form action="/settings/integrations/${esc(i.id)}/disconnect" method="post" style="display: inline; margin-left: var(--space-2);">` +
          `<button type="submit" class="btn btn--sm btn--ghost">Disconnect</button></form>`;
        return unsafeHtml(`<span class="badge badge--ok">connected as ${esc(account)}</span>${form}`);
      }
      const form = `<form action="/settings/integrations/${esc(i.id)}/connect" method="post" style="display: inline; margin-left: var(--space-2);">` +
        `<button type="submit" class="btn btn--sm">Connect Google</button></form>`;
      return unsafeHtml(`<span class="badge badge--muted">not connected</span>${form}`);
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

function renderGmailForm(args: SettingsIntegrationsArgs): SafeHtml {
  const err = args.addError?.kind === 'gmail' ? args.addError : undefined;
  const v = err?.values ?? {};
  return html`
    ${renderGmailSetupGuide()}
    <div class="card">
      <p class="card__title">Add Gmail integration</p>
      <p class="dim">
        Already have the client_id + client_secret in
        <a href="/settings/secrets">Settings → Secrets</a>? Add the
        integration here, then return to the table above and click
        <strong>Connect Google</strong>.
      </p>
      ${err ? html`<div class="flash flash--error mb-3">${err.message}</div>` : unsafeHtml('')}
      <form action="/settings/integrations/add" method="post" class="settings-form">
        <input type="hidden" name="kind" value="gmail">
        ${idAndNameFields(v)}
        <label class="settings-form__label" for="gmail-client-id-secret">client_id secret name</label>
        <input id="gmail-client-id-secret" name="client_id_secret" type="text" required
          pattern="[A-Z_][A-Z0-9_]*"
          placeholder="GMAIL_CLIENT_ID"
          value="${v.client_id_secret ?? 'GMAIL_CLIENT_ID'}"
          autocapitalize="off" autocorrect="off" spellcheck="false">

        <label class="settings-form__label" for="gmail-client-secret-secret">client_secret secret name</label>
        <input id="gmail-client-secret-secret" name="client_secret_secret" type="text" required
          pattern="[A-Z_][A-Z0-9_]*"
          placeholder="GMAIL_CLIENT_SECRET"
          value="${v.client_secret_secret ?? 'GMAIL_CLIENT_SECRET'}"
          autocapitalize="off" autocorrect="off" spellcheck="false">

        <div class="settings-form__actions">
          <button type="submit" class="btn btn--primary">Add Gmail integration</button>
        </div>
      </form>
    </div>
  `;
}

function renderGmailSetupGuide(): SafeHtml {
  return html`
    <details class="card" open>
      <summary class="card__title" style="cursor: pointer;">Where do client_id and client_secret come from?</summary>
      <p class="dim" style="margin-top: var(--space-2);">
        <strong>Short answer:</strong> Google Cloud Console
        (<a href="https://console.cloud.google.com" target="_blank" rel="noopener">console.cloud.google.com</a>),
        not <code>admin.google.com</code>. admin.google.com is for Workspace administrators managing users —
        it's a different surface that doesn't expose OAuth client creation.
      </p>
      <p class="dim">If you have any Google account (personal Gmail or Workspace), follow these steps:</p>
      <ol style="font-size: var(--font-size-sm); line-height: 1.6; padding-left: var(--space-5);">
        <li>
          Open
          <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com/projectcreate</a>
          and create a project (any name; this scopes your OAuth client + API enablement).
        </li>
        <li>
          Enable the Gmail API for that project:
          <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener">apis/library/gmail.googleapis.com</a>
          → click <strong>Enable</strong>.
        </li>
        <li>
          Configure the OAuth consent screen:
          <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noopener">apis/credentials/consent</a>.
          Pick <strong>External</strong> (for personal Gmail) or <strong>Internal</strong> (Workspace only).
          Add the scope <code>https://www.googleapis.com/auth/gmail.send</code>. Add your own email under
          "Test users" — that keeps the app in test mode without verification, which is fine for a local-only tool.
        </li>
        <li>
          Create the OAuth 2.0 Client ID:
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">apis/credentials</a>
          → <strong>Create credentials → OAuth client ID</strong>. <em>Application type:</em>
          <strong>Web application</strong>. Under "Authorized redirect URIs" add:
          <code>http://127.0.0.1:3000/oauth/callback</code>
          (adjust the port if your dashboard runs elsewhere).
          <span class="dim" style="font-size: var(--font-size-xs);">("Desktop app" also works without registering a URI, but Web application makes the redirect explicit + auditable.)</span>
        </li>
        <li>
          Click Create. Google shows the <strong>client_id</strong> + <strong>client_secret</strong>. Copy both,
          go to <a href="/settings/secrets">Settings → Secrets</a>, and set them as
          <code>GMAIL_CLIENT_ID</code> + <code>GMAIL_CLIENT_SECRET</code> (or any names you'll reference below).
        </li>
        <li>
          Return here, add the Gmail integration with those secret names, then click <strong>Connect Google</strong>
          on the integration row above. Google walks you through consent; sua stores only a refresh token, encrypted.
        </li>
      </ol>
      <p class="dim" style="font-size: var(--font-size-xs); margin-top: var(--space-2);">
        <strong>Why bring-your-own credentials?</strong> sua is an open-source local tool. Bundling a hosted client_id
        would need Google's app verification (weeks of paperwork for sensitive Gmail scopes) and would route every
        user's consent through a single Google project. Your own client keeps your OAuth identity isolated and
        doesn't require any approval. A future release may offer a verified shared client as an opt-in;
        for now, this is the trust-clean path.
      </p>
    </details>
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
