/**
 * New notebook (views/notebook-new.ts): Draft it asks sua for a draft and
 * polls until it's ready; the draft's chips can be changed, removed or
 * added; "Change it" redrafts with what you asked; Skip starts it with
 * just your sentence.
 */
export const NOTEBOOK_NEW_JS = `
  (function () {
    var root = document.querySelector('[data-nbd]');
    if (!root) return;
    var ask = root.querySelector('[data-nbd-ask]');
    var text = root.querySelector('[data-nbd-text]');
    var result = root.querySelector('[data-nbd-result]');
    var go = root.querySelector('[data-nbd-go]');
    var busy = false;
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'; }); }
    function working(msg) {
      result.innerHTML = '<p class="nbd-working" role="status"><span class="nbd-working__dot" aria-hidden="true"></span>' + esc(msg) + '</p>';
    }
    function draft(body, msg) {
      if (busy) return;
      busy = true;
      if (go) go.disabled = true;
      working(msg);
      fetch('/notebooks/draft', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch', 'Accept': 'application/json' },
        body: new URLSearchParams(body).toString()
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'That didn\\u2019t work.'); return j.id; }); })
        .then(function (id) { poll(id, 0); })
        .catch(function (err) { done(); result.innerHTML = '<p class="flash flash--error">' + esc(err.message) + '</p>'; });
    }
    function done() { busy = false; if (go) { go.disabled = false; go.textContent = 'Draft again'; } }
    function poll(id, n) {
      if (n > 90) { done(); result.innerHTML = '<p class="flash flash--error">sua is taking too long. Try again.</p>'; return; }
      setTimeout(function () {
        fetch('/notebooks/draft/' + encodeURIComponent(id), { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.status === 'working') { poll(id, n + 1); return; }
            done();
            if (j.status === 'ready') {
              result.innerHTML = j.html;
              var t = result.querySelector('.nbd-draft__titleinput');
              if (t) t.focus();
            } else result.innerHTML = '<p class="flash flash--error">' + esc(j.error || 'sua couldn\\u2019t draft it.') + '</p>';
          })
          .catch(function () { poll(id, n + 1); });
      }, n === 0 ? 1200 : 1500);
    }
    ask.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!text.value.trim()) { text.focus(); return; }
      draft({ text: text.value }, 'sua is drafting your notebook\\u2026 this takes a few seconds.');
    });
    // Enter drafts; Shift+Enter is a new line.
    text.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (ask.requestSubmit) ask.requestSubmit(); else ask.dispatchEvent(new Event('submit', { cancelable: true })); }
    });
    root.addEventListener('click', function (e) {
      var x = e.target.closest && e.target.closest('[data-nbd-remove]');
      if (x) { e.preventDefault(); var c = x.closest('.nbd-chip, .nbd-row'); if (c) c.remove(); return; }
      var add = e.target.closest && e.target.closest('[data-nbd-add]');
      if (add) {
        e.preventDefault();
        var name = add.getAttribute('data-nbd-add');
        var label = add.getAttribute('data-nbd-add-label') || '';
        var wrap = document.createElement('span');
        wrap.className = add.hasAttribute('data-nbd-add-row') ? 'nbd-row' : 'nbd-chip';
        wrap.innerHTML = (add.hasAttribute('data-nbd-add-row') ? '<span class="nbd-row__box" aria-hidden="true">\\u2610</span>' : '')
          + '<input name="' + esc(name) + '" aria-label="' + esc(label) + '" size="8" data-nbd-grow>'
          + '<button type="button" class="nbd-chip__x" data-nbd-remove aria-label="Remove">\\u00d7</button>';
        add.parentNode.insertBefore(wrap, add);
        wrap.querySelector('input').focus();
        return;
      }
      var ch = e.target.closest && e.target.closest('[data-nbd-change]');
      if (ch) {
        e.preventDefault();
        var form = ch.closest('[data-nbd-draft]');
        var what = root.querySelector('[data-nbd-change-text]');
        if (!form || !what || !what.value.trim()) { if (what) what.focus(); return; }
        draft({ text: text.value, from: form.getAttribute('data-nbd-draft'), change: what.value }, 'sua is changing the draft\\u2026');
      }
    });
    root.addEventListener('input', function (e) {
      var el = e.target;
      if (el && el.hasAttribute && el.hasAttribute('data-nbd-grow')) el.size = Math.max(4, Math.min(40, el.value.length + 1));
    });
    // Enter in the change box asks for the change rather than starting the notebook.
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target.hasAttribute || !e.target.hasAttribute('data-nbd-change-text')) return;
      e.preventDefault();
      var b = root.querySelector('[data-nbd-change]');
      if (b) b.click();
    });
    var skip = root.querySelector('[data-nbd-skip]');
    if (skip) skip.addEventListener('submit', function (e) {
      if (!text.value.trim()) { e.preventDefault(); text.focus(); return; }
      skip.querySelector('[data-nbd-skip-text]').value = text.value;
    });
  })();
`;
