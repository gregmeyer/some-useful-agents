/**
 * Inbox modal — fluid in-page detail view.
 *
 * Wires the row click → modal-open → fetch fragment → submit forms via
 * fetch → poll for triage responses. No page navigation needed.
 *
 * Contract with the server:
 *   GET  /inbox/:id/fragment              → inner detail HTML (no layout chrome)
 *   POST /inbox/:id/dismiss               → 204; modal closes + row hides locally
 *   POST /inbox/:id/respond {body}        → 204; we re-fetch the fragment so the
 *                                            new user response + any triage
 *                                            reply that posted appear in-place
 *   POST /inbox/:id/triage                → 204; triage agent runs server-side
 *
 * Polling: while the fragment carries [data-triage-pending="1"] we
 * re-fetch every 1.5s until the marker clears (the server sets it
 * when a triage run is queued/running for the message).
 */

export const INBOX_MODAL_JS = `
(function () {
  var modal = document.getElementById('inbox-modal');
  if (!modal) return;
  var content = document.getElementById('inbox-modal-content');
  if (!content) return;

  var currentId = null;
  var pollTimer = null;

  function open() {
    modal.hidden = false;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    modal.hidden = true;
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    currentId = null;
    stopPoll();
  }

  function stopPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function maybeSchedulePoll() {
    stopPoll();
    if (!currentId) return;
    var pending = content.querySelector('[data-triage-pending="1"]');
    if (!pending) return;
    pollTimer = setTimeout(function () { refresh(); }, 1500);
  }

  function refresh() {
    if (!currentId) return;
    var id = currentId;
    fetch('/inbox/' + encodeURIComponent(id) + '/fragment', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('fragment fetch failed'); return r.text(); })
      .then(function (text) {
        if (currentId !== id) return; // user opened a different message in the meantime
        content.innerHTML = text;
        focusFirstInteractive();
        maybeSchedulePoll();
      })
      .catch(function () { /* swallow; user can close + retry */ });
  }

  function focusFirstInteractive() {
    var ta = content.querySelector('textarea[name="body"]');
    if (ta) { ta.focus(); return; }
    var btn = content.querySelector('button, a');
    if (btn) btn.focus();
  }

  function openFor(id) {
    currentId = id;
    content.innerHTML = '<p class="dim" style="margin:0;padding:var(--space-4) 0;text-align:center;">Loading…</p>';
    open();
    refresh();
  }

  // Click anywhere on a row → open the modal for that message. Inner
  // anchors (agent link, title link) opt out via [data-inbox-row-stop]
  // / [data-inbox-row-link]; the title link is handled below so the
  // row's modal still wins over the navigation.
  document.addEventListener('click', function (e) {
    var stop = e.target.closest && e.target.closest('[data-inbox-row-stop]');
    if (stop) return; // let the agent link navigate normally

    var titleLink = e.target.closest && e.target.closest('[data-inbox-row-link]');
    if (titleLink) {
      e.preventDefault();
      var row = titleLink.closest('[data-inbox-row-id]');
      if (row) openFor(row.getAttribute('data-inbox-row-id'));
      return;
    }

    var row = e.target.closest && e.target.closest('[data-inbox-row-id]');
    if (row) {
      e.preventDefault();
      openFor(row.getAttribute('data-inbox-row-id'));
      return;
    }

    // Close button or backdrop click.
    if (e.target === modal || (e.target.closest && e.target.closest('[data-inbox-modal-close]'))) {
      close();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  // Intercept Reply / Dismiss / Triage form submits inside the modal.
  // The form's action + method tell us where to POST; the response is
  // a 204 (or 4xx with a flash message in the body) and we always
  // re-fetch the fragment afterwards so the modal state matches the
  // server.
  modal.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.hasAttribute('data-inbox-modal-form')) return;
    e.preventDefault();
    var action = form.getAttribute('action');
    var method = (form.getAttribute('method') || 'POST').toUpperCase();
    var formData = new FormData(form);
    // Disable submit button + textarea while in flight so a double-click
    // doesn't double-post (the triage path can take a few seconds).
    var submits = form.querySelectorAll('button[type="submit"]');
    for (var i = 0; i < submits.length; i++) submits[i].disabled = true;
    var dismissBody = form.getAttribute('data-inbox-modal-dismiss-on-success') === '1';
    fetch(action, {
      method: method,
      credentials: 'same-origin',
      body: new URLSearchParams(Array.from(formData.entries())).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('mutation failed: ' + r.status);
      })
      .then(function () {
        if (dismissBody) {
          // Dismiss: close modal + hide the row in the list locally so
          // the user sees the queue shrink immediately.
          var row = document.querySelector('[data-inbox-row-id="' + cssEscape(currentId || '') + '"]');
          if (row && row.parentNode) row.parentNode.removeChild(row);
          close();
        } else {
          refresh();
        }
      })
      .catch(function () {
        for (var i = 0; i < submits.length; i++) submits[i].disabled = false;
      });
  });

  function cssEscape(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return '\\\\' + c.charCodeAt(0).toString(16) + ' ';
    });
  }
})();
`;
