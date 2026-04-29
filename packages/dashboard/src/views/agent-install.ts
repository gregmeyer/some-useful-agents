import type { Agent } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export interface InstallFormState {
  /** Pasted URL, preserved across round-trips. */
  url?: string;
  /** Pasted auth header, preserved on validation errors. Never rendered after import. */
  authHeader?: string;
  /** Top-level error banner (parse / fetch / SSRF). */
  error?: string;
  /** Discovered agent for the preview step. */
  preview?: Agent;
  /** True if an agent with this id already exists in the store. */
  collision?: boolean;
  /** Existing version number, when there's a collision. */
  existingVersion?: number;
  /** Final URL actually fetched (post-normalization). */
  fetchedFrom?: string;
}

export interface InstallResultState {
  agent: Agent;
  upgraded: boolean;
  fetchedFrom: string;
}

/** Step 1 + 2: paste URL and (after fetch) preview the parsed agent. */
export function renderAgentInstall(state: InstallFormState): string {
  const body = html`
    ${pageHeader({
      title: 'Install agent from URL',
      description:
        'Paste a GitHub blob, gist, or raw HTTPS URL. The agent is fetched, validated, and saved as source=local — the installer takes ownership.',
      back: { href: '/agents', label: 'Back to agents' },
    })}

    ${state.error ? html`<div class="banner banner--err">${state.error}</div>` : html``}

    <form method="POST" action="/agents/install" class="card" style="padding: var(--space-4); margin-bottom: var(--space-4);">
      <input type="hidden" name="step" value="preview" />
      <div style="display: grid; gap: var(--space-3); max-width: 56rem;">
        <label>
          <span style="display:block; font-weight:var(--weight-bold);">Agent YAML URL</span>
          <input type="text" name="url" required value="${state.url ?? ''}"
            placeholder="https://github.com/some-org/sua-agents/blob/main/weekly-digest.yaml"
            style="width:100%; font-family:var(--font-mono);">
          <small class="dim">
            GitHub <code>/blob/</code> URLs are auto-rewritten to raw. Gist URLs map to <code>/raw</code>.
            Plain HTTPS passes through unchanged. Private/loopback IPs are blocked.
          </small>
        </label>
        <label>
          <span style="display:block; font-weight:var(--weight-bold);">Authorization header (optional)</span>
          <input type="text" name="authHeader" value="${state.authHeader ?? ''}"
            placeholder="Bearer ghp_..."
            style="width:100%; font-family:var(--font-mono);">
          <small class="dim">Sent only with this fetch. Never persisted.</small>
        </label>
        <div>
          <button type="submit" class="btn">Fetch &amp; preview</button>
        </div>
      </div>
    </form>

    ${state.preview ? renderPreview(state) : unsafeHtml('')}
  `;

  return render(layout({ title: 'Install agent', activeNav: 'agents' }, body));
}

function renderPreview(state: InstallFormState): SafeHtml {
  const a = state.preview!;
  const inputs = a.inputs ? Object.keys(a.inputs) : [];
  const secrets = collectSecrets(a);
  return html`
    <form method="POST" action="/agents/install" class="card" style="padding: var(--space-4);">
      <input type="hidden" name="step" value="confirm" />
      <input type="hidden" name="url" value="${state.url ?? ''}" />
      <input type="hidden" name="authHeader" value="${state.authHeader ?? ''}" />
      <h2 class="mono">${a.id}</h2>
      ${state.collision
        ? html`<div class="banner banner--warn">An agent with id <code>${a.id}</code> already exists at version ${String(state.existingVersion ?? '?')}. Confirming will create a new version.</div>`
        : html``}
      <p class="dim">${a.description ?? ''}</p>
      <dl style="display: grid; grid-template-columns: 12rem 1fr; gap: var(--space-2);">
        <dt class="dim">source (after install)</dt><dd class="mono">local</dd>
        <dt class="dim">nodes</dt><dd class="mono">${String(a.nodes.length)}</dd>
        <dt class="dim">inputs</dt><dd class="mono">${inputs.length > 0 ? inputs.join(', ') : '—'}</dd>
        <dt class="dim">secrets</dt><dd class="mono">${secrets.length > 0 ? secrets.join(', ') : '—'}</dd>
        <dt class="dim">mcp</dt><dd class="mono">${a.mcp ? 'exposed' : '—'}</dd>
        <dt class="dim">schedule</dt><dd class="mono">${a.schedule ?? '—'}</dd>
        <dt class="dim">fetched from</dt><dd class="mono">${state.fetchedFrom ?? state.url ?? ''}</dd>
      </dl>
      <div style="margin-top: var(--space-4); display:flex; gap: var(--space-3);">
        <button type="submit" class="btn">${state.collision ? 'Overwrite & install' : 'Confirm install'}</button>
        <a class="btn btn--ghost" href="/agents/install">Cancel</a>
      </div>
    </form>
  `;
}

function collectSecrets(a: Agent): string[] {
  const seen = new Set<string>();
  for (const n of a.nodes) {
    for (const s of n.secrets ?? []) seen.add(s);
  }
  return Array.from(seen).sort();
}

/** Step 3: post-install summary. */
export function renderAgentInstallResult(state: InstallResultState): string {
  const a = state.agent;
  const inputs = a.inputs ? Object.keys(a.inputs) : [];
  const secrets = collectSecrets(a);
  const body = html`
    ${pageHeader({
      title: state.upgraded ? 'Agent upgraded' : 'Agent installed',
      back: { href: '/agents', label: 'Back to agents' },
    })}
    <div class="banner banner--ok">
      ${state.upgraded ? 'Upgraded' : 'Installed'} <a class="mono" href="/agents/${a.id}">${a.id}</a>
      at version ${String(a.version)} from <span class="mono dim">${state.fetchedFrom}</span>.
    </div>
    ${inputs.length > 0 ? html`
      <section style="margin-top: var(--space-4);">
        <h2>Declared inputs</h2>
        <ul>${inputs.map((k) => html`<li class="mono">${k}</li>`) as unknown as SafeHtml[]}</ul>
        <p class="dim">Callers must supply these at run time.</p>
      </section>
    ` : html``}
    ${secrets.length > 0 ? html`
      <section style="margin-top: var(--space-4);">
        <h2>Declared secrets</h2>
        <ul>${secrets.map((k) => html`<li class="mono">${k}</li>`) as unknown as SafeHtml[]}</ul>
        <p class="dim">Set these on <a href="/settings/secrets">/settings/secrets</a> before running.</p>
      </section>
    ` : html``}
    ${a.schedule ? html`
      <section style="margin-top: var(--space-4);">
        <h2>Schedule</h2>
        <p class="mono">${a.schedule}</p>
        <p class="dim">Run <code>sua schedule start</code> to enable.</p>
      </section>
    ` : html``}
  `;
  return render(layout({ title: state.upgraded ? 'Agent upgraded' : 'Agent installed', activeNav: 'agents' }, body));
}
