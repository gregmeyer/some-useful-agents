/**
 * Pulse page layout: types, tile chrome (header/footer/wrapper),
 * auto-palette resolution, and the page renderer.
 *
 * Template renderers live in pulse-renderers.ts.
 * Helpers (markdown, stringify, etc.) live in pulse-helpers.ts.
 * Template registry + extraction live in pulse-templates.ts.
 */

import type { Agent, AgentSignal, Run, SignalTemplate } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { formatAge } from './components.js';
import { normalizeSignal, TEMPLATE_REGISTRY } from './pulse-templates.js';
import { esc } from './pulse-helpers.js';
import { renderTile } from './pulse-renderers.js';
import { buildDashboardOptions, renderDashboardsDropdown } from './dashboards-dropdown.js';
import { renderInstallPacksModal } from './install-packs-modal.js';
import { improveLayoutButton, improveLayoutModal } from './improve-layout-modal.js';
import { pageIntro } from './page-intro.js';
export type { PulseTile, PulsePageInput, TileWrapFn } from './pulse-types.js';
import type { PulseTile, PulsePageInput, TileWrapFn } from './pulse-types.js';

// ── Tile chrome ──────────────────────────────────────────────────────────

/**
 * Surface where a tile is being rendered. Determines what the tile's
 * × button does — on Pulse it toggles the agent's pulseVisible flag;
 * on a dashboard it removes the tile from that specific dashboard's
 * section without touching pulseVisible.
 */
export type TileWrapContext =
  | { kind: 'pulse' }
  | { kind: 'dashboard'; dashboardId: string; sectionIdx: number; tileIdx: number };

/** Wraps tile content with header, footer, resize handle, and data attributes. */
export function tileWrap(
  tile: PulseTile,
  content: SafeHtml,
  ctx: TileWrapContext = { kind: 'pulse' },
): SafeHtml {
  const isSystem = tile.agent.id.startsWith('_system-');
  const sizeAttr = tile.signal.size ?? '1x1';
  const autoPalette = resolveAutoPalette(tile);
  const paletteAttr = autoPalette && autoPalette !== 'default'
    ? ` data-auto-palette="${autoPalette}"`
    : '';
  const accentAttr = tile.signal.accent
    ? ` data-accent="${esc(tile.signal.accent)}"`
    : '';
  // Tile chrome (header + footer) sits *outside* the scrolling body so
  // long content (notably interactive-widget forms whose stacked panes
  // dominate the grid cell height) can't push the agent link below the
  // visible bottom edge. The `pulse-tile__body` wrapper is the same
  // class the home widgets already use; the CSS lets it `flex: 1` and
  // own the overflow.
  // Tile fit: how a widget taller than its slot behaves. Width is always the
  // dashboard-defined grid column; tileFit only controls height.
  //   `grow` (default) — the tile grows vertically to the widget's height.
  //   `scroll` — cap the tile height and scroll the overflow.
  const fit = tile.agent.outputWidget ? (tile.agent.outputWidget.tileFit ?? 'grow') : null;
  const fitClass = fit ? ` pulse-tile--fit-${fit}` : '';

  return unsafeHtml(
    `<div class="pulse-tile ${sizeClass(sizeAttr)}${fitClass}" data-agent-id="${esc(tile.agent.id)}" data-tile-size="${esc(sizeAttr)}"${paletteAttr}${accentAttr}>` +
    tileHeader(tile, isSystem, ctx).toString() +
    `<div class="pulse-tile__body">` +
    content.toString() +
    `</div>` +
    (isSystem ? '' : tileFooter(tile).toString()) +
    '<div class="pulse-tile__resize-handle" data-agent-id="' + esc(tile.agent.id) + '"></div>' +
    '</div>'
  );
}

function resolveAutoPalette(tile: PulseTile): string | null {
  const { template } = normalizeSignal(tile.signal);

  if (tile.signal.thresholds && tile.signal.thresholds.length > 0) {
    const numVal = Number(tile.slots.value);
    if (!isNaN(numVal)) {
      for (const t of tile.signal.thresholds) {
        if (t.above !== undefined && numVal > t.above) return t.palette;
        if (t.below !== undefined && numVal < t.below) return t.palette;
      }
    }
  }

  if (template === 'status') {
    const status = tile.slots.status ? String(tile.slots.status).toLowerCase() : '';
    if (status === 'healthy' || status === 'ok' || status === 'up') return 'accent-green';
    if (status === 'degraded' || status === 'warn' || status === 'warning') return 'accent-orange';
    if (status === 'down' || status === 'error' || status === 'critical') return 'accent-red';
  }

  if (template === 'metric') return 'accent-teal';
  return null;
}

