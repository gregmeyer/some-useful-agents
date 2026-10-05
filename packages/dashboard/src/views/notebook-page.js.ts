/**
 * A notebook's page (views/notebooks.ts): "Continue the conversation" opens
 * its thread in the sua drawer, and the sections update as sua (or the
 * pipeline) files new entries, without a reload, unless you're typing there.
 */
export const NOTEBOOK_PAGE_JS = `
  (function () {
    var main = document.querySelector('[data-nb-main]');
    if (!main) return;
    var id = main.getAttribute('data-nb-main');
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-nb-continue]');
      if (!btn || !window.suaPanel) return;
      e.preventDefault();
      window.suaPanel.open(btn.getAttribute('data-nb-continue'));
    });
    var count = Number(main.getAttribute('data-nb-count')) || 0;
    function refresh() {
      if (document.visibilityState !== 'visible') return;
      var ae = document.activeElement;
      if (ae && main.contains(ae) && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return;
      fetch('/notebooks/' + encodeURIComponent(id) + '/main', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          var n = Number(r.headers.get('X-Notebook-Entries')) || 0;
          var hint = r.headers.get('X-Notebook-Hint');
          var ph = r.headers.get('X-Notebook-Placeholder');
          return r.text().then(function (t) { return { n: n, t: t, hint: hint, ph: ph }; });
        })
        .then(function (res) {
          // The talk box's hint and ghost text follow the notebook's next step.
          try {
            var labels = document.querySelectorAll('.nb-talk__next');
            for (var i = 0; i < labels.length; i++) if (res.hint) labels[i].textContent = decodeURIComponent(res.hint);
            var boxes = document.querySelectorAll('.nb-talk__form textarea');
            for (var j = 0; j < boxes.length; j++) if (res.ph) boxes[j].setAttribute('placeholder', decodeURIComponent(res.ph));
          } catch (_) { /* keep what's shown */ }
          if (res.n === count) return;
          var wasEmpty = count === 0;
          count = res.n;
          main.setAttribute('data-nb-count', String(count));
          // The first entries also bring the conversation box to the side: reload once.
          if (wasEmpty) { window.location.reload(); return; }
          main.innerHTML = res.t;
        })
        .catch(function () { /* keep what's shown */ });
    }
    setInterval(refresh, 5000);
  })();
`;
