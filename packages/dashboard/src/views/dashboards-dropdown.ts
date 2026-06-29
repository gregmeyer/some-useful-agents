/**
 * Shared dashboards dropdown — appears on the home board (/) and on
 * /dashboards/:id. Server-rendered <details>/<summary> menu (no JS) with the
 * active dashboard at the top and the others below as links.
 */

import type { Dashboard } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

export interface DashboardOption {
  /** Stable URL — '/' for the Default (home) board, '/dashboards/<id>' for installed packs. */
  href: string;
  label: string;
  /** Optional secondary label (e.g. pack id) shown muted. */
  hint?: string;
}

/**
 * Build the option list. Default Dashboard is always first; pack-owned
 * dashboards follow alphabetised by pack-id then dashboard name.
 */
export function buildDashboardOptions(installed: Dashboard[]): DashboardOption[] {
  const opts: DashboardOption[] = [
    { href: '/', label: 'Default Dashboard', hint: 'pulseVisible' },
  ];
  const sorted = [...installed].sort((a, b) => {
    const ap = a.packId ?? 'user';
    const bp = b.packId ?? 'user';
    if (ap !== bp) return ap.localeCompare(bp);
    return a.name.localeCompare(b.name);
  });
  for (const d of sorted) {
    opts.push({
      href: `/dashboards/${encodeURIComponent(d.id)}`,
      label: d.name,
      hint: d.packId ?? 'user',
    });
  }
  return opts;
}

/** Render the dropdown. `activeHref` matches one of the options' hrefs. */
export function renderDashboardsDropdown(args: {
  options: DashboardOption[];
  activeHref: string;
}): SafeHtml {
  const active = args.options.find((o) => o.href === args.activeHref) ?? args.options[0];
  return html`
    <details class="dashboards-dropdown" style="position: relative;">
      <summary style="list-style: none; cursor: pointer; padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); font-size: var(--font-size-sm); display: inline-flex; align-items: center; gap: var(--space-2); max-width: 18rem;">
        <span title="${active.label}" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${active.label}</span>
        <span style="font-size: var(--font-size-xs); opacity: 0.6; flex-shrink: 0;">▾</span>
      </summary>
      <div style="position: absolute; top: 100%; left: 0; margin-top: var(--space-1); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); box-shadow: 0 4px 12px rgba(0,0,0,0.15); min-width: 340px; max-width: 380px; z-index: 100; padding: var(--space-1); display: flex; flex-direction: column; gap: 1px;">
        ${args.options.map((o) => {
          const isActive = o.href === args.activeHref;
          const bg = isActive ? 'background: var(--color-surface);' : '';
          return html`
            <a href="${o.href}" style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); padding: var(--space-2) var(--space-3); text-decoration: none; color: inherit; border-radius: var(--radius-sm); ${bg}">
              <span title="${o.label}" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${o.label}</span>
              ${o.hint ? html`<span class="dim" style="font-size: var(--font-size-xs); white-space: nowrap; flex-shrink: 0;">${o.hint}</span>` : html``}
            </a>
          `;
        })}
        <form method="POST" action="/dashboards" style="display: flex; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--color-border); margin-top: var(--space-1); padding-top: var(--space-2);">
          <input type="text" name="name" placeholder="New dashboard name" required style="flex: 1; padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); font-size: var(--font-size-xs);">
          <button type="submit" class="btn btn--ghost btn--sm" style="font-size: var(--font-size-xs);">Create</button>
        </form>
        <a href="/packs" data-install-packs-open style="display: flex; padding: var(--space-2) var(--space-3); text-decoration: none; color: var(--color-text-muted); font-size: var(--font-size-sm);">
          + Install from Packs
        </a>
      </div>
    </details>
  `;
}
