/**
 * A notebook's page (views/notebooks.ts): "Continue the conversation" opens
 * its thread in the sua drawer, and the sections update as sua (or the
 * pipeline) files new entries, without a reload, unless you're typing there.
 */
export const NOTEBOOK_PAGE_JS = `
  (function () {
    // The notebooks list: changing the sort applies it.
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (el && el.matches && el.matches('select[data-autosubmit]') && el.form) el.form.submit();
    });
    // The header's actions: one open at a time; Escape or a click outside closes it.
    var acts = document.querySelectorAll('[data-nb-act]');
    for (var ai = 0; ai < acts.length; ai++) {
      acts[ai].addEventListener('toggle', function (e) {
        var d = e.target;
        if (!d.open) return;
        for (var j = 0; j < acts.length; j++) if (acts[j] !== d) acts[j].open = false;
        var first = d.querySelector('textarea, input[type="text"]');
        if (first) setTimeout(function () { first.focus(); }, 0);
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      for (var j = 0; j < acts.length; j++) if (acts[j].open) { acts[j].open = false; acts[j].querySelector('summary').focus(); }
    });
    document.addEventListener('click', function (e) {
      for (var j = 0; j < acts.length; j++) if (acts[j].open && !acts[j].contains(e.target)) acts[j].open = false;
    });
    // Decide…: an option chip starts the answer with it.
    document.addEventListener('click', function (e) {
      var pick = e.target.closest && e.target.closest('[data-nb-decide-pick]');
      if (!pick) return;
      var ta = document.getElementById('nb-decision');
      if (!ta) return;
      ta.value = pick.getAttribute('data-nb-decide-pick') + ta.value.replace(/^Chose [^:]*: /, '');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    // An option's own page: its checklist saves the tick, then the page reloads.
    var optionPage = document.querySelector('[data-nb-option]');
    if (optionPage) {
      document.addEventListener('a2ui-action', function (e) {
        var d = e.detail || {};
        if (d.name !== 'notebook-option' || !d.context || d.context.op !== 'check') return;
        var body = new URLSearchParams();
        body.set('item', d.context.item || '');
        body.set('done', d.context.done ? '1' : '0');
        var url = '/notebooks/' + encodeURIComponent(optionPage.getAttribute('data-nb-option-notebook')) + '/entries/' + encodeURIComponent(optionPage.getAttribute('data-nb-option')) + '/check';
        fetch(url, { method: 'POST', credentials: 'same-origin', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' }, body: body.toString() })
          .then(function () { location.reload(); }, function () { location.reload(); });
      });
      return;
    }
    var main = document.querySelector('[data-nb-main]');
    if (!main) return;
    var id = main.getAttribute('data-nb-main');
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-nb-continue]');
      if (!btn || !window.suaPanel) return;
      e.preventDefault();
      window.suaPanel.open(btn.getAttribute('data-nb-continue'));
    });
    // Tell sua: Enter sends (like the drawer's reply box), Shift+Enter is a new line;
    // Cmd/Ctrl+Enter sends too.
    document.addEventListener('keydown', function (e) {
      var ta = e.target;
      if (!ta || ta.tagName !== 'TEXTAREA' || !ta.hasAttribute('data-enter-sends')) return;
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (!ta.value.trim()) return;
      var form = ta.form;
      if (form && form.requestSubmit) form.requestSubmit(); else if (form) form.submit();
    });
    var count = Number(main.getAttribute('data-nb-count')) || 0;
    var changed = main.getAttribute('data-nb-changed') || '';
    // The widgets' Move / Rule out / Bring back: save it, then redraw.
    var base = '/notebooks/' + encodeURIComponent(id) + '/entries/';
    document.addEventListener('a2ui-action', function (e) {
      var d = e.detail || {};
      if (d.name !== 'notebook-option' || !d.context || !d.context.id) return;
      var c = d.context;
      var path = c.op === 'move' ? 'stage' : c.op === 'ruleOut' || c.op === 'gone' ? 'rule-out' : c.op === 'reinstate' ? 'reinstate' : c.op === 'check' ? 'check' : '';
      if (!path) return;
      var body = new URLSearchParams();
      if (c.op === 'check') { body.set('item', c.item || ''); body.set('done', c.done ? '1' : '0'); }
      if (c.op === 'gone') body.set('gone', '1');
      if (c.stage) body.set('stage', c.stage);
      if (c.reason) body.set('reason', c.reason);
      fetch(base + encodeURIComponent(c.id) + '/' + path, { method: 'POST', credentials: 'same-origin', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' }, body: body.toString() })
        .then(function () { refresh(true); })
        .catch(function () { refresh(true); });
    });
    function refresh(force) {
      if (!force && document.visibilityState !== 'visible') return;
      var ae = document.activeElement;
      if (ae && main.contains(ae) && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return;
      fetch('/notebooks/' + encodeURIComponent(id) + '/main', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          var n = Number(r.headers.get('X-Notebook-Entries')) || 0;
          var ch = r.headers.get('X-Notebook-Changed') || '';
          var hint = r.headers.get('X-Notebook-Hint');
          var ph = r.headers.get('X-Notebook-Placeholder');
          return r.text().then(function (t) { return { n: n, ch: ch, t: t, hint: hint, ph: ph }; });
        })
        .then(function (res) {
          // The talk box's hint and ghost text follow the notebook's next step.
          try {
            var labels = document.querySelectorAll('.nb-talk__next');
            for (var i = 0; i < labels.length; i++) if (res.hint) labels[i].textContent = decodeURIComponent(res.hint);
            var boxes = document.querySelectorAll('.nb-talk__form textarea');
            for (var j = 0; j < boxes.length; j++) if (res.ph) boxes[j].setAttribute('placeholder', decodeURIComponent(res.ph));
          } catch (_) { /* keep what's shown */ }
          if (res.n === count && res.ch === changed) return;
          var wasEmpty = count === 0;
          count = res.n;
          changed = res.ch;
          main.setAttribute('data-nb-count', String(count));
          // The first entries also bring the conversation box to the side: reload once.
          if (wasEmpty) { window.location.reload(); return; }
          main.innerHTML = res.t;
        })
        .catch(function () { /* keep what's shown */ });
    }
    setInterval(refresh, 5000);
    // Closing the sua panel on this notebook's thread: what was said there shows here now.
    document.addEventListener('sua:panel-closed', function (e) {
      var tid = e.detail && e.detail.threadId;
      if (!tid) return;
      var ours = document.querySelectorAll('[data-nb-continue]');
      var match = ours.length === 0; // no thread yet: the panel may have just started one
      for (var i = 0; i < ours.length; i++) if (ours[i].getAttribute('data-nb-continue') === tid) match = true;
      if (!match) return;
      refresh(true);
      var talk = document.querySelector('.nb-talk');
      if (!talk) return;
      var ae = document.activeElement;
      if (ae && talk.contains(ae)) return; // typing there: leave it
      fetch('/notebooks/' + encodeURIComponent(id), { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
        .then(function (t) {
          var fresh = new DOMParser().parseFromString(t, 'text/html').querySelector('.nb-talk');
          var now = document.querySelector('.nb-talk');
          if (fresh && now) now.replaceWith(document.importNode(fresh, true));
        })
        .catch(function () { /* keep what's shown */ });
    });
  })();
`;
