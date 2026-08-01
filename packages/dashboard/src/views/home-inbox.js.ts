/**
 * Keeps the Home inbox lead-in strips ("needs you" + loop ticker) live (C2).
 * Lives in the layout bundle but no-ops unless the page has a
 * [data-home-inbox] container (i.e. the Home page). On a global
 * `inbox:changed` event — re-broadcast from the /inbox/events SSE stream by
 * INBOX_STREAM_JS — it debounces, refetches the server-rendered strips
 * fragment, and swaps the container's contents. Same "SSE is a wake signal,
 * re-render from source" pattern as the list + modal; never patches from
 * event data. The row/modal open handlers are delegated on document, so a
 * swap can't strand them.
 */
export const HOME_INBOX_JS = `
(function () {
  var container = document.querySelector('[data-home-inbox]');
  if (!container) return;
  var timer = null;
  function refresh() {
    fetch('/inbox/home-strips', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (htmlText) {
        if (htmlText == null) return;
        var tmp = document.createElement('div');
        tmp.innerHTML = htmlText;
        var fresh = tmp.querySelector('[data-home-inbox]');
        container.innerHTML = fresh ? fresh.innerHTML : htmlText;
      })
      .catch(function () {});
  }
  window.addEventListener('inbox:changed', function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  });
})();
`;
