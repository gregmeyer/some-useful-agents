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
import { buildFromGoalButton, buildFromGoalModal } from './build-from-goal-modal.js';
import { pageIntro } from './page-intro.js';

export { type HomeWidgetData as HomePageInput } from './home-widgets.js';

export function renderHomePage(input: HomeWidgetData): string {
  const widgets = buildHomeWidgets(input);

  const allTileIds = widgets.map((w) => w.id);
  const systemTileIds = allTileIds.slice(); // all are system widgets

  const isEmpty = input.agents.length === 0;

  const emptyState = html`
    <div class="settings-empty" style="margin-top: var(--space-4);">
      <h3 style="margin-top: 0;">No agents yet</h3>
      <p class="dim">An agent is a named task sua can run \u2014 a shell command, an LLM prompt, or a chain of both. Describe what you want and let sua build it, or follow the guided tour.</p>
      <p style="display: flex; gap: var(--space-3); justify-content: center; margin: 0;">
        ${buildFromGoalButton({ variant: 'primary' })}
        <a class="btn" href="/help/tutorial">Open tutorial</a>
      </p>
    </div>
  `;

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
      <h1 style="margin: 0;">Dashboard</h1>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        ${String(input.agents.length)} agents registered
      </span>
      <div style="margin-left: auto; display: flex; gap: var(--space-2);">
        ${buildFromGoalButton({ variant: 'primary' })}
        <a class="btn btn--ghost btn--sm" href="/packs">Browse packs</a>
        <button type="button" class="btn btn--ghost btn--sm" id="home-edit-toggle">\u270E Edit layout</button>
        <button type="button" class="btn btn--ghost btn--sm" id="home-add-container" style="display: none;">+ Add group</button>
      </div>
    </div>

    ${pageIntro({
      key: 'home',
      text: 'Your at-a-glance home. Stat tiles summarize recent runs and scheduled work; rearrange them with Edit layout.',
      learnMore: { href: 'https://github.com/gregmeyer/some-useful-agents/blob/main/docs/dashboard.md', label: 'Dashboard tour' },
    })}

    ${isEmpty ? emptyState : html``}

    <div id="home-containers">
      <section class="pulse-container" data-container-id="_default">
        <div class="pulse-grid" data-container-id="_default">
          ${widgets.map((w) => renderHomeWidget(w)) as unknown as SafeHtml[]}
        </div>
      </section>
    </div>

    ${unsafeHtml(`<script type="application/json" id="home-widget-data">${JSON.stringify({ allTileIds, systemTileIds })}</script>`)}

    ${buildFromGoalModal({ availableDashboards: input.availableDashboards })}
  `;

  return render(layout({ title: 'Dashboard', activeNav: 'agents' }, body));
}
