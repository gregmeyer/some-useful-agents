/**
 * Home (views/home-page.ts): a Today row opens in the docked sua panel (the
 * panel's own handler would open the old centred modal here), and Today
 * redraws after a change (a gesture, the panel closing) and every 20s while
 * the page is visible.
 */
export const HOME_PAGE_JS = `
  (function () {
    var host = document.querySelector('[data-home-today]');
    if (!host) return;
    // Capture: before the panel's document handler sees it.
    document.addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('[data-home-today] [data-panel-thread-id]');
      if (!row || !window.suaPanel) return;
      if (e.target.closest('details, [data-surface-op], a[href]:not([data-panel-thread-id])')) return;
      e.preventDefault();
      e.stopPropagation();
      window.suaPanel.open(row.getAttribute('data-panel-thread-id'));
    }, true);
    var status = document.querySelector('[data-home-status]');
    var busy = false;
    function refresh() {
      if (busy || document.visibilityState !== 'visible') return;
      // A row menu open, or a drag in progress: not now.
      if (host.querySelector('details[open], .is-dragging')) return;
      busy = true;
      fetch('/home/today', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) {
          if (j.html !== host.innerHTML) host.innerHTML = j.html;
          if (status && j.status) { status.textContent = j.status; status.classList.toggle('is-needs', !!j.needs); }
        })
        .catch(function () { /* keep what's shown */ })
        .then(function () { busy = false; });
    }
    document.addEventListener('sua:surface-changed', refresh);
    document.addEventListener('sua:panel-closed', refresh);
    setInterval(refresh, 20000);
  })();
`;
