/**
 * Global "needs you" toast in the top bar: reveals an amber pill ("N need your
 * reply →") in the top-bar empty space when threads are awaiting a reply. Lives
 * in the layout bundle so it runs on every page.
 *
 * Live: reacts to the global `inbox:changed` window event (re-broadcast from
 * the `/inbox/events` SSE stream by INBOX_STREAM_JS) with a short debounce, so
 * the count updates within ~half a second of any inbox change. The 30s poll is
 * kept as a fallback for environments without EventSource and to catch changes
 * from other processes (worker / mcp-server producers) that don't reach this
 * tab's event bus.
 */
export const INBOX_BADGE_JS = `
(function () {
  var toast = document.querySelector('[data-inbox-toast]');
  var countEl = document.querySelector('[data-inbox-count]');
  var labelEl = document.querySelector('[data-inbox-label]');
  if (!toast || !countEl) return;
  function refresh() {
    fetch('/inbox/needs-you-count', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || typeof d.count !== 'number') return;
        if (d.count > 0) {
          countEl.textContent = String(d.count);
          if (labelEl) labelEl.textContent = d.count === 1 ? '\\u00a0needs your reply' : '\\u00a0need your reply';
          toast.hidden = false;
        } else { toast.hidden = true; }
      })
      .catch(function () {});
  }
  var timer = null;
  window.addEventListener('inbox:changed', function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  });
  refresh();
  setInterval(refresh, 30000);
})();
`;
