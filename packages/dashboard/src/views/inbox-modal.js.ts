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

  // SSE state. eventSource carries the active connection; sseAliveAt
  // records the last event (or open) timestamp so the watchdog can
  // detect a silent disconnect and fall back to the fragment poll.
  var eventSource = null;
  var sseAliveAt = 0;
  var sseWatchdog = null;
  // Watchdog cadence: if we haven't seen any SSE message (data or
  // heartbeat comment) within this window, force a fragment refresh
  // to recover gracefully. Heartbeats fire every 15s server-side,
  // so 20s is comfortable headroom.
  var SSE_WATCHDOG_MS = 20000;

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
    closeEventSource();
  }

  function closeEventSource() {
    if (eventSource) {
      try { eventSource.close(); } catch (_) { /* noop */ }
      eventSource = null;
    }
    if (sseWatchdog) { clearInterval(sseWatchdog); sseWatchdog = null; }
    sseAliveAt = 0;
  }

  /**
   * Open an EventSource for the current thread. Each handled event
   * triggers a fragment refresh — the SSE notification is the "wake
   * up, something changed" signal; the canonical state still comes
   * from /fragment so we never have to incrementally diff DOM here.
   * (PR 3+4 will start rendering tokens directly.)
   *
   * If EventSource isn't available (very old browsers) or the
   * endpoint returns an error, we silently fall through to the
   * 1.5s fragment poll. Same behavior on SSE disconnect via the
   * watchdog below.
   */
  function openEventSource(messageId) {
    closeEventSource();
    if (typeof EventSource === 'undefined') return;
    var es;
    try {
      es = new EventSource('/inbox/' + encodeURIComponent(messageId) + '/events');
    } catch (_) { return; }
    eventSource = es;
    sseAliveAt = Date.now();

    es.addEventListener('open', function () { sseAliveAt = Date.now(); });
    es.addEventListener('error', function () {
      // EventSource auto-reconnects with Last-Event-ID; we just note
      // the disconnect so the watchdog can decide whether to fall
      // back to the poll.
      sseAliveAt = sseAliveAt || Date.now();
    });

    // Generic handler for all our custom event types. The data
    // payload is JSON; for now we just trigger a refresh because the
    // fragment already renders the canonical state. PR 4 will start
    // patching DOM incrementally for triage:token events.
    var onAnyEvent = function () {
      sseAliveAt = Date.now();
      // Only one event per animation frame to avoid stacking refreshes
      // when several events arrive in the same tick.
      scheduleSseRefresh();
    };
    [
      'state', 'triage:started', 'triage:token', 'triage:complete',
      'action:created', 'action:status', 'message:created',
    ].forEach(function (t) { es.addEventListener(t, onAnyEvent); });

    // Watchdog: if the channel goes silent past the threshold (no
    // heartbeat or data), we suspect the connection died below the
    // EventSource layer (proxy timeout, sleeping tab). Fall back to
    // the fragment poll until the next real event arrives.
    if (sseWatchdog) clearInterval(sseWatchdog);
    sseWatchdog = setInterval(function () {
      if (!eventSource || currentId !== messageId) return;
      if (Date.now() - sseAliveAt > SSE_WATCHDOG_MS) {
        refresh();
        sseAliveAt = Date.now();
      }
    }, 5000);
    if (sseWatchdog && typeof sseWatchdog === 'object' && 'unref' in sseWatchdog) {
      sseWatchdog.unref && sseWatchdog.unref();
    }
  }

  var sseRefreshRaf = null;
  function scheduleSseRefresh() {
    if (sseRefreshRaf) return;
    sseRefreshRaf = requestAnimationFrame(function () {
      sseRefreshRaf = null;
      // The "userIsInteracting" check inside refresh() still applies
      // — if the operator is typing in a non-empty textarea or has a
      // selection, the swap is skipped (their state is preserved)
      // until the next event or the watchdog forces through.
      refresh();
    });
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
    // Re-attach the waiting-label rotation in case the fragment refresh
    // replaced the thinking indicator DOM. updateWaitingLabels reads
    // [data-thinking-label] freshly each tick so a swapped node is
    // handled automatically.
    updateWaitingLabels();
  }

  // Witty waiting labels — rotate the copy under the thinking dots
  // every 2s while triage is busy. Phase pulled from the indicator's
  // data-thinking-phase so the label set fits the moment (triage vs
  // action-running vs verifying). Cross-fade is CSS-driven.
  var WAITING_LABELS = {
    triage: [
      'Pondering', 'Distilling tokens', 'Marinating thoughts',
      'Cogitating', 'Polishing prose', 'Consulting the muse',
      'Brewing ideas', 'Threading reasoning', 'Synthesizing',
      'Steeping reply', 'Sketching response', 'Untangling intent',
    ],
    'action-running': [
      'Dispatching', 'Running it', 'Crunching',
      'Compiling notes', 'Tracing call graph',
    ],
    verifying: [
      'Double-checking', 'Verifying', 'Sanity-checking',
    ],
  };
  var waitingTimer = null;
  function updateWaitingLabels() {
    if (waitingTimer) { clearInterval(waitingTimer); waitingTimer = null; }
    var labelEl = content.querySelector('[data-thinking-label]');
    if (!labelEl) return;
    var indicator = labelEl.closest('.inbox-thinking');
    var phase = indicator ? (indicator.getAttribute('data-thinking-phase') || 'triage') : 'triage';
    var labels = WAITING_LABELS[phase] || WAITING_LABELS.triage;
    // Seed with a random label so the indicator never repeats the
    // same one across consecutive triage runs.
    var idx = Math.floor(Math.random() * labels.length);
    var rotate = function () {
      // Re-query each tick so a re-render swap is handled gracefully.
      var el = content.querySelector('[data-thinking-label]');
      if (!el) { if (waitingTimer) { clearInterval(waitingTimer); waitingTimer = null; } return; }
      idx = (idx + 1) % labels.length;
      el.classList.add('inbox-thinking__label--out');
      setTimeout(function () {
        var still = content.querySelector('[data-thinking-label]');
        if (!still) return;
        still.textContent = labels[idx];
        still.classList.remove('inbox-thinking__label--out');
      }, 220);
    };
    waitingTimer = setInterval(rotate, 2000);
    // Run one rotation immediately so the seed label gets replaced
    // by something from the curated set within the first tick — this
    // proves to the operator that the loop is alive.
    setTimeout(rotate, 600);
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
   * have a non-empty text selection anchored inside it (highlighting
   * text to copy), or they are typing into a non-empty input. In
   * either case, a poll-driven refresh should NOT swap the DOM
   * because that wipes the selection or in-progress text.
   *
   * Critical: an EMPTY focused textarea does NOT count as interacting.
   * After Post reply, the textarea clears but focus stays in it —
   * if we treated that as interacting, refresh() would skip swaps
   * forever, the thinking indicator + triage reply would never
   * appear, and the operator would be staring at a stale modal
   * wondering if anything happened.
   */
  function userIsInteracting() {
    var active = document.activeElement;
    if (content.contains(active)) {
      // Empty input fields don't count — the operator hasn't started
      // typing yet, so a fragment swap is safe (and necessary).
      var tag = active.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        var val = active.value != null ? String(active.value) : '';
        if (val.length === 0) {
          // Fall through to the selection check below.
        } else {
          return true;
        }
      } else {
        // Any non-input element with focus (button, link, details
        // summary) is genuine interaction.
        return true;
      }
    }
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
    // Open the SSE connection AFTER the initial fragment fetch so
    // the first render isn't racing the stream. Each subsequent
    // event triggers an incremental refresh.
    openEventSource(id);
  }

  // Row click → modal. Chevron click is checked first and toggles the
  // inline preview without opening the modal.
  document.addEventListener('click', function (e) {
    // Copy-message button on a conversation entry. Reads the
    // sibling .inbox-msg__text textContent so we copy what the
    // operator actually sees (newlines preserved, HTML stripped).
    var copyBtn = e.target.closest && e.target.closest('[data-inbox-copy]');
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      var msgEl = copyBtn.closest('.inbox-msg');
      var src = msgEl && msgEl.querySelector('[data-inbox-copy-source]');
      var text = src ? (src.innerText || src.textContent || '').trim() : '';
      if (!text) return;
      var labelEl = copyBtn.querySelector('[data-inbox-copy-label]');
      var prior = labelEl ? labelEl.textContent : 'Copy';
      var done = function (ok) {
        if (!labelEl) return;
        labelEl.textContent = ok ? 'Copied' : 'Copy failed';
        copyBtn.classList.add(ok ? 'inbox-msg__copy--ok' : 'inbox-msg__copy--err');
        setTimeout(function () {
          labelEl.textContent = prior;
          copyBtn.classList.remove('inbox-msg__copy--ok', 'inbox-msg__copy--err');
        }, 1500);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { done(false); });
        } else {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = false;
          try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
          document.body.removeChild(ta);
          done(ok);
        }
      } catch (_) { done(false); }
      return;
    }

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

    // In-flight guard. A submit that beats the disable to the
    // browsers event loop (rapid double-click, Enter-then-click)
    // gets dropped here so the route never sees the duplicate. The
    // flag clears in the .then/.catch below so a legitimate retry
    // after failure still works.
    if (form.getAttribute('data-inflight') === '1') return;
    form.setAttribute('data-inflight', '1');

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

    // Optimistic UI for the reply path. Without this, the operator
    // clicks Post reply, sees no movement for the network round-
    // trip + LLM kickoff window, and clicks again — producing a
    // duplicate "You" message in the conversation. Echo the message
    // into the timeline immediately, clear the textarea, and dim
    // the placeholder until the real one lands from refresh().
    var isReplyForm = !!action && action.indexOf('/respond') !== -1;
    var pendingEntry = null;
    var savedTextareaValue = '';
    var textarea = null;
    if (isReplyForm) {
      textarea = form.querySelector('textarea[name="body"]')
        || content.querySelector('textarea[name="body"]');
      var body = textarea ? (textarea.value || '').trim() : '';
      if (body) {
        savedTextareaValue = textarea ? textarea.value : '';
        pendingEntry = appendPendingReply(body);
        if (textarea) textarea.value = '';
      }
    }

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
        // refresh() will replace the pending placeholder with the
        // real persisted entry, so no manual cleanup needed.
        form.removeAttribute('data-inflight');
        if (dismissAfter) {
          // Hard reload so the suggestion banner counts, priority
          // group headers, AND favorited rail all stay in sync with
          // the now-terminal row. The prior approach (remove row +
          // close modal) left those counts stale until the operator
          // manually refreshed.
          window.location.reload();
        } else {
          refresh();
        }
      })
      .catch(function () {
        form.removeAttribute('data-inflight');
        for (var i = 0; i < submits.length; i++) submits[i].disabled = false;
        // Rollback the optimistic UI so the operator can edit and
        // retry instead of losing their text.
        if (pendingEntry && pendingEntry.parentNode) {
          pendingEntry.parentNode.removeChild(pendingEntry);
        }
        if (textarea && savedTextareaValue) {
          textarea.value = savedTextareaValue;
        }
      });
  });

  /**
   * Append a "Sending…" placeholder bubble to the conversation
   * timeline. Matches the structure of renderConversationEntry so the
   * CSS styles it like a real user message, plus a data-pending
   * attribute that drives the dimmed appearance. Returns the
   * <li> element so the catch path can remove it on failure.
   */
  function appendPendingReply(bodyText) {
    var ul = content.querySelector('ul.inbox-timeline');
    if (!ul) {
      // The "no replies yet" empty state doesn't render a <ul>; build
      // one so the optimistic append has a home. The fragment refresh
      // will replace this with the canonical server-rendered timeline.
      var section = content.querySelector('.inbox-modal__timeline-section');
      if (!section) return null;
      var emptyP = section.querySelector('p.dim');
      if (emptyP && emptyP.parentNode) emptyP.parentNode.removeChild(emptyP);
      ul = document.createElement('ul');
      ul.className = 'inbox-timeline';
      section.appendChild(ul);
    }
    var li = document.createElement('li');
    li.className = 'inbox-timeline__entry';
    var msg = document.createElement('div');
    msg.className = 'inbox-msg';
    msg.setAttribute('data-pending', '1');
    var avatar = document.createElement('div');
    avatar.className = 'inbox-msg__avatar inbox-msg__avatar--user';
    avatar.textContent = 'You';
    var bodyEl = document.createElement('div');
    bodyEl.className = 'inbox-msg__body';
    var meta = document.createElement('div');
    meta.className = 'inbox-msg__meta';
    var name = document.createElement('span');
    name.className = 'inbox-msg__meta-name';
    name.textContent = 'You';
    var age = document.createElement('span');
    age.textContent = 'Sending…';
    meta.appendChild(name);
    meta.appendChild(age);
    var text = document.createElement('div');
    text.className = 'inbox-msg__text';
    text.textContent = bodyText;
    bodyEl.appendChild(meta);
    bodyEl.appendChild(text);
    msg.appendChild(avatar);
    msg.appendChild(bodyEl);
    li.appendChild(msg);
    ul.appendChild(li);
    // Scroll the optimistic message into view so the operator sees
    // it land.
    requestAnimationFrame(function () {
      content.scrollTop = content.scrollHeight;
    });
    return li;
  }

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
