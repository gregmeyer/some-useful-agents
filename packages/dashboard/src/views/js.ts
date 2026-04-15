/**
 * Inline JS. Tiny vanilla script for:
 *   1. The community-shell confirm modal (open/close, checkbox-gated submit)
 *   2. Auto-poll on /runs/:id when the run is still in-progress
 *
 * Inlined so there's no second HTTP round-trip for ~2KB of logic.
 */
export const DASHBOARD_JS = `
(function () {
  // Community-shell confirm modal
  function openModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('open');
  }
  function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }
  window.suaOpenModal = openModal;
  window.suaCloseModal = closeModal;

  // Toggle submit button when the audit checkbox flips
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('input[data-audit-checkbox]')) {
      var formId = t.getAttribute('data-audit-checkbox');
      var btn = document.querySelector('button[data-audit-submit="' + formId + '"]');
      if (btn) btn.disabled = !t.checked;
    }
  });

  // Confirm-before-submit for forms with [data-confirm]. Used on
  // destructive settings actions (delete secret, rotate MCP token).
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches('form[data-confirm]')) return;
    var msg = form.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) {
      e.preventDefault();
    }
  });

  // Auto-poll for in-progress runs
  var runDetail = document.querySelector('[data-run-in-progress]');
  if (runDetail) {
    var runId = runDetail.getAttribute('data-run-in-progress');
    var poll = function () {
      fetch('/runs/' + encodeURIComponent(runId) + '?partial=1', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function (html) {
          var placeholder = document.createElement('div');
          placeholder.innerHTML = html;
          var fresh = placeholder.querySelector('[data-run-container]');
          var current = document.querySelector('[data-run-container]');
          if (fresh && current) {
            current.replaceWith(fresh);
            // If the new fragment no longer carries the in-progress marker,
            // the poll loop stops naturally on the next scheduled tick.
            if (fresh.querySelector('[data-run-in-progress]')) {
              setTimeout(poll, 2000);
            }
          }
        })
        .catch(function () { /* swallow; will retry on next tick */ setTimeout(poll, 5000); });
    };
    setTimeout(poll, 2000);
  }
})();
`;
