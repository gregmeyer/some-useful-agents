/**
 * Client-side JS for the "Run again" (replay) control on Pulse / dashboard
 * widget tiles.
 *
 * The replay control is a plain POST <form action="/agents/:id/run"> so that
 * it still works without JS — but that route 303-redirects to the run detail
 * page, which yanks the user off the dashboard. That's the wrong default for a
 * tile: clicking "Run again" should re-run the agent and refresh the widget
 * *in place*.
 *
 * This handler progressively enhances the form: it intercepts the submit (only
 * when the form lives inside a `.pulse-tile`, so the agent detail page keeps
 * its navigate-to-run behaviour), starts the run via `/agents/:id/widget-run`
 * (JSON, no redirect), polls `/runs/:id/widget-status` until terminal, then
 * swaps the whole tile fragment from `/pulse/tile/:id`. The swap reuses the
 * same layout-state-preserving logic as PULSE_REFRESH_JS.
 *
 * Inlined via layout.ts.
 */
export const WIDGET_REPLAY_INPLACE_JS = `
  // ── Widget "Run again" in place ───────────────────────────────────
  (function () {
    var POLL_MS = 500;
    var POLL_CAP = 240; // ~120s ceiling before we give up polling.

    function swapTile(tile, agentId) {
      return fetch('/pulse/tile/' + encodeURIComponent(agentId), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          if (!html) return null;
          var temp = document.createElement('div');
          temp.innerHTML = html;
          var newTile = temp.firstElementChild;
          if (newTile && tile.parentNode) {
            // Preserve layout state (palette, collapsed, grid placement) the
            // same way PULSE_REFRESH_JS does when it swaps a refreshed tile.
            var palette = tile.getAttribute('data-palette');
            if (palette) newTile.setAttribute('data-palette', palette);
            if (tile.classList.contains('pulse-tile--collapsed')) newTile.classList.add('pulse-tile--collapsed');
            if (tile.style.gridColumn) newTile.style.gridColumn = tile.style.gridColumn;
            if (tile.style.gridRow) newTile.style.gridRow = tile.style.gridRow;
            tile.parentNode.replaceChild(newTile, tile);
            return newTile;
          }
          return null;
        });
    }

    function restoreButton(tile, btn, label) {
      tile.style.opacity = '1';
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }

    function flashError(tile, msg) {
      var host = tile.querySelector('.pulse-tile__body') || tile;
      var flash = document.createElement('div');
      flash.className = 'flash flash--error';
      flash.style.cssText = 'margin:var(--space-2);font-size:var(--font-size-xs);';
      flash.textContent = msg || 'Run failed';
      host.appendChild(flash);
      setTimeout(function () { flash.remove(); }, 6000);
    }

    function poll(tile, agentId, runId, btn, label, count) {
      if (count >= POLL_CAP) {
        restoreButton(tile, btn, label);
        flashError(tile, 'Still running — open the run for details.');
        return;
      }
      fetch('/runs/' + encodeURIComponent(runId) + '/widget-status', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (data) {
          if (data.status === 'completed') {
            // Swapping the whole tile brings back a fresh, enabled button and
            // the new result — no need to restore the old one.
            swapTile(tile, agentId).then(function (swapped) {
              if (!swapped) restoreButton(tile, btn, label);
            });
            return;
          }
          if (data.status === 'failed') {
            restoreButton(tile, btn, label);
            flashError(tile, data.error || 'Run failed.');
            return;
          }
          if (data.status === 'cancelled') {
            restoreButton(tile, btn, label);
            return;
          }
          // pending / running: keep polling.
          setTimeout(function () { poll(tile, agentId, runId, btn, label, count + 1); }, POLL_MS);
        })
        .catch(function (err) {
          restoreButton(tile, btn, label);
          flashError(tile, 'Status check failed: ' + (err.message || err));
        });
    }

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || !form.matches || !form.matches('form.wc-group--replay')) return;
      var tile = form.closest ? form.closest('.pulse-tile[data-agent-id]') : null;
      if (!tile) return; // Not a tile (e.g. agent detail page) — leave default navigation.
      var agentId = tile.getAttribute('data-agent-id');
      if (!agentId) return;
      e.preventDefault();

      var btn = form.querySelector('[data-widget-control="replay"]');
      var label = btn ? btn.textContent : 'Run again';
      if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
      tile.style.opacity = '0.7';

      var body = new URLSearchParams();
      new FormData(form).forEach(function (v, k) { body.append(k, String(v)); });

      fetch('/agents/' + encodeURIComponent(agentId) + '/widget-run', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || ('HTTP ' + r.status)); });
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.runId) throw new Error('Run did not start.');
          poll(tile, agentId, data.runId, btn, label, 0);
        })
        .catch(function (err) {
          restoreButton(tile, btn, label);
          flashError(tile, 'Failed to start run: ' + (err.message || err));
        });
    });
  })();
`;
