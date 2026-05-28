/**
 * Inbox modal — fluid in-page detail view with Slack-style live thread.
 *
 * Wires:
 *   - row click → fetch /inbox/:id/fragment → reveal modal
 *   - Reply / Dismiss / Ask-triage forms inside the modal → fetch POST
 *   - after every mutation: re-fetch the fragment so the DOM matches state
 *   - while [data-triage-pending="1"] OR within 30s of a user reply,
 *     poll the fragment every 1.5s so the agent's reply appears without
 *     user action
 *   - track conversation entries by data-msg-id; new ones get a
 *     `.inbox-msg--new` class so the CSS animation plays exactly once
 *   - auto-scroll the conversation to the bottom when new content lands
 *
 * Dismiss closes the modal and removes the row from the list locally so
 * the queue shrinks immediately (no full /inbox reload).
 */

export const INBOX_MODAL_JS = `
(function () {
  var modal = document.getElementById('inbox-modal');
  if (!modal) return;
  var content = document.getElementById('inbox-modal-content');
  if (!content) return;

  // Per-open state.
  var currentId = null;
  var pollTimer = null;
  // Tracks ids we've already shown — anything new on the next fetch
  // gets the slide-in animation class.
  var seenMsgIds = Object.create(null);
  // After a user reply we keep polling for up to ~30s even if the
  // server hasn't yet attached a triageRunId to the message — the
  // dag-executor + run-store insertion is racy with our 200ms wait.
  var keepPollingUntil = 0;

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
    seenMsgIds = Object.create(null);
    keepPollingUntil = 0;
    stopPoll();
  }

  function stopPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function shouldKeepPolling() {
    if (content.querySelector('[data-triage-pending="1"]')) return true;
    // Any proposed sub-agent action that's currently executing means
    // we need to keep refreshing to surface its lifecycle updates.
    if (content.querySelector('[data-action-running="1"]')) return true;
    if (Date.now() < keepPollingUntil) return true;
    return false;
  }

  function maybeSchedulePoll() {
    stopPoll();
    if (!currentId) return;
    if (!shouldKeepPolling()) return;
    pollTimer = setTimeout(function () { refresh(); }, 1500);
  }

  function applyAnimations() {
    // Mark new conversation entries so the CSS @keyframes plays. Skip
    // animation on the very first render (everything would slide in
    // at once — distracting). Only entries that weren't in the
    // previous seenMsgIds set get the class.
    var firstRender = Object.keys(seenMsgIds).length === 0;
    var msgs = content.querySelectorAll('[data-msg-id]');
    for (var i = 0; i < msgs.length; i++) {
      var el = msgs[i];
      var id = el.getAttribute('data-msg-id');
      if (!firstRender && !seenMsgIds[id]) el.classList.add('inbox-msg--new');
      seenMsgIds[id] = true;
    }
  }

  function scrollToBottom() {
    // Defer to next frame so any new content has laid out.
    requestAnimationFrame(function () {
      content.scrollTop = content.scrollHeight;
    });
  }

  function refresh() {
    if (!currentId) return;
    var id = currentId;
    fetch('/inbox/' + encodeURIComponent(id) + '/fragment', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('fragment fetch failed'); return r.text(); })
      .then(function (text) {
        if (currentId !== id) return; // user opened a different message
        content.innerHTML = text;
        applyAnimations();
        scrollToBottom();
        focusFirstInteractive();
        maybeSchedulePoll();
      })
      .catch(function () { /* swallow; user can close + retry */ });
  }

  function focusFirstInteractive() {
    var ta = content.querySelector('textarea[name="body"]');
    if (ta && !ta.disabled) { ta.focus(); return; }
    var btn = content.querySelector('button:not([disabled]), a');
    if (btn) btn.focus();
  }

  function openFor(id) {
    currentId = id;
    seenMsgIds = Object.create(null);
    keepPollingUntil = 0;
    content.innerHTML = '<p class="dim" style="margin:0;padding:var(--space-4) 0;text-align:center;">Loading…</p>';
    open();
    refresh();
  }

  // Row click → modal.
  document.addEventListener('click', function (e) {
    var stop = e.target.closest && e.target.closest('[data-inbox-row-stop]');
    if (stop) return;

    var titleLink = e.target.closest && e.target.closest('[data-inbox-row-link]');
    if (titleLink) {
      e.preventDefault();
      var row1 = titleLink.closest('[data-inbox-row-id]');
      if (row1) openFor(row1.getAttribute('data-inbox-row-id'));
      return;
    }

    var row = e.target.closest && e.target.closest('[data-inbox-row-id]');
    if (row) {
      e.preventDefault();
      openFor(row.getAttribute('data-inbox-row-id'));
      return;
    }

    if (e.target === modal || (e.target.closest && e.target.closest('[data-inbox-modal-close]'))) {
      close();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  // Intercept Reply / Dismiss / Triage form submits inside the modal.
  modal.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.hasAttribute('data-inbox-modal-form')) return;
    e.preventDefault();
    var action = form.getAttribute('action');
    var method = (form.getAttribute('method') || 'POST').toUpperCase();
    var formData = new FormData(form);
    var submits = form.querySelectorAll('button[type="submit"]');
    for (var i = 0; i < submits.length; i++) submits[i].disabled = true;
    var dismissAfter = form.getAttribute('data-inbox-modal-dismiss-on-success') === '1';
    // /respond and /triage both auto-fire the triage agent server-side.
    // Bump the polling deadline so we catch the response even if the
    // server's triageRunId capture races our first refresh.
    var keepsTriagePolling = form.getAttribute('data-inbox-modal-keeps-triage') === '1';
    if (keepsTriagePolling) keepPollingUntil = Date.now() + 30000;

    fetch(action, {
      method: method,
      credentials: 'same-origin',
      body: new URLSearchParams(Array.from(formData.entries())).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'fetch',
      },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('mutation failed: ' + r.status);
      })
      .then(function () {
        if (dismissAfter) {
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
