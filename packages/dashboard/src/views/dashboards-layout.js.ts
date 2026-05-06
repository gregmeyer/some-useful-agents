/**
 * Dashboards layout JS — gives /dashboards/:id parity with Pulse for
 * tile-level controls (configure, palette, resize, collapse, edit
 * toggle). Reuses the shared widgetLayoutJS factory; storage keys are
 * suffixed at runtime with the dashboard id so each dashboard owns
 * its own client-side state without compiling per-page JS.
 *
 * Server still owns section structure (sections + agentIds) — that's
 * edited via /dashboards/:id/edit. This module only handles the
 * cosmetic state Pulse already manages: palette, size, collapse.
 */

import { widgetLayoutJS } from './widget-layout.js.js';

export const DASHBOARDS_LAYOUT_JS = widgetLayoutJS({
  prefix: 'dashboard',
  storageKey: 'sua-dashboard-layout',
  hostId: 'dashboard-containers',
  dataId: 'dashboard-tile-data',
  editToggleId: 'dashboard-edit-toggle',
  addContainerId: 'dashboard-add-container', // intentionally absent in DOM; widget-layout no-ops
  paletteKey: 'sua-dashboard-palettes',
  sizesKey: 'sua-dashboard-sizes',
  collapsedKey: 'sua-dashboard-collapsed',
  runtimeKeySuffixAttr: 'data-dashboard-id',
}) + `
  // ── Dashboard tile collapse/expand ──────────────────────────────────
  // Mirrors the Pulse collapse handler. Lives here (not in pulse-layout)
  // because the storage key needs the runtime dashboard-id suffix.
  (function () {
    var host = document.getElementById('dashboard-containers');
    if (!host) return;
    var dashId = host.getAttribute('data-dashboard-id') || '';
    var STORAGE_KEY = 'sua-dashboard-collapsed' + (dashId ? '-' + dashId : '');

    function getCollapsed() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
    }
    function setCollapsed(map) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
    }

    var collapsed = getCollapsed();
    var tiles = host.querySelectorAll('.pulse-tile');
    for (var i = 0; i < tiles.length; i++) {
      var btn = tiles[i].querySelector('.pulse-tile__collapse');
      if (btn) {
        var id = btn.getAttribute('data-tile-id');
        if (id && collapsed[id]) tiles[i].classList.add('pulse-tile--collapsed');
      }
    }

    document.addEventListener('click', function (e) {
      var target = e.target;
      var tileId = null;
      if (target.classList && target.classList.contains('pulse-tile__collapse')) {
        tileId = target.getAttribute('data-tile-id');
      } else if (target.closest && target.closest('[data-collapse-trigger]')) {
        tileId = target.closest('[data-collapse-trigger]').getAttribute('data-tile-id');
      }
      if (!tileId) return;
      var tile = target.closest('.pulse-tile');
      if (!tile || !host.contains(tile)) return; // only act on dashboards-page tiles

      tile.classList.toggle('pulse-tile--collapsed');
      var map = getCollapsed();
      if (tile.classList.contains('pulse-tile--collapsed')) {
        map[tileId] = true;
      } else {
        delete map[tileId];
      }
      setCollapsed(map);
    });
  })();
`;
