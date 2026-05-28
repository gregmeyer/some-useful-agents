import { html, type SafeHtml } from './html.js';
import type { LlmProvider, LlmSettings } from '@some-useful-agents/core';

export interface SettingsLlmArgs {
  /** Current persisted settings, or undefined when the store isn't wired. */
  settings?: LlmSettings;
  /** Provider ids the runtime knows how to spawn. */
  providers: readonly LlmProvider[];
  /** Pass-through error string from a recent action (probe / save). */
  error?: string;
  /** Probe result: `name → { ok, message }`. Absent when probe hasn't run. */
  probe?: Record<LlmProvider, { ok: boolean; message: string }>;
  /** Pretty timestamp helper (last fallback "3 minutes ago"). */
  formatAge: (isoOrMs: number | string) => string;
}

const PROVIDER_LABEL: Record<LlmProvider, string> = {
  claude: 'Claude (claude CLI)',
  codex: 'Codex (codex CLI)',
};

export function renderSettingsLlm(args: SettingsLlmArgs): SafeHtml {
  if (!args.settings) {
    return html`
      <div class="settings-empty">
        <h3 class="mt-0">LLM settings unavailable</h3>
        <p class="dim">
          The dashboard was started without an <code>llmSettingsPath</code>.
          Restart with a recent sua build to enable provider configuration.
        </p>
      </div>
    `;
  }

  const errorBanner = args.error
    ? html`<div class="flash flash--error" style="margin-bottom: var(--space-3);">${args.error}</div>`
    : html``;

  const primaryOpts = args.providers.map((p) => html`
    <option value="${p}" ${args.settings!.primary === p ? 'selected' : ''}>${PROVIDER_LABEL[p] ?? p}</option>
  `);
  const fallbackOpts = args.providers.map((p) => html`
    <option value="${p}" ${args.settings!.fallback === p ? 'selected' : ''}>${PROVIDER_LABEL[p] ?? p}</option>
  `);

  const lastFallback = args.settings.lastFallback;
  const statusBlock = lastFallback
    ? html`
      <div class="settings-llm__status">
        <div class="settings-llm__status-label">Last fallback fired</div>
        <div>
          <code>${lastFallback.primary}</code> → <code>${lastFallback.fallback}</code>
          (${lastFallback.reason})
          · ${args.formatAge(lastFallback.at)}
          ${lastFallback.agentId ? html` · agent <code>${lastFallback.agentId}</code>` : html``}
          ${lastFallback.nodeId ? html` · node <code>${lastFallback.nodeId}</code>` : html``}
        </div>
        <form method="POST" action="/settings/llm/clear-last-fallback" style="margin-top: var(--space-2);">
          <button type="submit" class="btn btn--xs btn--ghost">Clear this notice</button>
        </form>
      </div>
    `
    : html`
      <div class="settings-llm__status settings-llm__status--clean">
        <div class="settings-llm__status-label">No fallback recorded</div>
        <div class="dim">The primary provider hasn't failed in a fallback-worthy way since records started.</div>
      </div>
    `;

  const probeBlock = args.probe
    ? html`
      <div class="settings-llm__probe">
        ${(Object.entries(args.probe) as [LlmProvider, { ok: boolean; message: string }][]).map(([p, r]) => html`
          <div class="settings-llm__probe-row settings-llm__probe-row--${r.ok ? 'ok' : 'fail'}">
            <span class="mono">${p}</span>
            <span class="settings-llm__probe-status">${r.ok ? 'reachable' : 'failed'}</span>
            <span class="dim">${r.message}</span>
          </div>
        `) as unknown as SafeHtml[]}
      </div>
    `
    : html``;

  return html`
    <section class="settings-section">
      <h2 class="mt-0">LLM provider</h2>
      <p class="dim">
        Pick the primary CLI that every <code>llm-prompt</code> node calls into.
        When configured, the fallback kicks in only on recognized credit /
        quota / binary-missing / timeout failures — transient errors like rate
        limits stay on the primary and retry there.
      </p>

      ${errorBanner}

      <form method="POST" action="/settings/llm" class="settings-llm__form">
        <div class="settings-llm__field">
          <label for="llm-primary">Primary</label>
          <select id="llm-primary" name="primary" class="form-field">
            ${primaryOpts as unknown as SafeHtml[]}
          </select>
        </div>
        <div class="settings-llm__field">
          <label for="llm-fallback">Fallback</label>
          <select id="llm-fallback" name="fallback" class="form-field">
            <option value="">(no fallback)</option>
            ${fallbackOpts as unknown as SafeHtml[]}
          </select>
          <p class="dim" style="font-size: var(--font-size-xs); margin: 4px 0 0;">
            Must differ from primary. Leave blank to disable automatic
            switching.
          </p>
        </div>
        <div class="settings-llm__actions">
          <button type="submit" class="btn btn--primary">Save</button>
          <button type="submit" formaction="/settings/llm/probe" class="btn btn--ghost">Probe CLIs</button>
        </div>
      </form>

      ${probeBlock}
      ${statusBlock}
    </section>
  `;
}
