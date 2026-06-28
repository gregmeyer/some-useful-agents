/**
 * Global inbox badge: polls the needs-you count and shows an amber pill on the
 * Inbox nav link when threads are awaiting a reply. Lives in the layout bundle
 * so it runs on every page. No global inbox SSE channel exists (the event bus
 * is per-message), so a 30s poll is the minimal correct choice; live-update
 * via SSE is a future enhancement.
 */
export const INBOX_BADGE_JS = `
(function () {
  var el = document.querySelector('[data-inbox-badge]');
  if (!el) return;
  function refresh() {
    fetch('/inbox/needs-you-count', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || typeof d.count !== 'number') return;
        if (d.count > 0) { el.textContent = String(d.count); el.hidden = false; }
        else { el.textContent = ''; el.hidden = true; }
      })
      .catch(function () {});
  }
  refresh();
  setInterval(refresh, 30000);
})();
`;
