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
      var row = e.target.closest && e.target.closest('[data-home-today] [data-panel-thread-id], [data-home-next] [data-panel-thread-id]');
      if (!row || !window.suaPanel) return;
      if (e.target.closest('[data-home-today] details, [data-surface-op], a[href]:not([data-panel-thread-id])')) return;
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
          var section = document.querySelector('[data-home-today-section]');
          if (section) section.classList.toggle('is-quiet', !!j.quiet);
        })
        .catch(function () { /* keep what's shown */ })
        .then(function () { busy = false; refreshNext(); });
    }
    // Next up and Housekeeping: redrawn with Today, and at once after "Not now".
    var nextBusy = false;
    function refreshNext() {
      var sec = document.querySelector('[data-home-next]');
      var body = document.querySelector('[data-home-next-body]');
      if (!sec || !body || nextBusy) return;
      // Typing in Ask sua after a fill, or a button mid-press: not now.
      if (sec.querySelector('button:disabled')) return;
      nextBusy = true;
      fetch('/home/next', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) {
          if (j.html !== body.innerHTML) body.innerHTML = j.html;
          sec.hidden = !j.count;
          var tidy = document.querySelector('[data-home-tidy]');
          var tidyBody = document.querySelector('[data-home-tidy-body]');
          var tidyCount = document.querySelector('[data-home-tidy-count]');
          if (tidy && tidyBody) {
            if (j.tidy !== tidyBody.innerHTML) tidyBody.innerHTML = j.tidy;
            tidy.hidden = !j.tidyCount;
            if (tidyCount) tidyCount.textContent = j.tidySummary || '';
          }
        })
        .catch(function () { /* keep what's shown */ })
        .then(function () { nextBusy = false; });
    }
    document.addEventListener('submit', function (e) {
      var form = e.target.closest && e.target.closest('[data-next-dismiss]');
      if (!form) return;
      e.preventDefault();
      var item = form.closest('[data-next-item]');
      var id = form.querySelector('input[name="id"]');
      if (item) item.style.opacity = '0.4';
      fetch(form.getAttribute('action'), { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'id=' + encodeURIComponent(id ? id.value : '') })
        .catch(function () { /* the refresh shows what's true */ })
        .then(refreshNext);
    });
    document.addEventListener('sua:surface-changed', refresh);
    document.addEventListener('sua:panel-closed', refresh);
    setInterval(refresh, 20000);
  })();
`;
