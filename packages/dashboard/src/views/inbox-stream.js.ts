/**
 * Global inbox live-update client (C1). Lives in the layout bundle so it
 * runs on every page — a SINGLE `EventSource('/inbox/events')` per tab.
 *
 * The connection does two jobs:
 *  1. Re-broadcast each coarse `inbox:changed` server event as a `window`
 *     CustomEvent so independent consumers (the top-bar badge, the list
 *     page) can each react without opening their own SSE socket.
 *  2. On the `/inbox` list page only, refetch the server-rendered rows
 *     fragment with the CURRENT filters and swap `.inbox-main` — mirroring
 *     the modal's "SSE is a wake signal, re-render from source" pattern
 *     rather than patching the DOM from event payloads.
 *
 * `inbox:changed` is an idempotent refetch trigger, so a missed or
 * duplicate event is harmless. EventSource auto-reconnects (with
 * Last-Event-ID replay) — no manual retry needed. Environments without
 * EventSource simply keep the badge's 30s poll fallback.
 */
export const INBOX_STREAM_JS = `
(function () {
  if (typeof EventSource === 'undefined') return;
  var es;
  try { es = new EventSource('/inbox/events'); } catch (e) { return; }
  // Release the connection deterministically on navigation. Without this,
  // Chrome reaps the socket lazily, so rapid page-to-page clicks stack
  // not-yet-closed SSE connections against the ~6-per-origin HTTP/1.1 cap
  // and subsequent requests (page HTML, assets) queue behind them — a
  // progressive stall. 'pagehide' fires on navigation and stays
  // bfcache-friendly (unlike 'beforeunload'). Mirrors the inbox modal's
  // own eventSource.close().
  window.addEventListener('pagehide', function () {
    try { es.close(); } catch (e) { /* noop */ }
  });
  es.addEventListener('inbox:changed', function (ev) {
    var detail = null;
    try { detail = ev && ev.data ? JSON.parse(ev.data) : null; } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('inbox:changed', { detail: detail })); } catch (e) {}
  });

  // Live list refresh — only on the /inbox list page (has .inbox-main).
  var main = document.querySelector('.inbox-main');
  if (!main) return;
  var timer = null;
  function refreshRows() {
    // Don't yank the list out from under an open thread modal or an
    // in-progress bulk selection — the operator is mid-task. The next
    // change (or the 30s badge poll driving attention) still catches up.
    var modal = document.getElementById('inbox-modal');
    if (modal && !modal.hidden) return;
    if (typeof window.__inboxHasBulkSelection === 'function' && window.__inboxHasBulkSelection()) return;
    // location.search is authoritative for the active filters (the filter
    // toolbar is a plain GET form that navigates on change), so carry it
    // verbatim onto the fragment request or a live refresh would silently
    // reset the operator's filter/sort.
    var qs = window.location.search || '';
    fetch('/inbox/rows' + qs, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (htmlText) { if (htmlText != null) main.innerHTML = htmlText; })
      .catch(function () {});
  }
  window.addEventListener('inbox:changed', function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refreshRows, 400);
  });
})();
`;
