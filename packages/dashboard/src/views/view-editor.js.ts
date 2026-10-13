/**
 * The View editor page (routes/agent-view.ts): as you type, the YAML is
 * checked and the preview redrawn with the agent's last run (debounced
 * POST /agents/:name/view/preview). Save is off while the view has
 * errors. "Start from its outputs" swaps in the starter view, asking
 * first (a second click) when it would replace your edits.
 */
export const VIEW_EDITOR_JS = `
(function () {
  var root = document.querySelector('[data-view-editor]');
  if (!root) return;
  var agentId = root.getAttribute('data-view-editor');
  var text = root.querySelector('[data-view-text]');
  var errors = root.querySelector('[data-view-errors]');
  var preview = root.querySelector('[data-view-preview]');
  var save = root.querySelector('[data-view-save]');
  var starterBtn = root.querySelector('[data-view-starter]');
  var starterEl = root.querySelector('[data-view-starter-text]');
  if (!text || !preview) return;
  var starter = '';
  try { starter = JSON.parse(starterEl ? starterEl.textContent || '""' : '""'); } catch (_) { starter = ''; }
  var initial = text.value;
  var timer = null;
  var seq = 0;

  function showErrors(list) {
    if (!errors) return;
    errors.innerHTML = '';
    (list || []).forEach(function (m) { var li = document.createElement('li'); li.textContent = m; errors.appendChild(li); });
    errors.hidden = !list || list.length === 0;
    if (save) save.disabled = !!(list && list.length);
  }

  function refresh() {
    var mine = ++seq;
    var body = new URLSearchParams();
    body.append('text', text.value);
    fetch('/agents/' + encodeURIComponent(agentId) + '/view/preview', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
      body: body.toString(),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (mine !== seq) return; // a newer edit is on its way
        showErrors(d.errors);
        if (d.ok && typeof d.html === 'string') preview.innerHTML = d.html;
      })
      .catch(function () { if (mine === seq) showErrors(['The preview could not be updated. Is the dashboard still running?']); });
  }

  text.addEventListener('input', function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 400);
    if (starterBtn) starterBtn.textContent = 'Start from its outputs';
  });

  // Tab indents (two spaces) instead of leaving the field.
  text.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    var s = text.selectionStart, end = text.selectionEnd;
    text.value = text.value.slice(0, s) + '  ' + text.value.slice(end);
    text.selectionStart = text.selectionEnd = s + 2;
    text.dispatchEvent(new Event('input'));
  });

  if (starterBtn) starterBtn.addEventListener('click', function () {
    var edited = text.value !== initial && text.value !== starter;
    if (edited && starterBtn.getAttribute('data-armed') !== '1') {
      starterBtn.setAttribute('data-armed', '1');
      starterBtn.textContent = 'Replace your edits? Click again';
      return;
    }
    starterBtn.removeAttribute('data-armed');
    starterBtn.textContent = 'Start from its outputs';
    text.value = starter;
    text.dispatchEvent(new Event('input'));
    text.focus();
  });
})();
`;
