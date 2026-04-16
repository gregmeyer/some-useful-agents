/**
 * Inline JS. Tiny vanilla script for:
 *   1. The community-shell confirm modal (open/close, checkbox-gated submit)
 *   2. Auto-poll on /runs/:id when the run is still in-progress
 *
 * Inlined so there's no second HTTP round-trip for ~2KB of logic.
 */
export const DASHBOARD_JS = `
(function () {
  // Community-shell confirm modal
  function openModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('open');
  }
  function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }
  window.suaOpenModal = openModal;
  window.suaCloseModal = closeModal;

  // Toggle submit button when the audit checkbox flips
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('input[data-audit-checkbox]')) {
      var formId = t.getAttribute('data-audit-checkbox');
      var btn = document.querySelector('button[data-audit-submit="' + formId + '"]');
      if (btn) btn.disabled = !t.checked;
    }
  });

  // ESC closes any open custom-modal backdrop (community-shell confirm,
  // run-now audit). Native <dialog> elements already close on ESC via
  // the browser's cancel event; this fills the gap for the older
  // .modal-backdrop pattern we still use in a few places.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('.modal-backdrop.is-open, .modal-backdrop.open');
    if (open) {
      open.classList.remove('is-open');
      open.classList.remove('open');
    }
  });

  // Confirm-before-submit for forms with [data-confirm]. Used on
  // destructive settings actions (delete secret, rotate MCP token).
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches('form[data-confirm]')) return;
    var msg = form.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) {
      e.preventDefault();
    }
  });

  // Template palette — autocomplete for $ (shell env vars) and {{
  // (claude-code template refs) in node command / prompt textareas.
  // Triggered by typing the first char of either syntax; filters as the
  // user types; Up/Down + Enter to insert; Esc to close.
  (function () {
    var palette = null;
    var activeTextarea = null;
    // { mode: 'shell' | 'claude', triggerStart: number, query: string, items: [...], selectedIndex: number }
    var state = null;

    function getSuggestions(textarea) {
      var sourceId = textarea.getAttribute('data-palette-source');
      if (!sourceId) return null;
      var el = document.getElementById(sourceId);
      if (!el) return null;
      try { return JSON.parse(el.textContent); }
      catch (e) { return null; }
    }

    function buildItems(mode, sugg) {
      var items = [];
      if (mode === 'shell') {
        for (var i = 0; i < sugg.upstreams.length; i++) {
          var id = sugg.upstreams[i];
          var envName = 'UPSTREAM_' + id.toUpperCase().replace(/-/g, '_') + '_RESULT';
          items.push({
            insert: '$' + envName,
            label: '$' + envName,
            hint: 'stdout of upstream "' + id + '"',
            group: 'upstream',
          });
        }
        for (var j = 0; j < sugg.inputs.length; j++) {
          items.push({
            insert: '$' + sugg.inputs[j],
            label: '$' + sugg.inputs[j],
            hint: 'agent input',
            group: 'input',
          });
        }
        for (var k = 0; k < sugg.secrets.length; k++) {
          items.push({
            insert: '$' + sugg.secrets[k],
            label: '$' + sugg.secrets[k],
            hint: 'node secret',
            group: 'secret',
          });
        }
      } else {
        for (var m = 0; m < sugg.upstreams.length; m++) {
          var uid = sugg.upstreams[m];
          items.push({
            insert: '{{upstream.' + uid + '.result}}',
            label: '{{upstream.' + uid + '.result}}',
            hint: 'stdout of upstream "' + uid + '"',
            group: 'upstream',
          });
        }
        for (var n = 0; n < sugg.inputs.length; n++) {
          items.push({
            insert: '{{inputs.' + sugg.inputs[n] + '}}',
            label: '{{inputs.' + sugg.inputs[n] + '}}',
            hint: 'agent input',
            group: 'input',
          });
        }
      }
      return items;
    }

    function detectTrigger(textarea) {
      var v = textarea.value;
      var pos = textarea.selectionStart;
      // Walk backwards from the cursor looking for $ or {{. Bail out on
      // whitespace or on another trigger char — keeps the palette scoped
      // to the current "word" the user is typing.
      for (var i = pos - 1; i >= 0 && i >= pos - 64; i--) {
        var c = v.charAt(i);
        if (c === '$') {
          return { mode: 'shell', triggerStart: i, query: v.slice(i + 1, pos) };
        }
        if (c === '{' && i > 0 && v.charAt(i - 1) === '{') {
          return { mode: 'claude', triggerStart: i - 1, query: v.slice(i + 1, pos) };
        }
        if (/\\s/.test(c)) return null;
      }
      return null;
    }

    function filterItems(items, query) {
      if (!query) return items.slice(0, 10);
      var q = query.toLowerCase();
      var scored = [];
      for (var i = 0; i < items.length; i++) {
        var label = items[i].label.toLowerCase();
        var idx = label.indexOf(q);
        if (idx >= 0) scored.push({ item: items[i], score: idx });
      }
      scored.sort(function (a, b) { return a.score - b.score; });
      return scored.slice(0, 10).map(function (s) { return s.item; });
    }

    function ensurePalette() {
      if (palette) return palette;
      palette = document.createElement('div');
      palette.className = 'template-palette';
      palette.setAttribute('role', 'listbox');
      document.body.appendChild(palette);
      return palette;
    }

    function closePalette() {
      if (palette) palette.style.display = 'none';
      activeTextarea = null;
      state = null;
    }

    function positionPalette(textarea) {
      var rect = textarea.getBoundingClientRect();
      palette.style.left = Math.round(rect.left + window.scrollX) + 'px';
      palette.style.top = Math.round(rect.bottom + window.scrollY + 4) + 'px';
      palette.style.minWidth = Math.round(Math.min(rect.width, 420)) + 'px';
    }

    function renderPalette(items, selectedIndex) {
      ensurePalette();
      palette.innerHTML = '';
      if (items.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'template-palette__empty';
        empty.textContent = 'No matches';
        palette.appendChild(empty);
      } else {
        for (var i = 0; i < items.length; i++) {
          var row = document.createElement('div');
          row.className = 'template-palette__item' + (i === selectedIndex ? ' is-selected' : '');
          row.setAttribute('data-index', String(i));
          row.setAttribute('role', 'option');

          var label = document.createElement('span');
          label.className = 'template-palette__label mono';
          label.textContent = items[i].label;
          row.appendChild(label);

          var hint = document.createElement('span');
          hint.className = 'template-palette__hint';
          hint.textContent = items[i].hint;
          row.appendChild(hint);

          palette.appendChild(row);
        }
      }
      palette.style.display = 'block';
    }

    function insertChoice(item) {
      if (!activeTextarea || !state) return;
      var t = activeTextarea;
      var before = t.value.slice(0, state.triggerStart);
      var after = t.value.slice(t.selectionStart);
      t.value = before + item.insert + after;
      var newPos = (before + item.insert).length;
      t.selectionStart = t.selectionEnd = newPos;
      closePalette();
      t.focus();
      // Dispatch an input event so any listeners (form validation, etc.)
      // see the synthetic insertion.
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function updateFromTextarea(textarea) {
      var trig = detectTrigger(textarea);
      if (!trig) { closePalette(); return; }
      var sugg = getSuggestions(textarea);
      if (!sugg) { closePalette(); return; }
      var mode = textarea.getAttribute('data-template-palette');
      // $ inside a claude-prompt textarea is just a literal $, not a trigger.
      if (mode === 'claude' && trig.mode === 'shell') { closePalette(); return; }
      if (mode === 'shell' && trig.mode === 'claude') { closePalette(); return; }

      var all = buildItems(trig.mode, sugg);
      var filtered = filterItems(all, trig.query);

      activeTextarea = textarea;
      state = {
        mode: trig.mode,
        triggerStart: trig.triggerStart,
        query: trig.query,
        items: filtered,
        selectedIndex: 0,
      };
      positionPalette(textarea);
      renderPalette(filtered, 0);
    }

    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('textarea[data-template-palette]')) {
        updateFromTextarea(t);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!state || !activeTextarea) return;
      if (e.target !== activeTextarea) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
        return;
      }
      if (state.items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.selectedIndex = (state.selectedIndex + 1) % state.items.length;
        renderPalette(state.items, state.selectedIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.selectedIndex = (state.selectedIndex - 1 + state.items.length) % state.items.length;
        renderPalette(state.items, state.selectedIndex);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        // Swallow Enter/Tab only when the palette has a concrete pick —
        // otherwise let the textarea behave normally.
        e.preventDefault();
        insertChoice(state.items[state.selectedIndex]);
      }
    });

    document.addEventListener('click', function (e) {
      if (!palette) return;
      var row = e.target && e.target.closest && e.target.closest('.template-palette__item');
      if (row && state) {
        var idx = parseInt(row.getAttribute('data-index'), 10);
        if (!isNaN(idx) && state.items[idx]) {
          insertChoice(state.items[idx]);
          return;
        }
      }
      // Click outside the palette closes it.
      if (activeTextarea && e.target !== activeTextarea && !(palette && palette.contains(e.target))) {
        closePalette();
      }
    });

    document.addEventListener('blur', function (e) {
      if (e.target === activeTextarea) {
        // Delay close so a click on a palette row is still registered.
        setTimeout(closePalette, 120);
      }
    }, true);
  })();

  // Auto-poll for in-progress runs
  var runDetail = document.querySelector('[data-run-in-progress]');
  if (runDetail) {
    var runId = runDetail.getAttribute('data-run-in-progress');
    var poll = function () {
      fetch('/runs/' + encodeURIComponent(runId) + '?partial=1', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function (html) {
          var placeholder = document.createElement('div');
          placeholder.innerHTML = html;
          var fresh = placeholder.querySelector('[data-run-container]');
          var current = document.querySelector('[data-run-container]');
          if (fresh && current) {
            current.replaceWith(fresh);
            // If the new fragment no longer carries the in-progress marker,
            // the poll loop stops naturally on the next scheduled tick.
            if (fresh.querySelector('[data-run-in-progress]')) {
              setTimeout(poll, 2000);
            }
          }
        })
        .catch(function () { /* swallow; will retry on next tick */ setTimeout(poll, 5000); });
    };
    setTimeout(poll, 2000);
  }
})();
`;
