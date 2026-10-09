/**
 * The inbox's thread view (views/inbox-modal.ts), on every page.
 *
 * Where it shows (panelMode): beside a page as the conversation panel
 * ('docked' | 'wide' | 'min', follows you between pages), or on Home
 * ('page': moved into [data-inbox-split], list and thread side by side).
 *
 * Wires:
 *   - the inbox list (GET /panel/home, /panel/list): tabs, search, Show more,
 *     live refresh on inbox:changed; a row opens its thread
 *   - the thread: fetch /inbox/:id/fragment; Reply / Dismiss / Ask-triage
 *     forms post by fetch, then re-fetch the fragment so the DOM matches state
 *   - live updates on the thread's channel (chat socket, else SSE), with a
 *     fragment poll while sua is replying
 *   - new entries (by data-msg-id) get `.inbox-msg--new` once; auto-scroll
 *     only when you're already near the bottom
 */
export const INBOX_MODAL_JS = `
(function () {
  var modal = document.getElementById('inbox-modal');
  var content = modal && document.getElementById('inbox-modal-content');
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

  // ── Conversation panel ──
  // The same modal, docked to the side instead of centered: Ask sua and
  // Cmd-K open it there, and it follows you between pages (per tab, via
  // sessionStorage). null = the centered modal; otherwise 'docked', 'wide'
  // or 'min' (hidden behind the pill, still live).
  var PANEL_KEY = 'sua-panel';
  // null = closed; 'docked' | 'wide' | 'min' beside a page; 'page' = /inbox,
  // where the same thing fills the page with the list and the thread side by side.
  var panelMode = null;
  // With no thread open, the list column shows the inbox ('home') or a fresh conversation ('new').
  var listView = 'home';
  // The inbox list lives in its own column next to the thread (#inbox-modal-list).
  var listHost = document.getElementById('inbox-modal-list') || content;
  var pageHost = document.querySelector('[data-inbox-split]');
  var panelWantsFocus = false;
  var pill = document.querySelector('[data-panel-restore]');
  function loadPanel() {
    try { return JSON.parse(sessionStorage.getItem(PANEL_KEY) || 'null'); } catch (_) { return null; }
  }
  // Which inbox tab and search the panel's list shows (kept across pages).
  var listState = { tab: '', q: '' };
  (function () { var s = loadPanel(); if (s && s.list) { listState.tab = s.list.tab || ''; listState.q = s.list.q || ''; } })();
  function savePanel(id, mode) {
    if (mode === 'page' || panelMode === 'page') return; // /inbox isn't carried to other pages
    try { sessionStorage.setItem(PANEL_KEY, JSON.stringify({ id: id || null, mode: mode || 'closed', list: listState })); } catch (_) {}
  }
  // Home's full-width list also filters and sorts (not kept across pages).
  var pageFilters = { source: '', agent: '', tag: '', starred: '', sort: '' };
  function listQuery(extra) {
    var p = new URLSearchParams();
    if (listState.tab) p.set('tab', listState.tab);
    if (listState.q) p.set('q', listState.q);
    if (panelMode === 'page') {
      p.set('wide', '1');
      for (var fk in pageFilters) if (pageFilters[fk]) p.set(fk, pageFilters[fk]);
    }
    for (var k in (extra || {})) p.set(k, extra[k]);
    var s = p.toString();
    return s ? '?' + s : '';
  }
  var listPaged = false;
  function refreshPanelList() {
    var host = listHost.querySelector('[data-panel-list]');
    if (!host || (currentId && panelMode !== 'page')) return;
    fetch('/panel/list' + listQuery(), { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) {
        if (!r.ok) throw new Error('panel list ' + r.status);
        var tab = r.headers.get('X-Panel-Tab');
        if (tab && !listState.tab) listState.tab = tab;
        return r.text();
      })
      .then(function (markup) {
        var now = listHost.querySelector('[data-panel-list]');
        if (!now || (currentId && panelMode !== 'page')) return;
        now.innerHTML = markup;
        listPaged = false;
        markSelected();
        syncBulk();
        savePanel(null, panelMode);
        // Home's goal line and history follow the surface version the list shows.
        try { document.dispatchEvent(new CustomEvent('sua:panel-list')); } catch (_) {}
      })
      .catch(function () { /* keep what's shown */ });
  }
  function morePanelRows(btn) {
    btn.disabled = true;
    fetch('/panel/list' + listQuery({ rows: '1', offset: btn.getAttribute('data-offset') || '0' }), { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) {
        if (!r.ok) throw new Error('panel rows ' + r.status);
        var more = r.headers.get('X-Panel-Has-More') === '1';
        return r.text().then(function (markup) { return { markup: markup, more: more }; });
      })
      .then(function (out) {
        var rows = listHost.querySelector('[data-panel-rows]');
        if (!rows) return;
        var added = (rows.querySelectorAll('[data-panel-thread-id]').length);
        rows.insertAdjacentHTML('beforeend', out.markup);
        listPaged = true;
        var next = rows.querySelectorAll('[data-panel-thread-id]').length;
        if (out.more && next > added) { btn.setAttribute('data-offset', String(Number(btn.getAttribute('data-offset') || '0') + (next - added))); btn.disabled = false; }
        else btn.remove();
      })
      .catch(function () { btn.disabled = false; });
  }
  /** On /inbox, the open thread's row is marked in the list. */
  function markSelected() {
    var rows = listHost.querySelectorAll('[data-panel-thread-id]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-panel-thread-id') === currentId) rows[i].setAttribute('aria-current', 'true');
      else rows[i].removeAttribute('aria-current');
    }
  }
  function applyPanel() {
    if (!modal) return;
    var body = document.body;
    body.classList.remove('has-sua-panel', 'has-sua-panel--docked', 'has-sua-panel--wide');
    if (panelMode) {
      modal.setAttribute('data-panel', panelMode);
      modal.setAttribute('aria-modal', 'false');
      modal.setAttribute('aria-label', 'Conversation');
    } else {
      modal.removeAttribute('data-panel');
      modal.setAttribute('aria-modal', 'true');
      modal.removeAttribute('aria-label');
    }
    if (panelMode === 'docked' || panelMode === 'wide') body.classList.add('has-sua-panel', 'has-sua-panel--' + panelMode);
    if (pill) {
      pill.hidden = panelMode !== 'min';
      if (panelMode !== 'min') setPillUnread(false);
    }
    var open = panelMode === 'docked' || panelMode === 'wide';
    var toggles = document.querySelectorAll('[data-panel-toggle]');
    for (var ti = 0; ti < toggles.length; ti++) {
      toggles[ti].classList.toggle('is-active', open);
      toggles[ti].setAttribute('aria-pressed', open ? 'true' : 'false');
    }
    // The bar shows "← Inbox" over a thread and "Inbox" over the list.
    var view = currentId ? 'thread' : listView;
    modal.setAttribute('data-panel-view', view);
    var titleEl = modal.querySelector('[data-panel-title]');
    if (titleEl) titleEl.textContent = view === 'new' ? 'New conversation' : 'Inbox';
    var link = modal.querySelector('[data-panel-inbox]');
    if (link) link.setAttribute('href', currentId ? inboxThreadHref(currentId) : '/inbox');
    var wide = modal.querySelector('[data-panel-wide]');
    if (wide) {
      var label = panelMode === 'wide' ? 'Back to the side' : 'Widen';
      wide.classList.toggle('is-on', panelMode === 'wide');
      wide.setAttribute('aria-label', label);
      wide.setAttribute('title', label);
    }
  }
  function setPillUnread(on) {
    if (!pill) return;
    pill.classList.toggle('is-unread', !!on);
    var text = pill.querySelector('[data-panel-pill-text]');
    if (text) text.textContent = on ? 'New reply' : 'Conversation';
  }
  function setPanelMode(mode) {
    var from = panelMode;
    panelMode = mode;
    if (mode === 'docked' || mode === 'wide') easePanel(from === 'min' || !from);
    applyPanel();
    savePanel(currentId, mode);
  }

  // Motion (DESIGN.md): the panel slides in (ease-out), out (ease-in), and the
  // page eases over to make room (ease-in-out), all under 200ms. Only for
  // things you just did: a panel restored on page load appears in place.
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var easeTimer = null;
  var closeTimer = null;
  function easePanel(enter) {
    if (!modal || reduceMotion) return;
    document.body.classList.add('sua-panel-easing');
    if (enter) {
      modal.classList.remove('is-entering');
      void modal.offsetWidth; // restart the slide-in
      modal.classList.add('is-entering');
    }
    if (easeTimer) clearTimeout(easeTimer);
    easeTimer = setTimeout(function () {
      document.body.classList.remove('sua-panel-easing');
      modal.classList.remove('is-entering');
    }, 260);
  }

  function open() {
    if (!modal) return;
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; modal.classList.remove('is-closing'); }
    modal.hidden = false;
    modal.classList.add('is-open');
    applyPanel();
  }
  function teardownModal() {
    if (!modal) return;
    modal.hidden = true;
    modal.classList.remove('is-open');
    currentId = null;
    seenMsgIds = Object.create(null);
    keepPollingUntil = 0;
    stopPoll();
    closeEventSource();
    if (panelMode) { panelMode = null; applyPanel(); }
  }
  function close(opts) {
    if (!modal) return;
    opts = opts || {};
    if (panelMode === 'page') { deselectPage(); return; }
    if (panelMode) {
      // The panel remembers its thread so Cmd-K brings it back.
      var keep = currentId;
      savePanel(keep, 'closed');
      // Pages showing this thread elsewhere (a notebook's talk box) catch up.
      try { document.dispatchEvent(new CustomEvent('sua:panel-closed', { detail: { threadId: keep } })); } catch (_) {}
      if (panelMode === 'min' || reduceMotion) { teardownModal(); return; }
      easePanel(false);
      document.body.classList.remove('has-sua-panel', 'has-sua-panel--docked', 'has-sua-panel--wide');
      modal.classList.add('is-closing');
      closeTimer = setTimeout(function () {
        closeTimer = null;
        modal.classList.remove('is-closing');
        teardownModal();
      }, 150);
      return;
    }
    teardownModal();
  }

  /** /inbox: put the thread away and show the list on its own. */
  function deselectPage() {
    stopPoll();
    closeEventSource();
    currentId = null;
    seenMsgIds = Object.create(null);
    content.innerHTML = pageEmpty();
    markSelected();
    applyPanel();
    try { window.history.replaceState(null, '', '/inbox'); } catch (_) {}
  }
  function pageEmpty() {
    return '<p class="inbox-split__empty">Pick something on the left to see it here. A conversation opens as a conversation; a failing agent, a draft or a board build shows what happened and what you can do.</p>';
  }

  function inboxThreadHref(id) {
    return '/inbox/' + encodeURIComponent(id);
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
  /**
   * The thread's live channel over the chat WebSocket (lib/chat-socket.ts),
   * shaped like an EventSource so the handlers below work unchanged: each
   * listener gets { data: <json string> }. Reconnect + replay are the socket
   * client's job (it re-subscribes from the last event id it saw).
   */
  function socketSource(messageId) {
    var sock = window.suaSocket;
    var handlers = {};
    var off = sock.subscribe('inbox:' + messageId, function (type, data) {
      var ev = { data: JSON.stringify(data || {}) };
      (handlers[type] || []).forEach(function (fn) { try { fn(ev); } catch (e) { console.error(e); } });
    });
    var statusFn = function (s) { if (s === 'open') (handlers.open || []).forEach(function (fn) { fn(); }); };
    sock.onStatus(statusFn);
    return {
      viaSocket: true,
      addEventListener: function (type, fn) { (handlers[type] || (handlers[type] = [])).push(fn); },
      close: function () { off(); handlers = {}; },
    };
  }

  /** Rows on Home's surface that aren't conversations open as \`item:<id>\`. */
  function isItemId(id) { return typeof id === 'string' && id.indexOf('item:') === 0; }

  function openEventSource(messageId) {
    closeEventSource();
    if (isItemId(messageId)) return;
    var es;
    if (window.suaSocket) {
      es = socketSource(messageId);
    } else {
      if (typeof EventSource === 'undefined') return;
      try {
        es = new EventSource('/inbox/' + encodeURIComponent(messageId) + '/events');
      } catch (_) { return; }
    }
    eventSource = es;
    sseAliveAt = Date.now();

    es.addEventListener('open', function () { sseAliveAt = Date.now(); });
    es.addEventListener('error', function () {
      // EventSource auto-reconnects with Last-Event-ID; we just note
      // the disconnect so the watchdog can decide whether to fall
      // back to the poll.
      sseAliveAt = sseAliveAt || Date.now();
    });

    // Generic handler: any event keeps the watchdog happy and pulls
    // a fresh fragment so the canonical state renders. Specific
    // triage:* event handlers below run BEFORE this — they patch the
    // DOM incrementally for the typewriter reveal, so a refresh
    // happening right after wouldn't be jarring (it's a no-op when
    // the fragment matches the streamed content).
    var onAnyEvent = function () {
      sseAliveAt = Date.now();
      scheduleSseRefresh();
    };

    // triage:started — create the streaming bubble immediately so
    // there's no gap between the witty waiting label and the first
    // token. The bubble is replaced wholesale when the fragment
    // refresh fires after triage:complete.
    es.addEventListener('triage:started', function () {
      sseAliveAt = Date.now();
      // Reset the stream buffer for this new turn so a follow-up
      // doesn't carry the prior bubble's accumulated text.
      streamFullBuffer = '';
      ensureStreamingBubble();
    });
    // triage:token — append the text chunk to the streaming bubble.
    // textContent (not innerHTML) keeps the operator-visible text
    // free of any HTML interpretation; the canonical fragment is
    // server-rendered with the same escaping rules.
    es.addEventListener('triage:token', function (ev) {
      sseAliveAt = Date.now();
      var bubble = ensureStreamingBubble();
      if (!bubble) return;
      var data;
      try { data = JSON.parse(ev.data); } catch (_) { return; }
      var chunk = data && data.chunk;
      if (!chunk) return;
      appendStreamingText(bubble, String(chunk));
    });
    // triage:complete — keep the bubble in place; the watchdog or
    // the canonical fragment refresh (scheduled by onAnyEvent for
    // message:created → fired on triage's addResponse) will swap in
    // the persisted entry so we don't double-render.
    es.addEventListener('triage:complete', function () {
      sseAliveAt = Date.now();
      // Mark "settled" — drop the streaming caret so the bubble looks
      // like a normal finished message between now and the fragment
      // refresh replacing it.
      var bubble = content.querySelector('[data-streaming-bubble]');
      if (bubble) {
        bubble.removeAttribute('data-streaming');
        bubble.setAttribute('data-settled', '1');
      }
      scheduleSseRefresh();
    });

    [
      'state', 'action:created', 'action:status', 'message:created',
    ].forEach(function (t) { es.addEventListener(t, onAnyEvent); });

    // Watchdog: if the channel goes silent past the threshold (no
    // heartbeat or data), we suspect the connection died below the
    // EventSource layer (proxy timeout, sleeping tab). Fall back to
    // the fragment poll until the next real event arrives.
    if (sseWatchdog) clearInterval(sseWatchdog);
    sseWatchdog = setInterval(function () {
      if (!eventSource || currentId !== messageId) return;
      // An open socket is heartbeat-checked server-side; silence is normal.
      if (eventSource.viaSocket && window.suaSocket && window.suaSocket.isOpen()) { sseAliveAt = Date.now(); return; }
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

  /**
   * Create the streaming triage bubble if it doesn't already exist.
   * Returns the .inbox-msg__text element where chunks get appended.
   * Idempotent — multiple triage:started events on a single turn
   * (rare) reuse the same bubble.
   *
   * The thinking indicator (rendered server-side based on the
   * isTriagePending heuristic) is removed when the bubble lands so
   * the operator doesn't see "Triage agent is thinking..." sitting
   * above the streaming reply.
   */
  function ensureStreamingBubble() {
    var existing = content.querySelector('[data-streaming-bubble]');
    if (existing) return existing.querySelector('.inbox-msg__text');

    var ul = timelineList();
    if (!ul) return null;
    // Remove the server-rendered thinking indicator if present —
    // the streaming bubble takes its place.
    var thinking = content.querySelector('.inbox-thinking[data-triage-pending]');
    if (thinking && thinking.parentNode) thinking.parentNode.removeChild(thinking);

    var li = window.suaThread.entry({
      role: 'triage', sigil: 'triage', label: 'sua', writing: 'Writing…', classes: 'inbox-msg--new',
      attrs: { 'data-streaming': '1', 'data-streaming-bubble': '1' },
    });
    var text = li.querySelector('.inbox-msg__text');
    ul.appendChild(li);
    // Only follow the new streaming bubble down if the operator was already at
    // the bottom. If they've scrolled up to read a tall widget, a triage reply
    // starting to stream must not yank them to the bottom.
    var nearBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 80;
    requestAnimationFrame(function () {
      if (nearBottom) content.scrollTop = content.scrollHeight;
    });
    return text;
  }

  // Append text to the streaming bubble. The triage agent's stream
  // is the raw plan envelope (<plan>{ messageId, recommendation,
  // actions }</plan>); the canonical persisted entry shows only the
  // recommendation value (extractPlanJson + addResponse on the
  // server). The streaming bubble must match that view or the
  // operator briefly sees JSON before the fragment refresh.
  //
  // Approach: accumulate every chunk in a full buffer, then on each
  // rAF tick try to extract the recommendation value (handles
  // escaped chars). When found, render JUST the extracted text;
  // when not (model used a different format, or the recommendation
  // key hasn't arrived yet), fall back to the raw streamed text.
  // Throttled to one DOM write per animation frame.
  var streamFullBuffer = '';
  var pendingStreamRaf = null;
  function appendStreamingText(textEl, chunk) {
    streamFullBuffer += chunk;
    if (pendingStreamRaf) return;
    pendingStreamRaf = requestAnimationFrame(function () {
      pendingStreamRaf = null;
      var el = content.querySelector('[data-streaming-bubble] .inbox-msg__text');
      if (!el) return;
      var display = extractRecommendationFromStream(streamFullBuffer);
      if (display === null) display = streamFullBuffer;
      // Re-render the visible text from scratch on each tick — the
      // buffer is small (1 reply at a time) and rebuilding once per
      // frame is cheaper than chasing diffs through escape handling.
      el.textContent = display;
      var nearBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 80;
      if (nearBottom) content.scrollTop = content.scrollHeight;
    });
  }

  /**
   * Extract the triage recommendation string from a partial JSON
   * stream, handling escaped characters. Returns the partial value
   * even before the closing quote arrives (so the typewriter keeps
   * painting as tokens land). Returns null when the
   * recommendation key + opening quote haven't shown up yet — that
   * means either the model is still emitting the envelope preamble
   * (messageId etc.) or the stream isn't a plan envelope at all.
   * The caller falls back to raw text in that case.
   */
  function extractRecommendationFromStream(buffer) {
    var startMatch = buffer.match(/"recommendation"\\s*:\\s*"/);
    if (!startMatch) return null;
    var i = startMatch.index + startMatch[0].length;
    var out = '';
    while (i < buffer.length) {
      var c = buffer.charCodeAt(i);
      if (c === 92 && i + 1 < buffer.length) {
        var nextCh = buffer[i + 1];
        if (nextCh === 'n') out += '\\n';
        else if (nextCh === 't') out += '\\t';
        else if (nextCh === 'r') out += '\\r';
        else if (nextCh === '"') out += '"';
        else if (nextCh === '\\\\') out += '\\\\';
        else if (nextCh === '/') out += '/';
        else if (nextCh === 'u' && i + 5 < buffer.length) {
          var hex = buffer.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          out += nextCh;
        } else {
          out += nextCh;
        }
        i += 2;
      } else if (c === 34 /* dquote */) {
        // Closing quote — recommendation field is complete.
        break;
      } else {
        out += buffer[i];
        i++;
      }
    }
    return out;
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
      if (!firstRender && !seenMsgIds[id]) {
        el.classList.add('inbox-msg--new');
        if (panelMode === 'min') setPillUnread(true);
      }
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
    // An item from Home's surface (\`item:<item id>\`) has its own pane; a thread its conversation.
    var fragUrl = isItemId(id)
      ? '/items/' + encodeURIComponent(id.slice(5)) + '/fragment'
      : '/inbox/' + encodeURIComponent(id) + '/fragment';
    fetch(fragUrl, { credentials: 'same-origin' })
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
        // Preserve the operator's reading position across the DOM swap.
        // Only stick to the bottom if they were ALREADY near it (the chat
        // "follow the latest" pattern). If they've scrolled up — e.g. to read
        // a tall inline widget whose top is above the fold — keep their
        // position instead of yanking them back down on every poll refresh.
        var prevScrollTop = content.scrollTop;
        var wasNearBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 80;
        // Keep what the operator expanded (Details, a diff, the summary) expanded.
        var openKeys = {};
        var wasOpen = content.querySelectorAll('details[open]');
        for (var oi = 0; oi < wasOpen.length; oi++) openKeys[detailsKey(wasOpen[oi])] = true;
        content.innerHTML = text;
        var nowDetails = content.querySelectorAll('details');
        for (var ni = 0; ni < nowDetails.length; ni++) {
          if (openKeys[detailsKey(nowDetails[ni])]) nowDetails[ni].setAttribute('open', '');
        }
        applyAnimations();
        if (wasNearBottom) {
          scrollToBottom();
        } else {
          content.scrollTop = prevScrollTop;
        }
        // The panel sits beside a page you may be using: it takes focus only
        // when you just opened it, not on every refresh or page restore.
        if (!panelMode) focusFirstInteractive();
        else if (panelWantsFocus && panelMode !== 'min') { panelWantsFocus = false; focusFirstInteractive(); }
        maybeSchedulePoll();
      })
      .catch(function () { /* swallow; user can close + retry */ });
  }

  /**
   * True if the operator is actively interacting with the modal — they
   * have a non-empty text selection anchored inside it (highlighting
   * text to copy), or they are typing into a non-empty field. In
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
  /** Identifies a <details> across a fragment swap: the message it belongs to + its class. */
  function detailsKey(d) {
    var msg = d.closest && d.closest('[data-msg-id]');
    return (msg ? msg.getAttribute('data-msg-id') : '') + '|' + (d.className || '');
  }

  function userIsInteracting() {
    // An open ⋯ menu is a choice in progress: a swap would close it under the pointer.
    if (content.querySelector('details[data-inbox-menu][open]')) return true;
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
      } else if (tag === 'SELECT') {
        return true;
      } else if (active.isContentEditable) {
        return true;
      } else {
        // Focused buttons/links after a click must NOT block refreshes
        // indefinitely or the thread will appear stuck on "thinking".
        // Fall through to the selection check below.
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
    // preventScroll: focusing the composer (at the bottom) must NOT scroll the
    // thread — it would override the scroll-position preservation in refresh()
    // and yank an operator reading a tall widget back down to the textarea.
    var ta = content.querySelector('textarea[name="body"]');
    if (ta && !ta.disabled) { ta.focus({ preventScroll: true }); return; }
    var btn = content.querySelector('button:not([disabled]), a');
    if (btn) btn.focus({ preventScroll: true });
  }

  function openFor(id, opts) {
    if (!modal) return;
    opts = opts || {};
    // Where it shows: an explicit panel mode, else wherever the thread
    // view already is (a thread opened from the panel stays in the panel;
    // from the minimized panel, it comes back docked).
    var panelWasShowing = !modal.hidden && (panelMode === 'docked' || panelMode === 'wide') && !closeTimer;
    if (opts.panel) panelMode = opts.panel;
    else if (!panelMode || panelMode === 'min') panelMode = 'docked';
    if ((panelMode === 'docked' || panelMode === 'wide') && !panelWasShowing && !opts.restore) easePanel(true);
    currentId = id;
    if (panelMode === 'page') {
      markSelected();
      if (!isItemId(id)) { try { window.history.replaceState(null, '', inboxThreadHref(id)); } catch (_) {} }
    }
    if (panelMode) savePanel(id, panelMode);
    panelWantsFocus = !opts.restore;
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
  // Overflow (⋯) actions menu uses native <details>, which stays open
  // until toggled. Close any open menu when the click lands outside it
  // so it behaves like a normal popover. (Acting on a menu item submits
  // an AJAX form that refresh()es the fragment, which closes it anyway.)
  document.addEventListener('click', function (e) {
    var menus = document.querySelectorAll('details[data-inbox-menu][open]');
    for (var i = 0; i < menus.length; i++) {
      var menu = menus[i];
      if (!menu.contains(e.target)) menu.removeAttribute('open');
    }
  });

  document.addEventListener('click', function (e) {
    // Copy-message button on a conversation entry. Reads the
    // sibling .inbox-msg__text textContent so we copy what the
    // operator actually sees (newlines preserved, HTML stripped).
    // ⋯ → Copy link: the thread's full address, for pasting elsewhere.
    var linkBtn = e.target.closest && e.target.closest('[data-inbox-copy-link]');
    if (linkBtn) {
      e.preventDefault();
      var url = window.location.origin + linkBtn.getAttribute('data-inbox-copy-link');
      var said = function (ok) {
        linkBtn.textContent = ok ? 'Link copied' : 'Copy failed';
        setTimeout(function () { linkBtn.textContent = 'Copy link'; var m = linkBtn.closest('details'); if (m) m.removeAttribute('open'); }, 900);
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { said(true); }, function () { said(false); });
        else said(false);
      } catch (_) { said(false); }
      return;
    }
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

    var panelToggle = e.target.closest && e.target.closest('[data-panel-toggle]');
    if (panelToggle) { e.preventDefault(); togglePanel(); return; }

    var panelCtl = e.target.closest && e.target.closest('[data-panel-wide], [data-panel-min], [data-panel-restore], [data-panel-new], [data-panel-back], [data-panel-tab], [data-panel-more], [data-panel-thread-id], [data-panel-ask], [data-panel-inbox]');
    if (panelCtl) {
      if (panelCtl.hasAttribute('data-panel-inbox')) {
        // Leaving for the thread's own page: close the panel so it doesn't
        // show the same thread twice there. The link navigates as usual.
        if (panelMode) close();
        return;
      }
      e.preventDefault();
      if (panelCtl.hasAttribute('data-panel-wide')) setPanelMode(panelMode === 'wide' ? 'docked' : 'wide');
      else if (panelCtl.hasAttribute('data-panel-min')) setPanelMode('min');
      else if (panelCtl.hasAttribute('data-panel-restore')) {
        if (currentId) { setPanelMode('docked'); focusFirstInteractive(); } else openPanelHome();
      }
      else if (panelCtl.hasAttribute('data-panel-back') && panelMode === 'page') deselectPage();
      else if (panelCtl.hasAttribute('data-panel-new')) openPanelNew();
      else if (panelCtl.hasAttribute('data-panel-back')) openPanelHome();
      else if (panelCtl.hasAttribute('data-panel-tab')) {
        listState.tab = panelCtl.getAttribute('data-panel-tab') || '';
        var tabs = listHost.querySelectorAll('[data-panel-tab]');
        for (var ti2 = 0; ti2 < tabs.length; ti2++) tabs[ti2].setAttribute('aria-selected', tabs[ti2] === panelCtl ? 'true' : 'false');
        refreshPanelList();
      }
      else if (panelCtl.hasAttribute('data-panel-more')) morePanelRows(panelCtl);
      else if (panelCtl.hasAttribute('data-panel-thread-id')) openFor(panelCtl.getAttribute('data-panel-thread-id'));
      else if (panelCtl.hasAttribute('data-panel-ask')) {
        // In a new conversation the pill fills the reply box; in the list it
        // fills the search field as an ask (Enter or the ask row sends it).
        var ta = listHost.querySelector('[data-panel-composer]') || listHost.querySelector('[data-panel-search]');
        if (ta) {
          ta.value = panelCtl.getAttribute('data-panel-ask') || '';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.focus();
        }
      }
      return;
    }

    if (e.target.closest && e.target.closest('[data-inbox-modal-close]')) {
      close();
    }
  });


  document.addEventListener('keydown', function (e) {
    if (!modal || e.key !== 'Escape' || modal.hidden) return;
    // Esc in a search with text clears the search first (handled below), not the drawer.
    var ae = document.activeElement;
    if (ae && ae.hasAttribute && ae.hasAttribute('data-panel-search') && ae.value) return;
    // The panel isn't modal: Esc closes it only from inside it.
    if (panelMode === 'page' || panelMode === 'min' || !modal.contains(document.activeElement)) return;
    close();
  });

  // Intercept Reply / Dismiss / Triage form submits inside the modal.
  document.addEventListener('submit', function (e) {
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

    // Respect a submit button's formaction so one form can drive multiple
    // routes (e.g. the thread-actions Fork/Retarget buttons share one select).
    var submitter = e.submitter || null;
    var action = (submitter && submitter.getAttribute('formaction')) || form.getAttribute('action');
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
        if (textarea) { textarea.value = ''; textarea.style.height = 'auto'; }
      }
    }

    // Replies go over the chat socket when it's connected (same server-side
    // path as POST /respond); everything else, and the no-socket case, posts.
    var actionParts = String(action || '').split('?')[0].split('/'); // ['', 'inbox', '<id>', 'respond']
    var replyThread = isReplyForm && pendingEntry && actionParts[1] === 'inbox' && actionParts[3] === 'respond' ? actionParts[2] : null;
    var sending = replyThread && window.suaSocket && window.suaSocket.isOpen()
      ? window.suaSocket.request({ type: 'inbox.send', threadId: decodeURIComponent(replyThread), text: (formData.get('body') || '').toString() })
      : fetch(action, {
          method: method,
          credentials: 'same-origin',
          body: new URLSearchParams(Array.from(formData.entries())).toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'fetch',
          },
        }).then(function (r) {
          if (!r.ok) throw new Error('mutation failed: ' + r.status);
        });
    sending
      .then(function () {
        // refresh() will replace the pending placeholder with the
        // real persisted entry, so no manual cleanup needed.
        form.removeAttribute('data-inflight');
        if (dismissAfter) {
          // The thread is finished: back to the list (it drops out of Open).
          if (panelMode === 'page') { deselectPage(); refreshPanelList(); }
          else openPanelHome();
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
          textarea.style.height = 'auto';
          textarea.style.height = Math.min(textarea.scrollHeight, Math.floor(window.innerHeight * 0.4)) + 'px';
        }
      });
  });

  // ── Home hero composer ────────────────────────────────────────────────
  // The front-door "Ask sua" input. Submitting POSTs /inbox/new WITH the first
  // message (so the thread is born seeded + triage fires server-side), then
  // opens the returned thread in-modal — the SSE stream shows triage answering
  // immediately. Degrades to a full-page POST→redirect without JS.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-home-ask')) return;
    e.preventDefault();
    var input = form.querySelector('[data-home-ask-input]');
    var sendBtn = form.querySelector('[data-home-ask-send]');
    var bodyText = input ? String(input.value).trim() : '';
    if (!bodyText) { if (input) input.focus(); return; }
    if (form.getAttribute('data-inflight') === '1') return;
    form.setAttribute('data-inflight', '1');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
    fetch('/inbox/new', {
      method: 'POST',
      credentials: 'same-origin',
      body: new URLSearchParams(withPage({ body: bodyText })).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
    })
      .then(function (r) { if (!r.ok) throw new Error('create failed: ' + r.status); return r.headers.get('X-Inbox-Id'); })
      .then(function (newId) {
        if (input) { input.value = ''; input.style.height = 'auto'; }
        // The ask landed as a thread — drop the persisted draft (see APP_ASK_JS).
        try { localStorage.removeItem('sua-ask-draft'); } catch (e) {}
        // Asking sua opens the answer in the panel, docked beside the page.
        if (newId) openFor(newId, { panel: panelMode === 'wide' ? 'wide' : 'docked' });
      })
      .catch(function (err) { console.error('inbox /new failed', err); })
      .then(function () {
        form.removeAttribute('data-inflight');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send ↵'; }
      });
  });
  // Enter submits (Shift+Enter = newline); textarea auto-grows with content.
  document.addEventListener('keydown', function (e) {
    var ta = e.target.closest && e.target.closest('[data-home-ask-input]');
    if (!ta) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var form = ta.closest('[data-home-ask]');
      if (form && form.requestSubmit) form.requestSubmit();
      else if (form) form.submit();
    }
  });
  document.addEventListener('input', function (e) {
    var ta = e.target.closest && e.target.closest('[data-home-ask-input], [data-inbox-autogrow]');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, Math.floor(window.innerHeight * 0.4)) + 'px';
  });

  /**
   * The thread list, made when the "no replies yet" empty state has none
   * (the fragment refresh replaces it with the server-rendered timeline).
   */
  function timelineList() {
    var section = content.querySelector('.inbox-modal__timeline-section');
    if (!section) return content.querySelector('ul.inbox-timeline');
    var emptyP = section.querySelector(':scope > p.dim');
    if (emptyP && !section.querySelector('ul.inbox-timeline') && emptyP.parentNode) emptyP.parentNode.removeChild(emptyP);
    return window.suaThread.list(section);
  }

  /**
   * Append a "Sending…" placeholder bubble to the conversation timeline:
   * the shared thread row (thread.js.ts), plus a data-pending attribute
   * that drives the dimmed appearance. Returns the <li> element so the
   * catch path can remove it on failure.
   */
  function appendPendingReply(bodyText) {
    var ul = timelineList();
    if (!ul) return null;
    var li = window.suaThread.entry({
      role: 'user', sigil: 'you', label: 'You', writing: 'Sending…', text: bodyText,
      attrs: { 'data-pending': '1' },
    });
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

  // ── Tag pills inside the modal (add / remove with quiet submit) ──
  // The remove buttons + the Add-tag input live in the rendered
  // fragment; we delegate on the modal element since the fragment
  // refreshes after every save.
  document.addEventListener('click', function (e) {
    var rm = e.target.closest && e.target.closest('[data-inbox-tag-remove]');
    if (!rm) return;
    e.preventDefault();
    e.stopPropagation();
    var tag = rm.getAttribute('data-inbox-tag-remove');
    var hidden = content.querySelector('[data-inbox-tags-input]');
    if (!hidden) return;
    var current = String(hidden.value).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var next = current.filter(function (t) { return t !== tag; });
    hidden.value = next.join(', ');
    var form = hidden.form;
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  });
  document.addEventListener('keydown', function (e) {
    // Chat-bar reply: plain Enter sends, Shift+Enter is a newline. Scoped
    // to [data-inbox-chat-enter] so the older multiline composers keep
    // their Cmd/Ctrl+Enter contract below.
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      var chatTa = e.target.closest && e.target.closest('[data-inbox-chat-enter]');
      if (chatTa) {
        var chatForm = chatTa.closest('[data-inbox-modal-form]');
        if (chatForm) {
          e.preventDefault();
          if (chatForm.requestSubmit) chatForm.requestSubmit();
          else chatForm.submit();
          return;
        }
      }
    }
    // Cmd+Enter (Mac) or Ctrl+Enter submits the reply composer / inline
    // reply / triage form the textarea lives in. Plain Enter still
    // inserts a newline.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      var ta = e.target.closest && e.target.closest('textarea[name="body"]');
      if (ta) {
        var replyForm = ta.closest('[data-inbox-modal-form]');
        if (replyForm) {
          e.preventDefault();
          if (replyForm.requestSubmit) replyForm.requestSubmit();
          else replyForm.submit();
          return;
        }
      }
    }
    var add = e.target.closest && e.target.closest('[data-inbox-tag-add]');
    if (!add) return;
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var raw = String(add.value).trim().toLowerCase();
    if (!raw) return;
    var hidden = content.querySelector('[data-inbox-tags-input]');
    if (!hidden) return;
    var current = String(hidden.value).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (current.indexOf(raw) === -1) current.push(raw);
    hidden.value = current.join(', ');
    add.value = '';
    var form = hidden.form;
    if (form && form.requestSubmit) form.requestSubmit();
    else if (form) form.submit();
  });
  /** The panel with no thread: start one, or pick up a recent one. */
  function openPanelHome(opts) {
    if (!modal) return;
    var restoring = !!(opts && opts.restore);
    var panelWasShowing = !modal.hidden && (panelMode === 'docked' || panelMode === 'wide') && !closeTimer;
    if (!panelMode || panelMode === 'min') panelMode = 'docked';
    if (!panelWasShowing && !restoring) easePanel(true);
    stopPoll();
    closeEventSource();
    currentId = null;
    listView = 'home';
    seenMsgIds = Object.create(null);
    listHost.innerHTML = '<p class="dim" style="margin:0;padding:var(--space-4) 0;text-align:center;">Loading…</p>';
    if (panelMode === 'page') content.innerHTML = pageEmpty();
    open();
    savePanel(null, panelMode);
    fetch('/panel/home' + listQuery(), { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { if (!r.ok) throw new Error('panel home ' + r.status); return r.text(); })
      .then(function (markup) {
        if (!panelMode || (currentId !== null && panelMode !== 'page')) return;
        listHost.innerHTML = markup;
        listPaged = false;
        markSelected();
        applyPanel();
        labelKeys();
        var field = listHost.querySelector('[data-panel-search]');
        if (field && panelMode !== 'min' && panelMode !== 'page' && !restoring) field.focus();
      })
      .catch(function () {
        listHost.innerHTML = '<p class="dim" style="margin:0;padding:var(--space-4) 0;text-align:center;">Couldn’t load. Close the panel and try again.</p>';
      });
  }

  /** Cmd-K: open the panel (its last thread, or a new one), or close it. */
  function togglePanel() {
    if (!modal) return;
    if (panelMode === 'page') {
      var box = listHost.querySelector('[data-panel-search]');
      if (box) box.focus();
      return;
    }
    if ((panelMode === 'docked' || panelMode === 'wide') && !closeTimer) { close(); return; }
    if (panelMode === 'min') {
      if (currentId) { setPanelMode('docked'); focusFirstInteractive(); } else openPanelHome();
      return;
    }
    var saved = loadPanel();
    if (saved && saved.id) openFor(saved.id, { panel: 'docked' });
    else openPanelHome();
  }

  // Search the panel's inbox as you type.
  var searchTimer = null;
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-panel-search')) return;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { listState.q = String(el.value || '').trim(); refreshPanelList(); }, 250);
  });
  // Keep the list current while it's showing (inbox-stream.js.ts relays the
  // inbox's change events). Not after "Show more", which would lose your place.
  var liveTimer = null;
  window.addEventListener('inbox:changed', function () {
    if (!panelMode || panelMode === 'min' || (currentId && panelMode !== 'page') || listPaged || selectedIds().length) return;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(refreshPanelList, 500);
  });

  // ── Home's full-width list: filters, stars, selection + bulk actions ──
  function selectedIds() {
    var boxes = listHost.querySelectorAll('[data-panel-select]:checked');
    var ids = [];
    for (var i = 0; i < boxes.length; i++) ids.push(boxes[i].value);
    return ids;
  }
  function syncBulk() {
    var bar = listHost.querySelector('[data-panel-bulk]');
    if (!bar) return;
    var n = selectedIds().length;
    var all = listHost.querySelectorAll('[data-panel-select]').length;
    bar.hidden = n === 0;
    var count = bar.querySelector('[data-panel-bulk-count]');
    if (count) count.textContent = n + ' selected';
    var master = bar.querySelector('[data-panel-select-all]');
    if (master) { master.checked = n > 0 && n === all; master.indeterminate = n > 0 && n < all; }
  }
  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
      body: new URLSearchParams(body).toString(),
    });
  }
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !listHost.contains(el)) return;
    var key = el.getAttribute && el.getAttribute('data-panel-filter');
    if (key) {
      pageFilters[key] = el.type === 'checkbox' ? (el.checked ? '1' : '') : String(el.value || '');
      refreshPanelList();
      return;
    }
    if (el.hasAttribute('data-panel-select-all')) {
      var boxes = listHost.querySelectorAll('[data-panel-select]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = el.checked;
      syncBulk();
      return;
    }
    if (el.hasAttribute('data-panel-select')) syncBulk();
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest || !listHost.contains(t)) return;
    var clear = t.closest('[data-panel-filter-clear]');
    if (clear) {
      pageFilters = { source: '', agent: '', tag: '', starred: '', sort: '' };
      var fields = listHost.querySelectorAll('[data-panel-filter]');
      for (var i = 0; i < fields.length; i++) { if (fields[i].type === 'checkbox') fields[i].checked = false; else fields[i].value = ''; }
      refreshPanelList();
      return;
    }
    var star = t.closest('button[data-panel-star]');
    if (star) {
      e.preventDefault();
      var on = star.getAttribute('aria-pressed') !== 'true';
      star.setAttribute('aria-pressed', on ? 'true' : 'false');
      star.classList.toggle('is-on', on);
      post('/inbox/' + encodeURIComponent(star.getAttribute('data-panel-star')) + '/star', { starred: on ? '1' : '0' })
        .then(function (r) { if (!r.ok) throw new Error('star ' + r.status); })
        .catch(function () { star.setAttribute('aria-pressed', on ? 'false' : 'true'); star.classList.toggle('is-on', !on); });
      return;
    }
    if (t.closest('[data-panel-bulk-clear]')) {
      var boxes2 = listHost.querySelectorAll('[data-panel-select]');
      for (var j = 0; j < boxes2.length; j++) boxes2[j].checked = false;
      syncBulk();
      return;
    }
    var act = t.closest('[data-panel-bulk-action]');
    if (act) {
      var ids = selectedIds();
      if (!ids.length) return;
      var kind = act.getAttribute('data-panel-bulk-action') === 'dismiss' ? 'dismiss' : 'resolve';
      act.disabled = true;
      post('/inbox/bulk-' + kind, { ids: ids.join(',') })
        .then(function () {
          if (currentId && ids.indexOf(currentId) !== -1 && panelMode === 'page') deselectPage();
          var bar = listHost.querySelector('[data-panel-bulk]');
          if (bar) bar.hidden = true;
          refreshPanelList();
        })
        .catch(function () { /* the list stays as it was */ })
        .then(function () { act.disabled = false; });
    }
  });

  // "Ask sua to fix this" (agent page): start the fix conversation and open it
  // in the panel, beside the agent you're looking at.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-ask-fix')) return;
    e.preventDefault();
    var btn = form.querySelector('button');
    if (btn) btn.disabled = true;
    // The form's own fields (e.g. what to change) go along as a normal form post.
    var askBody = new URLSearchParams(new FormData(form)).toString();
    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: askBody
    })
      .then(function (r) {
        // "Next" from an option's page: the server says where to go, no conversation.
        var to = r.headers.get('X-Navigate');
        if (r.ok && to && to.charAt(0) === '/' && to.charAt(1) !== '/') { window.location.assign(to); return; }
        var id = r.headers.get('X-Inbox-Id');
        if (!r.ok || !id) throw new Error('ask-fix ' + r.status);
        var text = form.querySelector('textarea, input[type=text]');
        if (text) text.value = '';
        // On Home the conversation opens beside the list; elsewhere, in the drawer.
        openFor(id, { panel: panelMode === 'page' ? 'page' : panelMode === 'wide' ? 'wide' : 'docked' });
      })
      .catch(function () { form.submit(); })
      .then(function () { if (btn) btn.disabled = false; });
  });

  /** Shortcut labels name this keyboard's key (lists load after page load, so call again then). */
  function labelKeys() {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')) return;
    var keys = document.querySelectorAll('[data-panel-key]');
    for (var ki = 0; ki < keys.length; ki++) keys[ki].textContent = 'Ctrl K';
  }

  /** "+": a fresh conversation in the list column (GET /panel/new). */
  function openPanelNew() {
    if (!modal) return;
    if (!panelMode || panelMode === 'min') panelMode = 'docked';
    stopPoll();
    closeEventSource();
    currentId = null;
    listView = 'new';
    open();
    fetch('/panel/new', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { if (!r.ok) throw new Error('panel new ' + r.status); return r.text(); })
      .then(function (markup) {
        if (currentId !== null || listView !== 'new') return;
        listHost.innerHTML = markup;
        applyPanel();
        var box = listHost.querySelector('[data-panel-composer]');
        if (box) box.focus();
      })
      .catch(function () { openPanelHome(); });
  }

  /**
   * The page you're on goes with a new conversation, so "this dashboard" or
   * "this agent" means the one you're looking at (server: pageContextFrom).
   */
  function withPage(fields) {
    fields.page = window.location.pathname;
    fields.pageTitle = (document.title || '').slice(0, 120);
    return fields;
  }

  /** The search field asks sua on Enter: a new conversation with that text, opened here. */
  function askFromSearch(text) {
    text = String(text || '').trim();
    if (!text) return;
    fetch('/inbox/new', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
      body: new URLSearchParams(withPage({ body: text })).toString(),
    })
      .then(function (r) { var id = r.headers.get('X-Inbox-Id'); if (!r.ok || !id) throw new Error('ask ' + r.status); return id; })
      .then(function (id) {
        listState.q = '';
        openFor(id, panelMode === 'page' ? { panel: 'page' } : {});
      })
      .catch(function () { /* the text stays in the field to retry */ });
  }
  function syncAskRow(text) {
    var row = listHost.querySelector('[data-panel-askrow]');
    if (!row) return;
    var t = String(text || '').trim();
    row.hidden = !t;
    // The suggestions make way while you type.
    var suggest = listHost.querySelector('[data-panel-suggest]');
    if (suggest) suggest.hidden = !!t;
    var slot = row.querySelector('[data-panel-askrow-text]');
    if (slot) slot.textContent = t;
  }
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el && el.hasAttribute && el.hasAttribute('data-panel-search')) syncAskRow(el.value);
  });
  document.addEventListener('keydown', function (e) {
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-panel-search')) return;
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); askFromSearch(el.value); }
    else if (e.key === 'Escape' && el.value) { e.stopPropagation(); el.value = ''; syncAskRow(''); listState.q = ''; refreshPanelList(); }
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-panel-refresh]')) {
      // An explicit refresh starts the list over (back to the first page).
      listPaged = false;
      refreshPanelList();
      return;
    }
    var row = e.target.closest && e.target.closest('[data-panel-askrow]');
    if (!row) return;
    var field = listHost.querySelector('[data-panel-search]');
    askFromSearch(field ? field.value : '');
  });

  // An item pane's actions (Run it again, Make it active): post in place,
  // say what happened, and refresh the list so the item moves or goes.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-item-act')) return;
    e.preventDefault();
    var btn = form.querySelector('button');
    var pane = form.closest('[data-item-pane]');
    var status = pane && pane.querySelector('[data-item-status]');
    if (btn) btn.disabled = true;
    fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) {
        if (!r.ok) throw new Error('act ' + r.status);
        // An action that settles the item (making a draft active): no more buttons to press.
        if (pane && form.hasAttribute('data-item-resolves')) {
          var acts = pane.querySelector('.item-pane__actions');
          if (acts) acts.innerHTML = '';
          pane.classList.add('is-done');
        }
        if (status) {
          status.textContent = form.getAttribute('data-item-done') || 'Done.';
          // A run: link to it.
          var at = r.url.indexOf('/runs/');
          if (at >= 0) {
            var a = document.createElement('a');
            a.href = r.url.slice(at);
            a.textContent = ' See the run';
            status.appendChild(a);
          }
        }
        refreshPanelList();
      })
      .catch(function () {
        if (status) status.textContent = 'That didn\u2019t work. Try again, or open the page from the links above.';
        if (btn) btn.disabled = false;
      });
  });

  window.suaPanel = {
    toggle: togglePanel,
    // Re-read the list (Home's Today tab after a gesture changed its surface).
    refreshList: function () { refreshPanelList(); },
    home: function () { openPanelHome(); },
    open: function (id) { openFor(id, { panel: panelMode === 'wide' ? 'wide' : 'docked' }); },
    isPanel: function () { return !!panelMode; },
  };

  // The top-bar opener names the shortcut for this keyboard.
  labelKeys();

  // /inbox: the inbox fills the page, list and thread side by side.
  if (modal && pageHost) {
    pageHost.appendChild(modal);
    panelMode = 'page';
    if (pill) pill.hidden = true;
    var first = pageHost.getAttribute('data-initial-thread');
    openPanelHome({ restore: true });
    if (first) openFor(first, { panel: 'page', restore: true });
  }

  // Bring the panel back as it was on the last page.
  (function restorePanel() {
    if (!modal || pageHost) return;
    var saved = loadPanel();
    if (!saved || !saved.mode || saved.mode === 'closed') return;
    if (saved.mode !== 'docked' && saved.mode !== 'wide' && saved.mode !== 'min') return;
    // Its own page shows the thread already.
    if (saved.id && window.location.pathname === inboxThreadHref(saved.id)) return;
    // A page with its own conversation (a notebook) brings an open panel to it.
    var pageThread = document.querySelector('[data-page-thread]');
    var own = pageThread && pageThread.getAttribute('data-page-thread');
    if (own && (saved.mode === 'docked' || saved.mode === 'wide')) { openFor(own, { panel: saved.mode, restore: true }); return; }
    if (saved.id) openFor(saved.id, { panel: saved.mode, restore: true });
    else if (saved.mode === 'min') { panelMode = 'min'; applyPanel(); }
    else { panelMode = saved.mode; openPanelHome({ restore: true }); }
  })();
})();
`;
