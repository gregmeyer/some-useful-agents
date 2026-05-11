/**
 * Render a single dashboard at /dashboards/:id.
 *
 * Reuses the Pulse tile rendering machinery (renderTile + tileWrap)
 * so dashboards look identical to Pulse — the layout/sectioning is
 * the only thing that differs. The "Default Dashboard" backing
 * /pulse stays in routes/pulse.ts; this file is for named (pack or
 * user) dashboards that came from DashboardsStore.
 */

import type { Dashboard } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { renderTile } from './pulse-renderers.js';
import { tileWrap, type PulseTile } from './pulse.js';
import {
  buildDashboardOptions,
  renderDashboardsDropdown,
  type DashboardOption,
} from './dashboards-dropdown.js';
import { buildFromGoalButton, buildFromGoalModal } from './build-from-goal-modal.js';

export interface DashboardSectionRender {
  title: string;
  /** Tiles already built, in the order the section declares them. */
  tiles: PulseTile[];
  /** Agent ids referenced by the section that aren't installed (rendered as muted placeholders). */
  missingAgentIds: string[];
  /** Raw agentIds in the section — used to filter the add-tile picker. */
  agentIds: string[];
}

/**
 * One row of the in-place "+ Add tile" picker. Surfaced via a JSON
 * <script> tag so the modal can render without a server round-trip.
 */
export interface AvailableAgent {
  id: string;
  name: string;
  icon: string | null;
  template: string | null;
  description: string | null;
  /** ISO timestamp of the most recent run, or null if never fired. */
  lastFiredAt: string | null;
}

export interface RenderDashboardPageInput {
  dashboard: Dashboard;
  sections: DashboardSectionRender[];
  /** All installed dashboards, used to populate the dropdown. */
  installedDashboards: Dashboard[];
  /** Pool of signal-bearing agents for the in-place add-tile modal. */
  availableAgents: AvailableAgent[];
  flash?: { kind: 'ok' | 'error' | 'info'; message: string };
}

export function renderDashboardPage(input: RenderDashboardPageInput): string {
  const options: DashboardOption[] = buildDashboardOptions(input.installedDashboards);
  const activeHref = `/dashboards/${encodeURIComponent(input.dashboard.id)}`;
  const dropdown = renderDashboardsDropdown({ options, activeHref });

  const totalTiles = input.sections.reduce((n, s) => n + s.tiles.length, 0);
  const totalMissing = input.sections.reduce((n, s) => n + s.missingAgentIds.length, 0);

  const sourceLabel = input.dashboard.packId ? `from pack: ${input.dashboard.packId}` : 'user-created';

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4);">
      ${dropdown}
      <span class="dim" style="font-size: var(--font-size-sm);">
        ${String(totalTiles)} tile${totalTiles === 1 ? '' : 's'}
        ${totalMissing > 0 ? html`, ${String(totalMissing)} missing` : html``}
        · ${sourceLabel}
      </span>
      <div style="margin-left: auto; display: flex; gap: var(--space-2);">
        <button type="button" class="btn btn--primary btn--sm add-tile-btn"
          data-dashboard-id="${input.dashboard.id}"
          data-section-idx="0"
          data-section-agent-ids="${input.sections.flatMap((s) => s.agentIds).join(',')}"
          title="Add a tile to this dashboard">+ Add tile</button>
        <button type="button" class="btn btn--ghost btn--sm" id="dashboard-edit-toggle">✎ Edit layout</button>
        <a class="btn btn--ghost btn--sm" href="/dashboards/${encodeURIComponent(input.dashboard.id)}/edit">Edit sections</a>
        <a class="btn btn--ghost btn--sm" href="/dashboards/${encodeURIComponent(input.dashboard.id)}/export" title="Download as a pack manifest YAML">Save as pack</a>
      </div>
    </div>

    ${pageHeader({
      title: input.dashboard.name,
      back: { href: '/packs', label: 'All packs' },
    })}

    ${input.sections.length === 0
      ? html`<p class="dim" style="padding: var(--space-4); text-align: center;">No sections in this dashboard.</p>`
      : html`
        <div id="dashboard-containers" data-dashboard-id="${input.dashboard.id}">
          ${input.sections.map((s, idx) => renderSection(input.dashboard.id, s, idx)) as unknown as SafeHtml[]}
        </div>
        ${unsafeHtml(`<script type="application/json" id="dashboard-tile-data">${JSON.stringify({
          allTileIds: input.sections.flatMap((s) => s.tiles.map((t) => t.agent.id)),
          systemTileIds: [],
        })}</script>`)}
      `}
    ${unsafeHtml(`<script type="application/json" id="dashboard-available-agents">${
      JSON.stringify(input.availableAgents).replace(/</g, '\\u003c')
    }</script>`)}
    <span style="display: none;">${buildFromGoalButton()}</span>
    ${buildFromGoalModal()}
  `;

  return render(layout({
    title: `${input.dashboard.name} · Dashboards`,
    activeNav: 'pulse', // Dashboards live under the Pulse tab in nav
    flash: input.flash,
  }, body));
}

function renderSection(
  dashboardId: string,
  s: DashboardSectionRender,
  sectionIdx: number,
): SafeHtml {
  const isEmpty = s.tiles.length === 0 && s.missingAgentIds.length === 0;
  if (isEmpty) return html``;
  return html`
    <section class="pulse-container" data-container-id="section-${String(sectionIdx)}" style="margin-bottom: var(--space-5);">
      <h2 style="margin: 0 0 var(--space-3) 0; font-size: var(--font-size-md); font-weight: var(--weight-semibold);">${s.title}</h2>
      <div class="pulse-grid" data-container-id="section-${String(sectionIdx)}" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3);">
        ${s.tiles.map((t, tileIdx) =>
          renderTile(t, (tile, content) => tileWrap(tile, content, {
            kind: 'dashboard',
            dashboardId,
            sectionIdx,
            tileIdx,
          }))
        ) as unknown as SafeHtml[]}
        ${s.missingAgentIds.map((id) => html`
          <div class="card dim" style="padding: var(--space-3); border: 1px dashed var(--color-border-strong);">
            <div style="font-family: var(--font-mono); font-size: var(--font-size-sm);">${id}</div>
            <div style="font-size: var(--font-size-xs);">not installed — install the pack or remove from the dashboard</div>
          </div>
        `) as unknown as SafeHtml[]}
      </div>
    </section>
  `;
}