function sizeClass(size: string): string {
  if (size === '2x1') return 'pulse-tile--2x1';
  if (size === '1x2') return 'pulse-tile--1x2';
  if (size === '2x2') return 'pulse-tile--2x2';
  return '';
}

function tileHeader(tile: PulseTile, isSystem: boolean, ctx: TileWrapContext): SafeHtml {
  const icon = tile.signal.icon ?? '';
  const { template, mapping } = normalizeSignal(tile.signal);
  // Embed signal config as data attributes for the configure modal JS.
  const signalData = JSON.stringify({
    template,
    mapping,
    title: tile.signal.title,
    icon: tile.signal.icon ?? '',
    size: tile.signal.size ?? '1x1',
    accent: tile.signal.accent ?? '',
    refresh: tile.signal.refresh ?? '',
  });
  const outputFieldsJson = JSON.stringify(tile.outputFields ?? []);

  return html`
    <div class="pulse-tile__header"
      data-signal-config="${signalData}"
      data-output-fields="${outputFieldsJson}">
      <button type="button" class="pulse-tile__collapse" data-tile-id="${tile.agent.id}" title="Collapse/expand">\u25BC</button>
      <div style="display: flex; align-items: center; gap: var(--space-2); flex: 1; cursor: pointer;" data-tile-id="${tile.agent.id}" data-collapse-trigger>
        ${icon ? html`<span class="pulse-tile__icon">${icon}</span>` : html``}
        <span class="pulse-tile__title">${tile.signal.title}</span>
      </div>
      <div style="display: flex; gap: var(--space-1); align-items: center;">
        ${isSystem ? html`` : html`
          <button type="button" class="pulse-tile__configure-btn" data-tile-id="${tile.agent.id}" title="Configure tile">\u2699</button>
        `}
        <button type="button" class="pulse-tile__palette-btn" data-tile-id="${tile.agent.id}" title="Change palette">\u25CF</button>
        ${isSystem ? html`` : (ctx.kind === 'dashboard'
          ? html`
              <form method="POST" action="/dashboards/${encodeURIComponent(ctx.dashboardId)}/sections/${String(ctx.sectionIdx)}/tiles/${String(ctx.tileIdx)}/delete" style="margin: 0;" data-confirm-modal="Remove ${tile.signal.title} from this dashboard? You can add it back later from the Add tile button." data-confirm-label="Remove" data-confirm-title="Remove tile?">
                <input type="hidden" name="returnTo" value="dashboard">
                <button type="submit" class="pulse-tile__toggle" title="Remove from this dashboard">\u00D7</button>
              </form>
            `
          : html`
              <form method="POST" action="/agents/${tile.agent.id}/signal/toggle" style="margin: 0;" data-confirm-modal="Hide ${tile.signal.title} from Pulse? You can restore it from the hidden signals section below the grid." data-confirm-label="Hide" data-confirm-title="Hide tile?">
                <button type="submit" class="pulse-tile__toggle" title="Hide from Pulse">\u00D7</button>
              </form>
            `)}
      </div>
    </div>
  `;
}

function tileFooter(tile: PulseTile): SafeHtml {
  const agentLink = `/agents/${tile.agent.id}`;
  const runLink = tile.lastRun ? `/runs/${tile.lastRun.id}` : '';
  const age = tile.lastRun ? formatAge(tile.lastRun.completedAt ?? tile.lastRun.startedAt) : 'never';
  return html`
    <div class="pulse-tile__footer">
      <a href="${agentLink}" class="pulse-tile__agent">${tile.agent.id}</a>
      ${runLink
        ? html`<a href="${runLink}" class="pulse-tile__age">${age}</a>`
        : html`<span class="pulse-tile__age">${age}</span>`}
    </div>
  `;
}

// ── Page ─────────────────────────────────────────────────────────────────

