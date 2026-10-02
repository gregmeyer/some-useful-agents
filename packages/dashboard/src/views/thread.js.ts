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
    avatar.setAttribute('aria-label', o.label || o.sigil);
    avatar.textContent = o.sigil;
    var body = document.createElement('div');
    body.className = 'inbox-msg__body';
    var meta = document.createElement('div');
    meta.className = 'inbox-msg__meta';
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

  window.suaThread = { list: list, entry: entry };
})();
`;
