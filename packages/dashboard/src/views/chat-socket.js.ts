/**
 * Client for the dashboard's chat WebSocket (lib/chat-socket.ts). Exposes
 * `window.suaSocket`, opened lazily by the first page that uses it (agent
 * Chat today; the inbox thread next), so other pages hold no socket.
 *
 *   suaSocket.subscribe(channel, onEvent, { since })  → unsubscribe()
 *   suaSocket.request(frame)                          → Promise<reply frame>
 *   suaSocket.onStatus(fn)                            fn('open' | 'closed')
 *
 * Reconnects with backoff (1s → 15s) and re-subscribes each channel from the
 * last event id it saw, so a dropped connection loses nothing still in the
 * server's buffer.
 */
export const CHAT_SOCKET_JS = `
(function () {
  if (typeof WebSocket === 'undefined') return;
  var ws = null, open = false, backoff = 1000, closedByPage = false, nextRef = 1;
  var channels = {};   // channel -> { listeners: [fn], lastId: number|undefined }
  var pending = {};    // ref -> { resolve, reject, timer }
  var statusFns = [];
  var queue = [];
  // Events for a channel the page hasn't claimed yet (a new conversation's
  // first events can beat the chat.started reply). Drained by adopt().
  var orphans = {};

  function emitStatus(s) { statusFns.forEach(function (fn) { try { fn(s); } catch (e) {} }); }
  function rawSend(frame) {
    if (open) { try { ws.send(JSON.stringify(frame)); return; } catch (e) {} }
    queue.push(frame);
    connect();
  }
  function subscribeFrame(channel) {
    var c = channels[channel];
    var f = { type: 'subscribe', channel: channel };
    if (c && typeof c.lastId === 'number') f.since = c.lastId;
    else if (c && typeof c.since === 'number') f.since = c.since;
    return f;
  }
  function connect() {
    if (ws || closedByPage) return;
    var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    try { ws = new WebSocket(url); } catch (e) { ws = null; return; }
    ws.onopen = function () {
      open = true; backoff = 1000; emitStatus('open');
      Object.keys(channels).forEach(function (ch) { ws.send(JSON.stringify(subscribeFrame(ch))); });
      var q = queue; queue = [];
      q.forEach(function (f) { ws.send(JSON.stringify(f)); });
    };
    ws.onmessage = function (m) {
      var f; try { f = JSON.parse(m.data); } catch (e) { return; }
      if (f.type === 'event') {
        var c = channels[f.channel];
        if (!c) {
          var o = orphans[f.channel] || (orphans[f.channel] = []);
          if (o.length < 500) o.push(f);
          return;
        }
        if (typeof c.lastId === 'number' && f.id <= c.lastId) return; // replay overlap
        c.lastId = f.id;
        c.listeners.forEach(function (fn) { try { fn(f.event, f.data, f.id); } catch (e) { console.error(e); } });
        return;
      }
      if (f.ref && pending[f.ref]) {
        var p = pending[f.ref]; delete pending[f.ref]; clearTimeout(p.timer);
        if (f.type === 'error') p.reject(new Error(f.message)); else p.resolve(f);
      } else if (f.type === 'error') {
        console.warn('[sua socket]', f.message);
      }
    };
    ws.onclose = function () {
      var wasOpen = open; open = false; ws = null;
      if (wasOpen) emitStatus('closed');
      if (closedByPage) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000);
    };
    ws.onerror = function () { /* onclose follows */ };
  }
  window.addEventListener('pagehide', function () { closedByPage = true; try { ws && ws.close(); } catch (e) {} });

  window.suaSocket = {
    isOpen: function () { return open; },
    connect: connect,
    onStatus: function (fn) { statusFns.push(fn); },
    subscribe: function (channel, fn, opts) {
      var c = channels[channel];
      if (!c) {
        c = channels[channel] = { listeners: [], lastId: undefined, since: opts && typeof opts.since === 'number' ? opts.since : undefined };
        rawSend(subscribeFrame(channel));
      }
      c.listeners.push(fn);
      return function () {
        c.listeners = c.listeners.filter(function (x) { return x !== fn; });
        if (!c.listeners.length) { delete channels[channel]; rawSend({ type: 'unsubscribe', channel: channel }); }
      };
    },
    // Mark a channel as subscribed server-side already (chat.send does that),
    // so a reconnect re-subscribes it from the last id seen.
    adopt: function (channel, fn) {
      var c = channels[channel] || (channels[channel] = { listeners: [], lastId: undefined });
      c.listeners.push(fn);
      var o = orphans[channel]; delete orphans[channel];
      (o || []).forEach(function (f) {
        if (typeof c.lastId === 'number' && f.id <= c.lastId) return;
        c.lastId = f.id;
        try { fn(f.event, f.data, f.id); } catch (e) { console.error(e); }
      });
    },
    request: function (frame) {
      return new Promise(function (resolve, reject) {
        var ref = 'r' + (nextRef++);
        frame.ref = ref;
        pending[ref] = { resolve: resolve, reject: reject, timer: setTimeout(function () {
          delete pending[ref]; reject(new Error('No reply from the server.'));
        }, 20000) };
        rawSend(frame);
      });
    },
  };
})();
`;