export function renderPulsePage(input: PulsePageInput): string {
  const { systemTiles, tiles, hiddenTiles } = input;
  const allTileCount = systemTiles.length + tiles.length;
  const agentTileCount = tiles.length;
  const systemTileCount = systemTiles.length;
  const hiddenCount = hiddenTiles.length;

  const allTileIds = [...systemTiles.map((t) => t.agent.id), ...tiles.map((t) => t.agent.id)];
  const systemTileIds = systemTiles.map((t) => t.agent.id);

  const doRenderTile = (tile: PulseTile) => renderTile(tile, tileWrap);

  const dropdownOptions = buildDashboardOptions(input.installedDashboards ?? []);
  // Only render the dropdown when there's more than just the Default
  // entry — otherwise it's noise.
  const dropdown = dropdownOptions.length > 1
    ? renderDashboardsDropdown({ options: dropdownOptions, activeHref: '/pulse' })
    : html``;

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
      <h1 style="margin: 0;">Pulse</h1>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        ${String(agentTileCount)} agent${agentTileCount !== 1 ? 's' : ''}${systemTileCount > 0 ? html` + ${String(systemTileCount)} system` : html``}${hiddenCount > 0 ? html` · ${String(hiddenCount)} hidden` : html``}
      </span>
      <div style="margin-left: auto; display: flex; align-items: center; gap: var(--space-2);">
        ${dropdownOptions.length > 1 ? dropdown : html``}
        ${tiles.length > 0 ? html`
          <form method="POST" action="/pulse/hide-all" style="margin: 0; display: inline;" onsubmit="return confirm('Hide all ${String(tiles.length)} signal${tiles.length !== 1 ? 's' : ''} from Pulse? They\\'ll move to the hidden section and can be restored individually.');">
            <button type="submit" class="btn btn--ghost btn--sm" title="Move every visible tile to the hidden section. Useful before installing packs.">Hide all</button>
          </form>
        ` : html``}
        ${hiddenCount > 0 && tiles.length === 0 ? html`
          <form method="POST" action="/pulse/show-all" style="margin: 0; display: inline;">
            <button type="submit" class="btn btn--ghost btn--sm">Show all</button>
          </form>
        ` : html``}
        ${improveLayoutButton()}
        <button type="button" class="btn btn--ghost btn--sm" id="pulse-edit-toggle">\u270E Edit layout</button>
        <button type="button" class="btn btn--ghost btn--sm" id="pulse-add-container" style="display: none;">+ Add group</button>
      </div>
    </div>

    ${pageIntro({
      key: 'pulse',
      text: 'Pulse is your live information radiator — each tile shows an agent\'s latest output. Drag to reorder, or use Improve layout to curate what shows.',
      learnMore: { href: 'https://github.com/gregmeyer/some-useful-agents/blob/main/docs/dashboard.md', label: 'Dashboard tour' },
    })}

    <div id="pulse-containers">
      <section class="pulse-container" data-container-id="_default">
        <div class="pulse-grid" data-container-id="_default">
          ${systemTiles.map(doRenderTile) as unknown as SafeHtml[]}
          ${tiles.map(doRenderTile) as unknown as SafeHtml[]}
        </div>
      </section>
    </div>

    ${hiddenCount > 0 ? html`
      <div class="pulse-hidden-section" style="margin-top: var(--space-6); display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--color-border); font-size: var(--font-size-xs); color: var(--color-text-muted);">
        <span>${String(hiddenCount)} signal${hiddenCount !== 1 ? 's' : ''} hidden from Pulse.</span>
        <form method="POST" action="/pulse/show-all" style="margin: 0; display: inline;">
          <button type="submit" class="btn btn--ghost btn--sm">Show all</button>
        </form>
        <a class="btn btn--ghost btn--sm" href="/agents">Manage in /agents</a>
      </div>
    ` : html``}

    ${improveLayoutModal()}

    ${dropdownOptions.length > 1 ? renderInstallPacksModal(input.availablePacks ?? []) : html``}

    ${unsafeHtml(`<script type="application/json" id="pulse-tile-data">${JSON.stringify({ allTileIds, systemTileIds })}</script>`)}
    ${unsafeHtml(`<script type="application/json" id="pulse-template-registry">${JSON.stringify(TEMPLATE_REGISTRY)}</script>`)}
  `;

  return render(layout({ title: 'Pulse', activeNav: 'pulse', flash: input.flash }, body));
}
