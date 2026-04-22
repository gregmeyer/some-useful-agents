/**
 * Pulse layout JS: thin wrapper around the shared widget layout,
 * plus Pulse-specific collapse/expand and YouTube embed IIFEs.
 */
import { widgetLayoutJS } from './widget-layout.js.js';

export const PULSE_LAYOUT_JS = widgetLayoutJS({
  prefix: 'pulse',
  storageKey: 'sua-pulse-layout',
  hostId: 'pulse-containers',
  dataId: 'pulse-tile-data',
  editToggleId: 'pulse-edit-toggle',
  addContainerId: 'pulse-add-container',
  protectedPrefixes: ['_system-'],
  paletteKey: 'sua-pulse-palettes',
  sizesKey: 'sua-pulse-sizes',
  collapsedKey: 'sua-pulse-collapsed',
}) + `
  // ── Pulse tile collapse/expand ──────────────────────────────────────
  // Clicking the chevron or header title toggles the tile body.
  // Collapsed state persists in localStorage per agent id.
  (function () {
    var STORAGE_KEY = 'sua-pulse-collapsed';
    function getCollapsed() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
    }
    function setCollapsed(map) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
    }

    // Restore collapsed state on load.
    var collapsed = getCollapsed();
    var tiles = document.querySelectorAll('.pulse-tile');
    for (var i = 0; i < tiles.length; i++) {
      var btn = tiles[i].querySelector('.pulse-tile__collapse');
      if (btn) {
        var id = btn.getAttribute('data-tile-id');
        if (id && collapsed[id]) tiles[i].classList.add('pulse-tile--collapsed');
      }
    }

    // Toggle on click.
    document.addEventListener('click', function (e) {
      var target = e.target;
      // Check if click is on the collapse button or the header trigger area.
      var tileId = null;
      if (target.classList && target.classList.contains('pulse-tile__collapse')) {
        tileId = target.getAttribute('data-tile-id');
      } else if (target.closest && target.closest('[data-collapse-trigger]')) {
        tileId = target.closest('[data-collapse-trigger]').getAttribute('data-tile-id');
      }
      if (!tileId) return;

      // Find the parent tile.
      var tile = target.closest('.pulse-tile');
      if (!tile) return;

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

  // ── Pulse media: click-to-play YouTube embeds ───────────────────────
  // Click thumbnail to swap to iframe embed. If embed fails (video
  // disallows embedding), show a "blocked" message with link.
  (function () {
    document.addEventListener('click', function (e) {
      var el = e.target;
      while (el && !el.classList?.contains('pulse-media-yt')) el = el.parentElement;
      if (!el) return;
      var embedUrl = el.getAttribute('data-embed');
      var watchUrl = el.getAttribute('data-watch') || '';
      if (!embedUrl) return;
      e.preventDefault();

      // Save the original thumbnail HTML so we can restore on error.
      var originalHtml = el.innerHTML;
      el.style.cursor = 'default';

      var iframe = document.createElement('iframe');
      iframe.src = embedUrl;
      iframe.style.cssText = 'width:100%;aspect-ratio:16/9;border:0;border-radius:var(--radius-sm);';
      iframe.allow = 'accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture';
      iframe.allowFullscreen = true;

      // Detect embed failures. YouTube returns a 200 with an error page,
      // so we can't catch HTTP errors. Instead, set a timeout: if the
      // iframe loads the error page, the user can click "open externally".
      el.innerHTML = '';
      el.appendChild(iframe);

      // Add a small "can't play? open externally" link below.
      if (watchUrl) {
        var fallback = document.createElement('div');
        fallback.style.cssText = 'text-align:center;margin-top:var(--space-1);font-size:var(--font-size-xs);';
        fallback.innerHTML = '<a href="' + watchUrl + '" target="_blank" rel="noopener" style="color:var(--color-text-muted);">Not loading? Open on YouTube \\u2197</a>';
        el.parentElement.appendChild(fallback);
      }
    });
  })();
`;
