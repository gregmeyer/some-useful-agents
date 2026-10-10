/**
 * New notebook (views/notebook-new.ts): Draft it asks sua for a draft and
 * polls until it's ready; the draft's chips can be changed, removed or
 * added; "Change it" redrafts with what you asked; Skip starts it with
 * just your sentence. The draft is kept on the server: the address becomes
 * /notebooks/new?draft=<id> (so Back or a reload returns to it), and your
 * changes to it are saved as you make them. The sentence you're still
 * typing is kept in this browser.
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
    var TEXT_KEY = 'sua-nbd-text';
    function setId(id) {
      root.setAttribute('data-nbd-id', id);
      try { history.replaceState(null, '', '/notebooks/new?draft=' + encodeURIComponent(id)); } catch (_) {}
    }
    // The sentence you were typing, if you left before drafting it.
    if (!root.hasAttribute('data-nbd-id') && !text.value) {
      try { var kept = localStorage.getItem(TEXT_KEY); if (kept) text.value = kept; } catch (_) {}
    }
    text.addEventListener('input', function () {
      try { if (text.value.trim()) localStorage.setItem(TEXT_KEY, text.value); else localStorage.removeItem(TEXT_KEY); } catch (_) {}
    });
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
        .then(function (id) {
          setId(id);
          try { localStorage.removeItem(TEXT_KEY); } catch (_) {}
          poll(id, 0);
        })
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
    // Changes to the draft are kept as you make them (POST …/edits).
    var saveTimer = null;
    function saveSoon() {
      var form = root.querySelector('[data-nbd-draft]');
      if (!form) return;
      var note = form.querySelector('[data-nbd-saved]');
      if (note) note.textContent = 'Saving\u2026';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        fetch('/notebooks/draft/' + encodeURIComponent(form.getAttribute('data-nbd-draft')) + '/edits', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
          body: new URLSearchParams(new FormData(form)).toString()
        }).then(function (r) { if (note) note.textContent = r.ok ? 'Draft saved' : 'Couldn\u2019t save the draft'; })
          .catch(function () { if (note) note.textContent = 'Couldn\u2019t save the draft'; });
      }, 600);
    }
    root.addEventListener('input', function (e) { if (e.target.closest && e.target.closest('[data-nbd-draft]') && !e.target.hasAttribute('data-nbd-change-text')) saveSoon(); });
    root.addEventListener('change', function (e) { if (e.target.closest && e.target.closest('[data-nbd-draft]')) saveSoon(); });
    // Back to a draft sua was still working on.
    if (root.hasAttribute('data-nbd-resume')) { busy = true; if (go) go.disabled = true; poll(root.getAttribute('data-nbd-id'), 1); }
    ask.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!text.value.trim()) { text.focus(); return; }
      // Drafting the sentence again replaces the draft you're on, rather than leaving it behind.
      var body = { text: text.value };
      if (root.getAttribute('data-nbd-id')) body.replace = root.getAttribute('data-nbd-id');
      draft(body, 'sua is drafting your notebook\\u2026 this takes a few seconds.');
    });
    // Enter drafts; Shift+Enter is a new line.
    text.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (ask.requestSubmit) ask.requestSubmit(); else ask.dispatchEvent(new Event('submit', { cancelable: true })); }
    });
    root.addEventListener('click', function (e) {
      var x = e.target.closest && e.target.closest('[data-nbd-remove]');
      if (x) { e.preventDefault(); var c = x.closest('.nbd-chip, .nbd-row'); if (c) c.remove(); saveSoon(); return; }
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
    // Suggestion pills: one fills the box; while sua is still finding them, check back.
    root.addEventListener('click', function (e) {
      var pill = e.target.closest && e.target.closest('[data-nbd-pill]');
      if (!pill) return;
      e.preventDefault();
      text.value = pill.getAttribute('data-nbd-pill');
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
    });
    var pills = root.querySelector('[data-nbd-pills]');
    if (pills && pills.hasAttribute('data-nbd-pills-refreshing')) {
      var tries = 0;
      var check = setInterval(function () {
        if (++tries > 40) { clearInterval(check); return; }
        fetch('/notebooks/suggestions', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (j.refreshing) return; clearInterval(check); pills.innerHTML = j.html; })
          .catch(function () {});
      }, 3000);
    }
    var skip = root.querySelector('[data-nbd-skip]');
    if (skip) skip.addEventListener('submit', function (e) {
      if (!text.value.trim()) { e.preventDefault(); text.focus(); return; }
      skip.querySelector('[data-nbd-skip-text]').value = text.value;
    });
  })();
`;
