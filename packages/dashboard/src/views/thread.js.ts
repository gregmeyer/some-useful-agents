/**
 * Client twin of the shared thread component (thread.ts). Builds the same
 * row markup for rows the page adds before the server re-renders: your
 * message while it sends, and a reply while it streams.
 *
 *   suaThread.list(host, className)  → the host's ul.inbox-timeline (made if missing)
 *   suaThread.entry(opts)            → li.inbox-timeline__entry, not yet attached
 *     opts: { role, sigil, label, writing, text, html, attrs, classes }
 *     `text` is set as textContent; `html` is trusted markup (static only).
 *   entry.querySelector('.inbox-msg__text') is where streamed text goes.
 */
export const THREAD_JS = `
(function () {
  function list(host, className) {
    var ul = host.querySelector('ul.inbox-timeline');
    if (ul) return ul;
    ul = document.createElement('ul');
    ul.className = 'inbox-timeline' + (className ? ' ' + className : '');
    host.appendChild(ul);
    return ul;
  }

  function entry(o) {
    var li = document.createElement('li');
    li.className = 'inbox-timeline__entry';
    var msg = document.createElement('div');
    msg.className = 'inbox-msg inbox-msg--' + o.role + (o.classes ? ' ' + o.classes : '');
    var attrs = o.attrs || {};
    Object.keys(attrs).forEach(function (k) { msg.setAttribute(k, attrs[k]); });
    var avatar = document.createElement('div');
    avatar.className = 'inbox-msg__avatar inbox-msg__avatar--' + o.role;
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = o.role === 'user' ? 'Y' : o.role === 'triage' ? 's' : String(o.label || o.sigil || '?').charAt(0).toUpperCase();
    var body = document.createElement('div');
    body.className = 'inbox-msg__body';
    var meta = document.createElement('div');
    meta.className = 'inbox-msg__meta';
    var who = document.createElement('span');
    who.className = 'inbox-msg__who';
    who.textContent = o.label || o.sigil;
    meta.appendChild(who);
    if (o.writing) {
      var w = document.createElement('span');
      w.className = 'inbox-msg__writing';
      w.textContent = o.writing;
      meta.appendChild(w);
    }
    var text = document.createElement('div');
    text.className = 'inbox-msg__text';
    if (o.html) text.innerHTML = o.html;
    else if (o.text) text.textContent = o.text;
    body.appendChild(meta);
    body.appendChild(text);
    msg.appendChild(avatar);
    msg.appendChild(body);
    li.appendChild(msg);
    return li;
  }

  /**
   * Keep a streaming reply in view without fighting you: it follows the
   * bottom until you scroll up (wheel, touch, keys or the scrollbar), and
   * picks up again once you scroll back down to the end. \`el\` is the
   * scrolling box; none means the page.
   */
  function follow(el) {
    var page = !el;
    var box = function () { return el || document.scrollingElement || document.documentElement; };
    var on = true, lastTop = box().scrollTop, inputAt = 0, held = false;
    var gap = function () { var b = box(); return b.scrollHeight - b.scrollTop - (page ? window.innerHeight : b.clientHeight); };
    var target = page ? window : el;
    var mark = function () { inputAt = Date.now(); };
    target.addEventListener('wheel', function (e) { mark(); if (e.deltaY < 0) on = false; }, { passive: true });
    target.addEventListener('touchmove', mark, { passive: true });
    target.addEventListener('pointerdown', function () { held = true; mark(); });
    window.addEventListener('pointerup', function () { held = false; });
    window.addEventListener('keydown', function (e) { if (/^(PageUp|ArrowUp|Home)$/.test(e.key)) mark(); });
    target.addEventListener('scroll', function () {
      var t = box().scrollTop;
      var byYou = held || Date.now() - inputAt < 500;
      if (byYou && t < lastTop - 1) on = false;
      else if (gap() < 24) on = true;
      lastTop = t;
    }, { passive: true });
    return {
      stick: function () { if (on) { var b = box(); b.scrollTop = b.scrollHeight; } },
      // Follow again (you sent something, or opened another conversation); stick() then scrolls.
      reset: function () { on = true; },
      following: function () { return on; },
    };
  }

  window.suaThread = { list: list, entry: entry, follow: follow };
})();
`;
