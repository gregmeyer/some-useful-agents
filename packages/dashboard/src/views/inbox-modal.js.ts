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
        // Don't blow away the modal DOM mid-interaction. innerHTML
        // replacement destroys both text selections (operator copying
        // triage's reply) and caret position in the composer. When the
        // user is actively interacting, skip THIS refresh and just
        // reschedule — the next tick will catch up. The polling deadline
        // logic in maybeSchedulePoll() keeps us watching until the user
        // stops interacting.
        if (userIsInteracting()) {
          maybeSchedulePoll();
          return;
        }
        content.innerHTML = text;
        applyAnimations();
        scrollToBottom();
        focusFirstInteractive();
        maybeSchedulePoll();
      })
      .catch(function () { /* swallow; user can close + retry */ });
  }

  /**
   * True if the operator is actively interacting with the modal — they
   * have focus inside it (typing), or they have a non-empty text
   * selection anchored inside it (highlighting text to copy). In
   * either case, a poll-driven refresh should NOT call focus
   * because that wipes the selection / caret position.
   */
  function userIsInteracting() {
    if (content.contains(document.activeElement)) return true;
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      try {
        var anchor = sel.anchorNode;
        if (anchor && content.contains(anchor.nodeType === 1 ? anchor : anchor.parentNode)) {
          return true;
        }
      } catch (_) { /* ignore */ }
    }
    return false;
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

  // Row click → modal. Chevron click is checked first and toggles the
  // inline preview without opening the modal.
  document.addEventListener('click', function (e) {
    // Row preview toggle (chevron on the gridded row).
    var chev = e.target.closest && e.target.closest('[data-inbox-row-chevron]');
    if (chev) {
      e.preventDefault();
      e.stopPropagation();
      var rowEl = chev.closest('[data-inbox-row-id]');
      if (rowEl) {
        var expanded = rowEl.classList.toggle('inbox-row2--expanded');
        chev.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
      return;
    }

    // Rail entry → open the modal for that thread.
    var railItem = e.target.closest && e.target.closest('[data-inbox-rail-id]');
    if (railItem) {
      e.preventDefault();
      openFor(railItem.getAttribute('data-inbox-rail-id'));
      return;
    }

    // Rail collapse / expand toggle.
    var railToggle = e.target.closest && e.target.closest('[data-inbox-rail-toggle]');
    if (railToggle) {
      e.preventDefault();
      var shell = document.getElementById('inbox-shell');
      if (shell) {
        var collapsed = shell.classList.toggle('inbox-shell--rail-collapsed');
        try { localStorage.setItem('sua-inbox-rail', collapsed ? 'collapsed' : 'open'); } catch (_) {}
        railToggle.textContent = collapsed ? '›' : '‹';
      }
      return;
    }

    // Suggested-actions banner collapse toggle.
    var suggToggle = e.target.closest && e.target.closest('[data-inbox-suggest-toggle]');
    if (suggToggle) {
      e.preventDefault();
      var suggest = document.getElementById('inbox-suggest');
      if (suggest) {
        var hidden = suggest.classList.toggle('inbox-suggest--collapsed');
        try { localStorage.setItem('sua-inbox-suggest', hidden ? 'collapsed' : 'open'); } catch (_) {}
        suggToggle.textContent = hidden ? 'Show' : 'Hide';
        suggToggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      }
      return;
    }

    // + New conversation: POST /inbox/new, open the returned id in-modal.
    var newBtn = e.target.closest && e.target.closest('#inbox-new-conversation');
    if (newBtn) {
      e.preventDefault();
      newBtn.disabled = true;
      fetch('/inbox/new', {
        method: 'POST',
        credentials: 'same-origin',
        body: new URLSearchParams({ title: '' }).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'fetch',
        },
      })
        .then(function (r) {
          if (!r.ok) throw new Error('create failed: ' + r.status);
          var newId = r.headers.get('X-Inbox-Id');
          if (newId) openFor(newId);
        })
        .catch(function (err) {
          // Surface failure inline; fall back to nothing.
          console.error('inbox /new failed', err);
        })
        .then(function () { newBtn.disabled = false; });
      return;
    }

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

  // Restore drawer + banner state on load.
  (function restoreShellState() {
    try {
      var railState = localStorage.getItem('sua-inbox-rail');
      var shell = document.getElementById('inbox-shell');
      if (shell && railState === 'collapsed') {
        shell.classList.add('inbox-shell--rail-collapsed');
        var toggle = shell.querySelector('[data-inbox-rail-toggle]');
        if (toggle) toggle.textContent = '›';
      }
      var suggState = localStorage.getItem('sua-inbox-suggest');
      var suggest = document.getElementById('inbox-suggest');
      if (suggest && suggState === 'collapsed') {
        suggest.classList.add('inbox-suggest--collapsed');
        var sToggle = suggest.querySelector('[data-inbox-suggest-toggle]');
        if (sToggle) { sToggle.textContent = 'Show'; sToggle.setAttribute('aria-expanded', 'false'); }
      }
    } catch (_) {}
  })();

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

  // ── Inbox list toolbar: autosubmit + search debounce + chip clear ──
  (function setupInboxToolbar() {
    var form = document.querySelector('[data-inbox-toolbar]');
    if (!form) return;
    var q = form.querySelector('[data-inbox-toolbar-q]');
    var qTimer = null;
    if (q) {
      q.addEventListener('input', function () {
        if (qTimer) clearTimeout(qTimer);
        qTimer = setTimeout(function () { form.submit(); }, 350);
      });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (qTimer) clearTimeout(qTimer);
          form.submit();
        }
      });
    }
    var clear = form.querySelector('[data-inbox-toolbar-clear]');
    if (clear) {
      clear.addEventListener('click', function () {
        if (q) { q.value = ''; q.focus(); }
        form.submit();
      });
    }
    var autoEls = form.querySelectorAll('[data-inbox-toolbar-submit]');
    for (var ai = 0; ai < autoEls.length; ai++) {
      autoEls[ai].addEventListener('change', function () { form.submit(); });
    }
  })();

  // ── Tag pills inside the modal (add / remove with quiet submit) ──
  // The remove buttons + the Add-tag input live in the rendered
  // fragment; we delegate on the modal element since the fragment
  // refreshes after every save.
  modal.addEventListener('click', function (e) {
    var rm = e.target.closest && e.target.closest('[data-inbox-tag-remove]');
    if (!rm) return;
    e.preventDefault();
    e.stopPropagation();
    var tag = rm.getAttribute('data-inbox-tag-remove');
    var hidden = modal.querySelector('[data-inbox-tags-input]');
    if (!hidden) return;
    var current = String(hidden.value).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var next = current.filter(function (t) { return t !== tag; });
    hidden.value = next.join(', ');
    var form = hidden.form;
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  });
  modal.addEventListener('keydown', function (e) {
    var add = e.target.closest && e.target.closest('[data-inbox-tag-add]');
    if (!add) return;
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var raw = String(add.value).trim().toLowerCase();
    if (!raw) return;
    var hidden = modal.querySelector('[data-inbox-tags-input]');
    if (!hidden) return;
    var current = String(hidden.value).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (current.indexOf(raw) === -1) current.push(raw);
    hidden.value = current.join(', ');
    add.value = '';
    var form = hidden.form;
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  });
})();
`;
