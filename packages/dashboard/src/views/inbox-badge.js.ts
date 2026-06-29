/**
 * Global "needs you" toast in the top bar: polls the inbox needs-you count and
 * reveals an amber pill ("N need your reply →") in the top-bar empty space when
 * threads are awaiting a reply. Lives in the layout bundle so it runs on every
 * page. No global inbox SSE channel exists (the event bus is per-message), so a
 * 30s poll is the minimal correct choice; live-update via SSE is a future step.
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
  refresh();
  setInterval(refresh, 30000);
})();
`;
