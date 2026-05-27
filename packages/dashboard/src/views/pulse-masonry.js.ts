/**
 * Pulse masonry packer.
 *
 * Pulse + named dashboards declare a CSS grid with `grid-auto-rows: 8px`
 * and `grid-auto-flow: dense`. Each tile's `grid-row: span N` is computed
 * here from its rendered height so a 200px tile occupies ~25 row-units
 * while a 1115px tile occupies ~140. The row-major default would lock
 * every row's height to its tallest tile, turning the space below
 * shorter tiles into voids that belong to the short tile's own grid
 * cell — undrop-targetable and untunable. With per-tile row-spans + the
 * `dense` auto-flow, columns pack independently and short tiles don't
 * trap unusable space.
 *
 * Re-pack triggers:
 *  - DOMContentLoaded (initial render)
 *  - ResizeObserver per tile (content height changes — image load, widget
 *    expand, "Run now" re-render that swaps the body, etc.)
 *  - Window resize (column width changes → tile content may reflow taller)
 *  - MutationObserver on `.pulse-grid` (tiles added/removed via drag-drop
 *    or planner Apply)
 *
 * Coordinates with widget-layout.js.ts: that module owns `grid-column`
 * + inline `height` for user-resized tiles. We own `grid-row`. The two
 * never conflict — height changes from widget-layout fire ResizeObserver
 * which re-snaps our row-span.
 */

export const PULSE_MASONRY_JS = `
(function () {
  var ROW_UNIT = 8;

  function packGrid(grid) {
    if (!grid) return;
    var cs = window.getComputedStyle(grid);
    var rowGap = parseInt(cs.rowGap || cs.gap || '16', 10) || 16;
    var tiles = grid.querySelectorAll('.pulse-tile');
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var h = t.getBoundingClientRect().height;
      if (h <= 0) continue;
      var span = Math.max(1, Math.ceil((h + rowGap) / (ROW_UNIT + rowGap)));
      t.style.gridRow = 'span ' + span;
    }
  }

  function packAll() {
    var grids = document.querySelectorAll('.pulse-grid');
    for (var i = 0; i < grids.length; i++) packGrid(grids[i]);
  }

  var rafQueued = false;
  function schedulePack() {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(function () {
      rafQueued = false;
      packAll();
    });
  }

  var ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(function () { schedulePack(); });
  }

  function observeTiles() {
    if (!ro) return;
    var tiles = document.querySelectorAll('.pulse-tile');
    for (var i = 0; i < tiles.length; i++) ro.observe(tiles[i]);
  }

  var mo = new MutationObserver(function (mutations) {
    var dirty = false;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
        dirty = true;
        break;
      }
    }
    if (dirty) {
      observeTiles();
      schedulePack();
    }
  });

  function start() {
    var grids = document.querySelectorAll('.pulse-grid');
    for (var i = 0; i < grids.length; i++) {
      mo.observe(grids[i], { childList: true, subtree: true });
    }
    observeTiles();
    schedulePack();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.addEventListener('resize', schedulePack);

  window.suaPackPulseGrid = packAll;
})();
`;
