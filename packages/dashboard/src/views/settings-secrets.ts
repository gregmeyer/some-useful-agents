import type { SecretsStoreStatus } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface SettingsSecretsArgs {
  status: SecretsStoreStatus;
  isUnlocked: boolean;
  /** Sorted secret names (values never rendered). Empty when locked. */
  names: string[];
  /** Agent-declared secret names that are not yet set. */
  missing: string[];
  /** Inline error (validation / unlock failure), rendered inside the relevant card. */
  unlockError?: string;
  setError?: string;
  /** Preserve the `name` field when a `set` form round-trips with an error. */
  setNameValue?: string;
}

/**
 * Render the `/settings/secrets` body. Three states:
 *   1. Store is passphrase-protected and the session is locked → unlock form only
 *   2. Store is unlocked (or doesn't need unlocking) → list + set form + delete
 *   3. Store is absent → invite to create by setting the first secret
 *
 * Values are never rendered. Delete is a POST with a confirm handler
 * wired via the shared dashboard JS. Set uses type=password so the
 * value doesn't echo to the screen while typing.
 */
export function renderSettingsSecrets(args: SettingsSecretsArgs): SafeHtml {
  const modeLabel = formatModeLabel(args.status);
  const modeBadge = modeBadgeFor(args.status);

  if (args.status.mode === 'passphrase' && !args.isUnlocked) {
    return html`
      <div class="card">
        <p class="card__title">Secrets (locked)</p>
        <p>
          Your secrets store is passphrase-protected. Enter the passphrase
          to unlock for this dashboard session. It stays in memory only —
          nothing is written to disk or cookies.
        </p>
        ${unlockErrorBlock(args.unlockError)}
        <form action="/settings/secrets/unlock" method="post" class="settings-form">
          <label class="settings-form__label" for="passphrase">Passphrase</label>
          <input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required autofocus>
          <div class="settings-form__actions">
            <button type="submit" class="btn btn--primary">Unlock</button>
          </div>
        </form>
        <p class="dim" style="margin-top: var(--space-4);">
          <strong>Store mode:</strong> ${modeBadge} ${modeLabel}
        </p>
      </div>
    `;
  }

  return html`
    <div class="card">
      <p class="card__title">Stored secrets</p>
      <p class="dim">${secretsSummary(args.names.length, args.status, args.isUnlocked)}</p>
      ${renderNamesTable(args.names)}
      ${args.missing.length > 0 ? renderMissingList(args.missing) : unsafeHtml('')}
    </div>

    <div class="card">
      <p class="card__title">Set a secret</p>
      <p class="dim">
        Names must be uppercase letters, digits, or underscores and start
        with a letter or underscore (e.g. <code>SLACK_WEBHOOK</code>).
        Values are written encrypted; never echoed back.
      </p>
      ${setErrorBlock(args.setError)}
      <form action="/settings/secrets/set" method="post" class="settings-form" id="secret-set-form">
        <label class="settings-form__label" for="secret-name">Name</label>
        <input id="secret-name" name="name" type="text" required
          pattern="[A-Z_][A-Z0-9_]*"
          placeholder="MY_API_KEY"
          value="${args.setNameValue ?? ''}"
          autocapitalize="off" autocorrect="off" spellcheck="false">

        <label class="settings-form__label" for="secret-value">Value</label>
        <input id="secret-value" name="value" type="password" required autocomplete="off">

        <div class="settings-form__actions">
          <button type="submit" class="btn btn--primary">Save secret</button>
        </div>
      </form>

      <div id="secret-confirm-modal" class="modal-backdrop" style="display: none;">
        <div class="modal" style="max-width: 500px;">
          <h3 style="margin: 0 0 var(--space-3);">Copy your secret value</h3>
          <p class="dim" style="margin: 0 0 var(--space-3);">
            After saving, this value will be encrypted and <strong>never shown again</strong>.
            Copy it now if you need it elsewhere.
          </p>
          <div style="display: flex; gap: var(--space-2); align-items: center; margin-bottom: var(--space-4);">
            <code id="secret-confirm-value" style="flex: 1; padding: var(--space-2) var(--space-3); background: var(--color-surface-raised); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); word-break: break-all;"></code>
            <button type="button" class="btn btn--sm" id="secret-copy-btn" title="Copy to clipboard">Copy</button>
          </div>
          <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
            <button type="button" class="btn btn--ghost" id="secret-cancel-btn">Cancel</button>
            <button type="button" class="btn btn--primary" id="secret-save-btn">Save secret</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <p class="card__title">Session</p>
      <p class="dim">
        <strong>Store mode:</strong> ${modeBadge} ${modeLabel}
      </p>
      ${args.status.mode === 'passphrase'
        ? html`
          <form action="/settings/secrets/lock" method="post" style="margin-top: var(--space-3);">
            <button type="submit" class="btn btn--ghost">Lock now</button>
          </form>`
        : unsafeHtml('')}
    </div>
  `;
}

