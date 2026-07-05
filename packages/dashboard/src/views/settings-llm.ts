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

// Keyed by string (not LlmProvider) because the waterfall can now hold custom
// provider names too; unknown ids fall through to '' via the ?? at the call site.
const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude (claude CLI)',
  codex: 'Codex (codex CLI)',
  'apple-foundation-models': 'Apple Foundation Models (on-device)',
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

  const chain = args.settings.providers;
  const chainSet = new Set(chain);
  const available = args.providers.filter((p) => !chainSet.has(p));

  // Each row is its own tiny form. Up/Down/Remove submit to specific
  // mutation routes so the operator sees exactly what changed; the
  // alternative — one big "edit list" form with hidden serialization
  // — was harder to reason about and made the URL state non-shareable.
  const rows = chain.map((p, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === chain.length - 1;
    const isOnly = chain.length === 1;
    return html`
      <li class="settings-llm__chain-row" data-provider="${p}">
        <span class="settings-llm__chain-rank">${idx + 1}</span>
        <span class="settings-llm__chain-label">
          <span class="mono">${p}</span>
          <span class="dim">${PROVIDER_LABEL[p] ?? ''}</span>
        </span>
        ${isFirst ? html`<span class="badge badge--ok">Primary</span>` : html`<span class="dim" style="font-size: var(--font-size-xs);">Fallback</span>`}
        <div class="settings-llm__chain-actions">
          <form method="POST" action="/settings/llm/move" style="display:inline;">
            <input type="hidden" name="provider" value="${p}">
            <input type="hidden" name="direction" value="up">
            <button type="submit" class="btn btn--xs btn--ghost" ${isFirst ? 'disabled' : ''} aria-label="Move ${p} up">↑</button>
          </form>
          <form method="POST" action="/settings/llm/move" style="display:inline;">
            <input type="hidden" name="provider" value="${p}">
            <input type="hidden" name="direction" value="down">
            <button type="submit" class="btn btn--xs btn--ghost" ${isLast ? 'disabled' : ''} aria-label="Move ${p} down">↓</button>
          </form>
          <form method="POST" action="/settings/llm/remove" style="display:inline;">
            <input type="hidden" name="provider" value="${p}">
            <button type="submit" class="btn btn--xs btn--ghost" ${isOnly ? 'disabled' : ''} title="${isOnly ? 'Cannot remove the last provider.' : ''}">Remove</button>
          </form>
        </div>
      </li>
    `;
  });

  const addBlock = available.length === 0
    ? html`<p class="dim" style="font-size: var(--font-size-sm); margin: var(--space-2) 0 0;">All known providers are already in the chain.</p>`
    : html`
      <form method="POST" action="/settings/llm/add" class="settings-llm__add">
        <label for="llm-add" class="dim">Add provider</label>
        <select id="llm-add" name="provider" class="form-field" style="max-width: 220px;">
          ${available.map((p) => html`<option value="${p}">${PROVIDER_LABEL[p] ?? p}</option>`) as unknown as SafeHtml[]}
        </select>
        <button type="submit" class="btn btn--sm">Add</button>
      </form>
    `;

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
        <div class="dim">No provider in the chain has fallen over in a fallback-worthy way since records started.</div>
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
      <h2 class="mt-0">LLM provider waterfall</h2>
      <p class="dim">
        An ordered chain of LLM providers. The first entry is the
        <strong>primary</strong> — every <code>llm-prompt</code> node calls
        into it by default. On recognized failures (binary missing,
        timeout, quota / credit exhausted, auth required, or rate
        limited) the runtime walks the rest of the chain in order
        until one succeeds. Unclassified errors stay on the same
        provider so real bugs surface instead of being masked.
      </p>
      <p class="dim">
        When an agent or node pins its own provider, that provider runs
        first regardless of the chain order — and the remaining providers
        still apply as fallbacks. (Previously a pin disabled all fallback.)
      </p>

      ${errorBanner}

      <ol class="settings-llm__chain">
        ${rows as unknown as SafeHtml[]}
      </ol>

      ${addBlock}

      <div class="settings-llm__actions" style="margin-top: var(--space-3);">
        <form method="POST" action="/settings/llm/probe" style="display:inline;">
          <button type="submit" class="btn btn--ghost">Probe CLIs</button>
        </form>
      </div>

      ${probeBlock}
      ${statusBlock}
    </section>
  `;
}
