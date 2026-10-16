/**
 * /agents: while sua's agent finder looks for the question in the box
 * (views/agents-find.ts), poll for its picks and put them in the panel.
 * And while sua sorts the agents into groups, wait, then reload once.
 */
export const AGENTS_FIND_JS = `
  (function () {
    var panel = document.querySelector('[data-agent-find]');
    if (!panel) return;
    var id = panel.getAttribute('data-agent-find');
    function poll(n) {
      if (n > 60) { panel.querySelector('.ag-suggest__head span:nth-child(2)').textContent = 'sua is taking too long. The keyword matches are below.'; panel.classList.add('is-done'); return; }
      setTimeout(function () {
        fetch('/agents/find/' + encodeURIComponent(id), { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j.status === 'working') { poll(n + 1); return; }
            if (j.html) { panel.innerHTML = j.html; panel.classList.add('is-done'); }
            else panel.hidden = true;
          })
          .catch(function () { poll(n + 1); });
      }, n === 0 ? 300 : 1500);
    }
    poll(0);
  })();
  (function () {
    var note = document.querySelector('[data-catalog-sorting]');
    if (!note) return;
    var tries = 0;
    function check() {
      if (++tries > 80) { note.hidden = true; return; }
      fetch('/agents/catalog/sorting', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.sorting) setTimeout(check, 3000); else location.reload(); })
        .catch(function () { setTimeout(check, 3000); });
    }
    setTimeout(check, 3000);
  })();
`;
