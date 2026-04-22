/**
 * Home page: widget-based dashboard using the shared container layout.
 * System widgets provide the same data as the old hand-coded layout, but
 * rendered through the OutputWidget system with drag-drop containers.
 */

import type { Agent, Run, RunStatus } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { buildHomeWidgets, renderHomeWidget } from './home-widgets.js';
import type { HomeWidgetData } from './home-widgets.js';

export { type HomeWidgetData as HomePageInput } from './home-widgets.js';

export function renderHomePage(input: HomeWidgetData): string {
  const widgets = buildHomeWidgets(input);

  const allTileIds = widgets.map((w) => w.id);
  const systemTileIds = allTileIds.slice(); // all are system widgets

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
      <h1 style="margin: 0;">Dashboard</h1>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        ${String(input.agents.length)} agents registered
      </span>
      <div style="margin-left: auto; display: flex; gap: var(--space-2);">
        <button type="button" class="btn btn--ghost btn--sm" id="home-edit-toggle">\u270E Edit layout</button>
        <button type="button" class="btn btn--ghost btn--sm" id="home-add-container" style="display: none;">+ Add group</button>
      </div>
    </div>

    <div id="home-containers">
      <section class="pulse-container" data-container-id="_default">
        <div class="pulse-grid" data-container-id="_default">
          ${widgets.map((w) => renderHomeWidget(w)) as unknown as SafeHtml[]}
        </div>
      </section>
    </div>

    ${unsafeHtml(`<script type="application/json" id="home-widget-data">${JSON.stringify({ allTileIds, systemTileIds })}</script>`)}
  `;

  return render(layout({ title: 'Dashboard', activeNav: 'agents' }, body));
}