function renderNamesTable(names: string[]): SafeHtml {
  if (names.length === 0) {
    return html`<p class="settings-empty" style="margin-top: var(--space-3);">No secrets set yet.</p>`;
  }
  const rows = names.map((n) => html`
    <tr>
      <td class="mono">${n}</td>
      <td style="text-align: right;">
        <form action="/settings/secrets/delete" method="post"
          data-confirm="Delete secret ${n}? Agents that reference it will fail until it's set again.">
          <input type="hidden" name="name" value="${n}">
          <button type="submit" class="btn btn--sm btn--ghost">Delete</button>
        </form>
      </td>
    </tr>
  `);
  return html`
    <table class="table" style="margin-top: var(--space-3);">
      <thead>
        <tr>
          <th>Name</th>
          <th style="text-align: right;">Action</th>
        </tr>
      </thead>
      <tbody>${rows as unknown as SafeHtml[]}</tbody>
    </table>
  `;
}

function renderMissingList(missing: string[]): SafeHtml {
  const items = missing.map((n) => html`<li class="mono">${n}</li>`);
  return html`
    <div style="margin-top: var(--space-4);">
      <p class="card__title" style="margin-bottom: var(--space-2);">Declared by agents but not set</p>
      <ul class="settings-missing">${items as unknown as SafeHtml[]}</ul>
    </div>
  `;
}

function unlockErrorBlock(err: string | undefined): SafeHtml {
  if (!err) return unsafeHtml('');
  return html`<div class="flash flash--error" style="margin-bottom: var(--space-3);">${err}</div>`;
}

function setErrorBlock(err: string | undefined): SafeHtml {
  if (!err) return unsafeHtml('');
  return html`<div class="flash flash--error" style="margin-bottom: var(--space-3);">${err}</div>`;
}

function secretsSummary(count: number, status: SecretsStoreStatus, isUnlocked: boolean): string {
  if (!status.exists) return 'No store yet — set your first secret below to create one.';
  if (!isUnlocked) return 'Store is locked. Unlock to view names.';
  return `${count} secret${count === 1 ? '' : 's'} stored. Values are encrypted at rest; only names are shown here.`;
}

function formatModeLabel(status: SecretsStoreStatus): string {
  switch (status.mode) {
    case 'passphrase':
      return 'passphrase-protected (v2)';
    case 'hostname-obfuscated':
      return status.version === 1
        ? 'legacy v1 (hostname-obfuscated, not encrypted)'
        : 'hostname-obfuscated fallback (not real encryption)';
    case 'absent':
      return 'no store file yet';
  }
}

function modeBadgeFor(status: SecretsStoreStatus): SafeHtml {
  if (status.mode === 'passphrase') {
    return html`<span class="badge badge--ok">encrypted</span>`;
  }
  if (status.mode === 'hostname-obfuscated') {
    return html`<span class="badge badge--warn">fallback</span>`;
  }
  return html`<span class="badge badge--muted">absent</span>`;
}
