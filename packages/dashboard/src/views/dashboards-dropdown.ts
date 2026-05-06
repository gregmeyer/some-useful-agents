/**
 * Shared dashboards dropdown — appears on /pulse and on /dashboards/:id.
 * Server-rendered <details>/<summary> menu (no JS) with the active
 * dashboard at the top and the others below as links.
 */

import type { Dashboard } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

export interface DashboardOption {
  /** Stable URL — '/pulse' for Default, '/dashboards/<id>' for installed packs. */
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
    { href: '/pulse', label: 'Default Dashboard', hint: 'pulseVisible' },
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
      <summary style="list-style: none; cursor: pointer; padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); font-size: var(--font-size-sm); display: inline-flex; align-items: center; gap: var(--space-2);">
        <span>${active.label}</span>
        <span style="font-size: var(--font-size-xs); opacity: 0.6;">▾</span>
      </summary>
      <div style="position: absolute; top: 100%; left: 0; margin-top: var(--space-1); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); box-shadow: 0 4px 12px rgba(0,0,0,0.15); min-width: 220px; z-index: 100; padding: var(--space-1); display: flex; flex-direction: column; gap: 1px;">
        ${args.options.map((o) => {
          const isActive = o.href === args.activeHref;
          const bg = isActive ? 'background: var(--color-surface);' : '';
          return html`
            <a href="${o.href}" style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); padding: var(--space-2) var(--space-3); text-decoration: none; color: inherit; border-radius: var(--radius-sm); ${bg}">
              <span>${o.label}</span>
              ${o.hint ? html`<span class="dim" style="font-size: var(--font-size-xs);">${o.hint}</span>` : html``}
            </a>
          `;
        })}
        <a href="/packs" style="display: flex; padding: var(--space-2) var(--space-3); text-decoration: none; color: var(--color-text-muted); font-size: var(--font-size-sm); border-top: 1px solid var(--color-border); margin-top: var(--space-1); padding-top: var(--space-2);">
          + Install more from Packs
        </a>
      </div>
    </details>
  `;
}
