/**
 * Agent Chat tab, live (WS1). When the chat WebSocket is available:
 * sending posts the message over the socket instead of a form submit, the
 * reply streams in as it's produced (model text, tool calls), and when the
 * turn ends the transcript is re-rendered from source (`?fragment=transcript`).
 * Without a socket, the plain form + reload-until-done path is untouched.
 */
export const AGENT_CHAT_JS = `
(function () {
  var form = document.querySelector('form[data-chat-live]');
  if (!form || !window.suaSocket) return;
  var sock = window.suaSocket;
  var agentId = form.getAttribute('data-agent-id');
  var sessionId = form.getAttribute('data-session-id') || '';
  var runId = form.getAttribute('data-pending-run') || '';
  var input = form.querySelector('textarea');
  var button = form.querySelector('button[type=submit]');
  var host = document.getElementById('agent-chat-transcript');
  var base = '/agents/' + encodeURIComponent(agentId) + '/chat';
  var subscribed = '';
  var startedHere = false; // a conversation created on this page (sidebar + title need a full render)
  var liveRaw = ''; // the reply's text so far, widget blocks included

  // The reply's words without its widget blocks (closed ones, and one still being written).
  function visibleText(raw) {
    var t = raw.replace(/<a2ui>[\\s\\S]*?<\\/a2ui>/gi, '');
    var open = t.lastIndexOf('<a2ui>');
    if (open >= 0) t = t.slice(0, open);
    return t.replace(/<a2?u?i?$/i, '');
  }
  // Draw (or redraw) the reply's index-th widget from its A2UI messages.
  function drawWidget(index, messages) {
    var slot = host.querySelector('[data-chat-live-widgets]');
    if (!slot) return;
    var id = 'chat-live-' + runId + '-' + index;
    var el = document.createElement('div');
    el.className = 'a2ui-host';
    el.setAttribute('data-a2ui-surface', '');
    el.setAttribute('data-surface-id', id);
    el.setAttribute('data-live-widget', String(index));
    var script = document.createElement('script');
    script.type = 'application/json';
    script.textContent = JSON.stringify(messages);
    el.appendChild(script);
    var old = slot.querySelector('[data-live-widget="' + index + '"]');
    if (old) old.replaceWith(el); else slot.appendChild(el);
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function setBusy(busy) {
    if (input) input.disabled = busy;
    if (button) { button.disabled = busy; button.textContent = busy ? 'Waiting…' : 'Send ↵'; }
  }
  // A streaming reply stays in view until you scroll up to read (thread.js.ts); the page is what scrolls.
  var tail = window.suaThread && window.suaThread.follow ? window.suaThread.follow(null) : null;
  function scrollEnd() {
    if (tail && !tail.following()) return;
    var t = host && host.querySelector('.agent-chat__transcript');
    if (t && t.lastElementChild) t.lastElementChild.scrollIntoView({ block: 'end' });
  }
  function liveSlots() {
    return { text: host.querySelector('[data-chat-live-text]'), tools: host.querySelector('[data-chat-live-tools]') };
  }
  function refresh() {
    if (!sessionId) return;
    fetch(base + '?session=' + encodeURIComponent(sessionId) + '&fragment=transcript', { credentials: 'same-origin' })
      .then(function (r) { var p = r.headers.get('X-Chat-Pending') === '1'; return r.text().then(function (h) { return { h: h, p: p }; }); })
      .then(function (x) {
        host.innerHTML = x.h; scrollEnd();
        if (!x.p) {
          runId = '';
          if (startedHere) { location.replace(base + '?session=' + encodeURIComponent(sessionId)); return; }
          setBusy(false); if (input) input.focus();
        }
      })
      .catch(function () { location.reload(); });
  }
  function onEvent(type, data) {
    if (runId && data && data.runId && data.runId !== runId) return; // an earlier turn's replay
    var slots = liveSlots();
    if (type === 'token' && slots.text) {
      liveRaw += data.text;
      slots.text.textContent = visibleText(liveRaw);
      scrollEnd();
    } else if (type === 'widget' && data && data.messages) {
      drawWidget(data.index, data.messages);
      scrollEnd();
    } else if (type === 'tool' && slots.tools) {
      if (data.status === 'call') {
        var li = document.createElement('li');
        li.className = 'agent-chat__tool';
        li.innerHTML = '<span class="mono">→ ' + esc(data.name) + '</span>' + (data.preview ? ' <span class="dim">' + esc(data.preview) + '</span>' : '');
        slots.tools.appendChild(li);
      } else if (data.isError && slots.tools.lastElementChild) {
        slots.tools.lastElementChild.classList.add('is-error');
      }
      scrollEnd();
    } else if (type === 'turn-start' && data && data.streaming === false) {
      // Durable backend: no live progress; poll the transcript instead.
      (function poll() { setTimeout(function () { if (runId) { refresh(); poll(); } }, 3000); })();
    } else if (type === 'turn-end') {
      refresh();
    }
  }
  function watch(sid, since) {
    var ch = 'session:' + sid;
    if (subscribed === ch) return;
    subscribed = ch;
    sock.subscribe(ch, onEvent, { since: since });
  }

  // A reply already in progress (page loaded mid-turn): replay its events.
  sock.onStatus(function (s) {
    if (s === 'open' && window.__suaChatReload) { clearTimeout(window.__suaChatReload); window.__suaChatReload = null; }
  });
  if (sessionId && runId) watch(sessionId, -1);
  else sock.connect();

  // One turn: show the message, send the frame, claim the conversation's
  // events. Used by the composer and by widget clicks (A2UI actions).
  function startTurn(frame, displayText) {
    setBusy(true);
    liveRaw = '';
    var list = host.querySelector('.agent-chat__transcript');
    if (!list) { host.innerHTML = ''; list = window.suaThread.list(host, 'agent-chat__transcript'); }
    // The shared thread rows (thread.js.ts): your message, then the reply as it streams.
    list.appendChild(window.suaThread.entry({ role: 'user', sigil: 'you', label: 'You', text: displayText }));
    list.appendChild(window.suaThread.entry({
      role: 'agent', sigil: 'agent', label: 'Agent', writing: 'Working…',
      html: '<ul class="agent-chat__live-tools" data-chat-live-tools></ul><div class="agent-chat__live-text" data-chat-live-text></div><div class="agent-chat__live-widgets" data-chat-live-widgets></div>',
    }));
    if (tail) tail.reset();
    scrollEnd();
    // The server subscribes this connection to the conversation before the
    // turn starts; adopt() claims those events (incl. ones that beat the reply).
    sock.request(frame)
      .then(function (r) {
        runId = r.runId;
        if (!sessionId) {
          startedHere = true;
          sessionId = r.sessionId;
          form.setAttribute('data-session-id', sessionId);
          var hidden = form.querySelector('input[name=session]');
          if (!hidden) { hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = 'session'; form.appendChild(hidden); }
          hidden.value = sessionId;
          try { history.replaceState(null, '', base + '?session=' + encodeURIComponent(sessionId)); } catch (err) {}
        }
        var ch = 'session:' + sessionId;
        if (subscribed !== ch) { subscribed = ch; sock.adopt(ch, onEvent); }
      })
      .catch(function (err) {
        setBusy(false);
        list.insertAdjacentHTML('beforeend', '<li class="inbox-timeline__entry"><p class="flash flash--error" style="margin: 0;">' + esc(err.message) + '</p></li>');
      });
  }

  form.addEventListener('submit', function (e) {
    var text = input ? input.value.trim() : '';
    if (!text) return;
    e.preventDefault();
    input.value = '';
    startTurn({ type: 'chat.send', agentId: agentId, sessionId: sessionId || undefined, text: text }, text);
  });

  // A click in a reply's widget (button, choice) is the next message. The
  // server turns the action into text (its context.message, else "▸ name").
  host.addEventListener('a2ui-action', function (e) {
    var action = e.detail || {};
    if (!sessionId || runId || (button && button.disabled)) return; // mid-turn: ignore
    var ctx = action.context || {};
    var display = typeof ctx.message === 'string' && ctx.message ? ctx.message : '▸ ' + (action.name || 'action');
    startTurn({ type: 'chat.action', agentId: agentId, sessionId: sessionId, action: { name: action.name, context: ctx } }, display);
  });
})();
`;
