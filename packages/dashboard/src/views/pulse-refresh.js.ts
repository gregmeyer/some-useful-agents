/**
 * Pulse auto-refresh: polls tile fragment endpoints at each tile's
 * declared refresh interval and replaces the tile's innerHTML.
 */
export const PULSE_REFRESH_JS = `
  (function () {
    var REFRESH_INTERVALS = {
      '5m': 300000,
      '10m': 600000,
      '15m': 900000,
      '30m': 1800000,
      '1h': 3600000,
      '2h': 7200000,
      '4h': 14400000,
      '12h': 43200000,
      '24h': 86400000,
    };

    function parseRefresh(val) {
      if (!val) return 0;
      val = val.trim().toLowerCase();
      if (REFRESH_INTERVALS[val]) return REFRESH_INTERVALS[val];
      // Parse Nm or Nh patterns.
      var match = val.match(/^(\\d+)(m|h|s)$/);
      if (match) {
        var n = parseInt(match[1], 10);
        if (match[2] === 's') return n * 1000;
        if (match[2] === 'm') return n * 60000;
        if (match[2] === 'h') return n * 3600000;
      }
      return 0;
    }

    function scheduleRefresh(tile) {
      var agentId = tile.getAttribute('data-agent-id');
      if (!agentId) return;

      var header = tile.querySelector('.pulse-tile__header');
      if (!header) return;

      var config = {};
      try { config = JSON.parse(header.getAttribute('data-signal-config') || '{}'); } catch {}
      var interval = parseRefresh(config.refresh);
      if (interval < 30000) return; // Don't poll faster than 30s.

      setTimeout(function refresh() {
        tile.style.opacity = '0.7';
        fetch('/pulse/tile/' + encodeURIComponent(agentId))
          .then(function (r) { return r.ok ? r.text() : null; })
          .then(function (html) {
            if (html) {
              // Create a temp container, parse the fragment, and replace the tile.
              var temp = document.createElement('div');
              temp.innerHTML = html;
              var newTile = temp.firstElementChild;
              if (newTile && tile.parentNode) {
                // Preserve layout state (palette, collapsed, size).
                var palette = tile.getAttribute('data-palette');
                if (palette) newTile.setAttribute('data-palette', palette);
                if (tile.classList.contains('pulse-tile--collapsed')) newTile.classList.add('pulse-tile--collapsed');
                var gridCol = tile.style.gridColumn;
                var gridRow = tile.style.gridRow;
                if (gridCol) newTile.style.gridColumn = gridCol;
                if (gridRow) newTile.style.gridRow = gridRow;

                tile.parentNode.replaceChild(newTile, tile);
                tile = newTile;
                // Re-schedule on the new tile element.
                scheduleRefresh(tile);
              }
            } else {
              tile.style.opacity = '1';
              setTimeout(refresh, interval);
            }
          })
          .catch(function () {
            tile.style.opacity = '1';
            setTimeout(refresh, interval);
          });
      }, interval);
    }

    // Schedule refresh for all tiles with a refresh interval.
    var tiles = document.querySelectorAll('.pulse-tile[data-agent-id]');
    for (var i = 0; i < tiles.length; i++) {
      scheduleRefresh(tiles[i]);
    }
  })();
`;
