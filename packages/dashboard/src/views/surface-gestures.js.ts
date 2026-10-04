/**
 * Changing Home's Today tab by hand (goal surfaces S4): a row's ⋯ menu
 * (pin, move up/down, hide), dragging a row within its region, and the hidden
 * list's Show / Stop this rule. Each posts surface ops (routes/surfaces.ts),
 * refreshes the list, and shows a bar with Undo and, when there's a clear
 * one, "Make this a rule?".
 */
export const SURFACE_GESTURES_JS = `
  (function () {
    var lastUndo = null;
    var toastTimer = null;

    function surfaceOf(el) { return el && el.closest ? el.closest('[data-surface]') : null; }
    function version(el) { var s = surfaceOf(el); return s ? Number(s.getAttribute('data-surface-version')) : undefined; }
    function refreshList() { if (window.suaPanel && window.suaPanel.refreshList) window.suaPanel.refreshList(); }

    /** Rows in this row's region that can move (not pinned), in order. */
    function movable(li) {
      var list = li.closest('[data-panel-group]');
      if (!list) return [];
      return Array.prototype.filter.call(list.querySelectorAll(':scope > li[data-item-id]'), function (x) { return !x.hasAttribute('data-pinned'); });
    }

    function toast(host, html, keep) {
      var bar = host && host.closest('[data-panel-home]') ? host.closest('[data-panel-home]').querySelector('[data-surface-toast]') : document.querySelector('[data-surface-toast]');
      if (!bar) return;
      bar.innerHTML = html;
      bar.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      if (!keep) toastTimer = setTimeout(function () { bar.hidden = true; }, 12000);
    }
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'; });
    }

    function post(path, body) {
      return fetch(path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', 'Accept': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
    }

    function send(host, ops, said, extra) {
      var body = { ops: ops, reason: said, expectedVersion: version(host) };
      if (extra) { body.itemId = extra.itemId; body.gesture = extra.gesture; }
      return post('/surfaces/home/ops', body).then(function (res) {
        if (res.status === 409) { refreshList(); toast(host, 'Home changed in the meantime; it\\u2019s up to date now. Try again.'); return; }
        if (!res.ok) { toast(host, esc(res.body.error || 'That didn\\u2019t work.')); return; }
        lastUndo = res.body.undoTo;
        refreshList();
        var out = esc(said) + ' <button type="button" class="surface-toast__btn" data-surface-undo>Undo</button>';
        if (res.body.suggestion) {
          window.__suaSuggestion = res.body.suggestion;
          out += '<span class="surface-toast__ask">' + esc(res.body.suggestion.question)
            + ' <button type="button" class="surface-toast__btn surface-toast__btn--primary" data-surface-make-rule>Make it a rule</button></span>';
        }
        toast(host, out, !!res.body.suggestion);
      }).catch(function () { toast(host, 'That didn\\u2019t work. Check your connection and try again.'); });
    }

    document.addEventListener('click', function (e) {
      var opBtn = e.target.closest && e.target.closest('[data-surface-op]');
      if (opBtn) {
        e.preventDefault();
        var li = opBtn.closest('[data-item-id]');
        if (!li) return;
        var id = li.getAttribute('data-item-id');
        var title = li.getAttribute('data-item-title') || 'it';
        var op = opBtn.getAttribute('data-surface-op');
        var menu = opBtn.closest('details');
        if (menu) menu.removeAttribute('open');
        if (op === 'pin') send(li, [{ op: 'pin', itemId: id }], 'Pinned \\u201c' + title + '\\u201d to the top.', { itemId: id, gesture: 'pin' });
        else if (op === 'unpin') send(li, [{ op: 'unpin', itemId: id }], 'Unpinned \\u201c' + title + '\\u201d.');
        else if (op === 'hide') send(li, [{ op: 'hide', itemId: id }], 'Hid \\u201c' + title + '\\u201d from Home.', { itemId: id, gesture: 'hide' });
        else if (op === 'show') send(li, [{ op: 'show', itemId: id }], 'Showing \\u201c' + title + '\\u201d again.');
        else if (op === 'remove-rule') send(li, [{ op: 'removeRule', ruleId: opBtn.getAttribute('data-rule-id') }], 'Stopped the rule that hid \\u201c' + title + '\\u201d.');
        else if (op === 'up' || op === 'down') {
          var rows = movable(li);
          var at = rows.indexOf(li);
          var to = op === 'up' ? at - 1 : at + 1;
          if (at < 0 || to < 0 || to >= rows.length) return;
          send(li, [{ op: 'rank', itemId: id, position: to }], 'Moved \\u201c' + title + '\\u201d ' + op + '.', op === 'up' ? { itemId: id, gesture: 'up' } : undefined);
        }
        return;
      }
      if (e.target.closest && e.target.closest('[data-surface-undo]')) {
        if (lastUndo == null) return;
        var host = e.target.closest('[data-surface-toast]');
        post('/surfaces/home/restore', { toVersion: lastUndo }).then(function (res) {
          lastUndo = null;
          refreshList();
          toast(host, res.ok ? 'Undone.' : esc(res.body.error || 'Couldn\\u2019t undo.'));
        });
        return;
      }
      if (e.target.closest && e.target.closest('[data-surface-make-rule]')) {
        var s = window.__suaSuggestion;
        if (!s) return;
        window.__suaSuggestion = null;
        send(e.target, [s.op], 'Made a rule: ' + (s.op.rule.label || s.op.rule.id) + '.');
      }
    });

    // Drag a row within its region to rank it there.
    var dragging = null;
    document.addEventListener('dragstart', function (e) {
      var li = e.target.closest && e.target.closest('[data-surface] li[data-item-id][draggable]');
      if (!li || li.hasAttribute('data-pinned')) return;
      dragging = li;
      li.classList.add('is-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', li.getAttribute('data-item-id')); } catch (_) {}
    });
    document.addEventListener('dragover', function (e) {
      if (!dragging) return;
      var over = e.target.closest && e.target.closest('li[data-item-id]');
      if (!over || over === dragging || over.parentNode !== dragging.parentNode || over.hasAttribute('data-pinned')) return;
      e.preventDefault();
      var r = over.getBoundingClientRect();
      var after = e.clientY > r.top + r.height / 2;
      over.parentNode.insertBefore(dragging, after ? over.nextSibling : over);
    });
    document.addEventListener('dragend', function () {
      if (!dragging) return;
      var li = dragging;
      dragging = null;
      li.classList.remove('is-dragging');
      var to = movable(li).indexOf(li);
      if (to < 0) return;
      send(li, [{ op: 'rank', itemId: li.getAttribute('data-item-id'), position: to }], 'Moved \\u201c' + (li.getAttribute('data-item-title') || 'it') + '\\u201d.', to === 0 ? { itemId: li.getAttribute('data-item-id'), gesture: 'up' } : undefined);
    });
  })();
`;
