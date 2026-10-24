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
        var first = d.querySelector('[data-nb-decide] input[name="chosen"], textarea, input[type="text"]');
        if (first) setTimeout(function () { first.focus(); }, 0);
      });
    }
    // A step's Pick… / Narrow…: open that header panel.
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-nb-open-act]') : null;
      if (!b) return;
      var d = document.querySelector('[data-nb-act-name="' + b.getAttribute('data-nb-open-act') + '"]');
      if (!d) return;
      e.stopPropagation();
      d.open = true;
      d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      for (var j = 0; j < acts.length; j++) if (acts[j].open) { acts[j].open = false; acts[j].querySelector('summary').focus(); }
    });
    document.addEventListener('click', function (e) {
      for (var j = 0; j < acts.length; j++) if (acts[j].open && !acts[j].contains(e.target)) acts[j].open = false;
    });
    // Decide…: the count of picks, the button that says what it does, and
    // "Pick the top N". With nothing picked, the why box is the decision.
    function decideSync(form) {
      var boxes = form.querySelectorAll('input[name="chosen"]');
      var n = 0;
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) n++;
      var target = Number(form.getAttribute('data-target')) || 0;
      var narrow = form.getAttribute('data-nb-mode') === 'narrow';
      var word = narrow ? ' kept' : ' picked';
      var count = form.querySelector('[data-nb-decide-count]');
      if (count) {
        count.textContent = target ? n + ' of ' + target + word : n + word;
        count.classList.toggle('is-over', target > 0 && n > target);
        count.classList.toggle('is-met', target > 0 && n === target);
      }
      var why = form.querySelector('textarea[name="decision"]');
      var btn = form.querySelector('[data-nb-decide-submit]');
      if (narrow) {
        // Keep at least one; the rest are ruled out.
        var out = (Number(form.getAttribute('data-total')) || boxes.length) - n;
        if (btn) { btn.disabled = n === 0; btn.textContent = n === 0 ? 'Keep these' : 'Keep ' + n + (out ? ', rule out ' + out : ''); }
        return;
      }
      if (why) why.required = n === 0;
      if (btn) btn.textContent = n === 0 ? 'Decide and close' : n === 1 ? 'Choose this one and close' : 'Choose these ' + n + ' and close';
    }
    var decideForms = document.querySelectorAll('[data-nb-decide]');
    for (var di = 0; di < decideForms.length; di++) decideSync(decideForms[di]);
    document.addEventListener('change', function (e) {
      var form = e.target.closest && e.target.closest('[data-nb-decide]');
      if (form && e.target.name === 'chosen') decideSync(form);
    });
    // Tick sua's picks: exactly the ones sua recommended (the rest unticked).
    document.addEventListener('click', function (e) {
      var sua = e.target.closest && e.target.closest('[data-nb-decide-sua]');
      if (!sua) return;
      var form = sua.closest('[data-nb-decide]');
      var boxes = form.querySelectorAll('input[name="chosen"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = boxes[i].hasAttribute('data-sua-pick');
      decideSync(form);
    });
    document.addEventListener('click', function (e) {
      var top = e.target.closest && e.target.closest('[data-nb-decide-top]');
      if (!top) return;
      var form = top.closest('[data-nb-decide]');
      var target = Number(form.getAttribute('data-target')) || 0;
      var boxes = form.querySelectorAll('input[name="chosen"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = i < target;
      decideSync(form);
    });
    // Continue the conversation (notebook and option pages): open it in the sua drawer.
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
    var count = Number(main.getAttribute('data-nb-count')) || 0;
    var changed = main.getAttribute('data-nb-changed') || '';
    // The widgets' Move / Rule out / Bring back: save it, then redraw.
    var base = '/notebooks/' + encodeURIComponent(id) + '/entries/';
    document.addEventListener('a2ui-action', function (e) {
      var d = e.detail || {};
      if (d.name !== 'notebook-option' || !d.context || !d.context.id) return;
      var c = d.context;
      var path = c.op === 'move' ? 'stage' : c.op === 'ruleOut' || c.op === 'gone' ? 'rule-out' : c.op === 'reinstate' ? 'reinstate' : c.op === 'check' ? 'check' : c.op === 'choose' || c.op === 'unchoose' ? 'choose' : '';
      if (!path) return;
      var body = new URLSearchParams();
      if (c.op === 'check') { body.set('item', c.item || ''); body.set('done', c.done ? '1' : '0'); }
      if (c.op === 'gone') body.set('gone', '1');
      if (c.op === 'unchoose') body.set('on', '0');
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
          var st = r.headers.get('X-Notebook-Steps');
          var lv = r.headers.get('X-Notebook-Live');
          var wt = r.headers.get('X-Notebook-Waiting');
          return r.text().then(function (t) { return { n: n, ch: ch, t: t, hint: hint, ph: ph, st: st, lv: lv, wt: wt }; });
        })
        .then(function (res) {
          // The steps moved (started, paused or waiting on a new card, from here or the
          // conversation): reload, so the header's buttons match the conversation's card.
          if (res.st !== null && res.st !== (main.getAttribute('data-nb-steps') || '') && !document.querySelector('textarea:focus, input:focus')) { window.location.reload(); return; }
          // The conversation started or stopped waiting on you, or replying: redraw the
          // live bar and the Talk card, and say so when it's now waiting.
          if (res.lv !== null) {
            var lv = decodeURIComponent(res.lv || '');
            if (lv !== (main.getAttribute('data-nb-live') || '')) {
              main.setAttribute('data-nb-live', lv);
              redrawLive();
              if (res.wt) showWaitingToast(decodeURIComponent(res.wt));
              else hideWaitingToast();
            }
          }
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
    // The page's live bar and Talk card from a fresh copy of the page (not while you type in it).
    function redrawLive() {
      fetch('/notebooks/' + encodeURIComponent(id), { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
        .then(function (t) {
          var doc = new DOMParser().parseFromString(t, 'text/html');
          var bar = doc.querySelector('[data-nb-live-bar]');
          var nowBar = document.querySelector('[data-nb-live-bar]');
          if (bar && nowBar) nowBar.replaceWith(document.importNode(bar, true));
          var talk = doc.querySelector('.nb-talk');
          var nowTalk = document.querySelector('.nb-talk');
          var ae = document.activeElement;
          if (talk && nowTalk && !(ae && nowTalk.contains(ae))) nowTalk.replaceWith(document.importNode(talk, true));
        })
        .catch(function () { /* keep what's shown */ });
    }
    // sua is waiting on you here while the drawer is closed: a toast that opens it.
    function hideWaitingToast() { var t = document.querySelector('.nb-toast'); if (t) t.remove(); }
    function showWaitingToast(text) {
      if (document.body.classList.contains('has-sua-panel')) return; // the drawer is open: it shows it
      hideWaitingToast();
      var t = document.createElement('div');
      t.className = 'nb-toast';
      t.setAttribute('role', 'status');
      var msg = document.createElement('span');
      msg.className = 'nb-toast__text';
      var b = document.createElement('strong');
      b.textContent = 'This notebook is waiting on you';
      msg.appendChild(b);
      msg.appendChild(document.createTextNode(' ' + text));
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn--sm btn--primary';
      open.textContent = 'Open';
      // The same as the live bar's button: open the conversation, or your step's Decide / Narrow.
      open.addEventListener('click', function () {
        hideWaitingToast();
        var go = document.querySelector('[data-nb-live-bar] .nb-live__row--waiting .btn--primary');
        if (go) go.click();
      });
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'nb-toast__close';
      x.setAttribute('aria-label', 'Dismiss');
      x.textContent = '×';
      x.addEventListener('click', hideWaitingToast);
      t.appendChild(msg); t.appendChild(open); t.appendChild(x);
      document.body.appendChild(t);
    }
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
