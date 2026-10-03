/**
 * Global inbox live-update client (C1). Lives in the layout bundle so it
 * runs on every page — a SINGLE `EventSource('/inbox/events')` per tab.
 *
 * It re-broadcasts each coarse `inbox:changed` server event as a `window`
 * CustomEvent, so independent consumers (the top-bar badge, the inbox list
 * in inbox-modal.js.ts) each react without opening their own SSE socket.
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

})();
`;
