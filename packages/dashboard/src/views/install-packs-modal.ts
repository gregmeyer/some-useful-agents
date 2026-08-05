/**
 * "Install from Packs" modal, opened from the dashboards dropdown on /pulse.
 *
 * Server-rendered (hidden until JS adds `.is-open`) so installing a pack
 * doesn't bounce the user off Pulse to the /packs page. Each available pack
 * has an Install form that POSTs to /packs/:id/install with returnTo=/pulse,
 * so the daemon redirects back here with a flash. Falls back to the /packs
 * page when JS is unavailable (the dropdown link keeps its href).
 */

import type { Pack } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

export function renderInstallPacksModal(availablePacks: Pack[]): SafeHtml {
  const card = (p: Pack): SafeHtml => {
    const dashboardCount = p.manifest.dashboards?.length ?? 0;
    const agentCount = p.manifest.agents?.length ?? 0;
    return html`
      <div class="install-packs__row">
        <div style="min-width: 0;">
          <div style="display: flex; align-items: baseline; gap: var(--space-2);">
            <span style="font-weight: var(--weight-semibold);">${p.name}</span>
            <span class="dim" style="font-size: var(--font-size-xs);">v${p.version}</span>
          </div>
          ${p.description
            ? html`<p style="margin: var(--space-1) 0 0 0; color: var(--color-text-muted); font-size: var(--font-size-sm); line-height: 1.4;">${p.description}</p>`
            : html``}
          <div class="dim" style="font-size: var(--font-size-xs); margin-top: var(--space-1);">
            ${String(dashboardCount)} dashboard${dashboardCount === 1 ? '' : 's'} ·
            ${String(agentCount)} agent${agentCount === 1 ? '' : 's'} · ${p.source}
          </div>
        </div>
        <form method="POST" action="/packs/${encodeURIComponent(p.id)}/install" style="margin: 0; flex-shrink: 0;">
          <input type="hidden" name="returnTo" value="/pulse">
          <button type="submit" class="btn btn--primary btn--sm">Install</button>
        </form>
      </div>
    `;
  };

  const body = availablePacks.length === 0
    ? html`<p class="dim" style="padding: var(--space-3) 0;">All registered packs are installed.</p>`
    : html`<div class="install-packs__list">${availablePacks.map(card) as unknown as SafeHtml[]}</div>`;

  return html`
    <div class="modal-backdrop" id="install-packs-modal" role="dialog" aria-modal="true" aria-labelledby="install-packs-title">
      <div class="modal" style="max-width: 36rem;">
        <h3 id="install-packs-title" style="margin: 0; color: var(--color-text);">Install from Packs</h3>
        <p class="dim" style="margin: var(--space-1) 0 var(--space-4) 0; font-size: var(--font-size-sm);">
          Installing a pack registers its dashboards and any contributed agents. You'll stay on Pulse.
        </p>
        ${body}
        <div class="modal__actions" style="justify-content: space-between; align-items: center;">
          <a href="/packs" style="font-size: var(--font-size-sm);">Browse all packs →</a>
          <button type="button" class="btn btn--ghost" data-install-packs-close>Close</button>
        </div>
      </div>
    </div>
  `;
}
