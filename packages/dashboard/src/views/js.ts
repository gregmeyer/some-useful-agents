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

  // Tool-picker dropdown: swap visible input fields when the tool changes.
  // shell-exec → Command textarea, claude-code → Prompt textarea, other →
  // dynamically generated fields from the tool's declared inputs schema.
  (function () {
    var select = document.getElementById('node-tool-select');
    var schemasEl = document.getElementById('tool-schemas');
    var typeHidden = document.getElementById('node-type-hidden');
    var descEl = document.getElementById('tool-description');
    var inputsSection = document.getElementById('tool-inputs-section');
    if (!select || !schemasEl) return;

    var schemas;
    try { schemas = JSON.parse(schemasEl.textContent || '{}'); } catch (e) { return; }

    function updateDescription(toolId) {
      if (!descEl || !schemas[toolId]) return;
      descEl.textContent = schemas[toolId].description || '';
    }

    function updateType(toolId) {
      if (!typeHidden || !schemas[toolId]) return;
      var implType = schemas[toolId].implType;
      typeHidden.value = implType === 'claude-code' ? 'claude-code' : 'shell';
    }

    function updateFields(toolId) {
      // Show/hide the built-in command/prompt textareas.
      var shellField = document.querySelector('[data-node-field="shell"]');
      var claudeField = document.querySelector('[data-node-field="claude-code"]');
      if (shellField) shellField.style.display = (toolId === 'shell-exec') ? '' : 'none';
      if (claudeField) claudeField.style.display = (toolId === 'claude-code') ? '' : 'none';

      // For non-builtin tools, generate inputs from the schema.
      if (!inputsSection) return;
      if (toolId === 'shell-exec' || toolId === 'claude-code') {
        inputsSection.innerHTML = '';
        return;
      }
      var schema = schemas[toolId];
      if (!schema || !schema.inputs) { inputsSection.innerHTML = ''; return; }

      // Determine palette mode from tool's implementation type.
      var paletteMode = schema.implType === 'claude-code' ? 'claude' : 'shell';
      // Find the palette-source id (reuse whichever one is on the page).
      var existingPalette = document.querySelector('[data-palette-source]');
      var paletteSource = existingPalette ? existingPalette.getAttribute('data-palette-source') : '';

      var html = '';
      for (var name in schema.inputs) {
        var spec = schema.inputs[name];
        var req = spec.required ? ' required' : '';
        var defVal = spec['default'] !== undefined ? String(spec['default']) : '';
        var isTextLike = spec.type === 'string' || spec.type === 'json';
        html += '<label style="display:flex;flex-direction:column;gap:var(--space-1);margin-bottom:var(--space-3);">';
        html += '<strong>' + name + ' <span class="dim" style="font-weight:var(--weight-regular);font-size:var(--font-size-xs);">(' + spec.type + (spec.required ? ', required' : '') + ')</span></strong>';
        if (isTextLike) {
          // Use a textarea for string/json fields so the palette can trigger.
          html += '<textarea name="toolInput_' + name + '" rows="2"' + req;
          html += ' data-template-palette="both"';
          html += ' data-palette-source="' + paletteSource + '"';
          html += ' style="padding:var(--space-2) var(--space-3);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-sm);font-family:var(--font-mono);resize:vertical;">';
          html += defVal.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += '</textarea>';
          html += '<span class="dim" style="font-size:var(--font-size-xs);">Type <code>$</code> or <code>{{</code> for available refs.</span>';
        } else {
          html += '<input type="text" name="toolInput_' + name + '" value="' + defVal.replace(/"/g, '&quot;') + '"' + req;
          html += ' style="padding:var(--space-2) var(--space-3);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-sm);font-family:var(--font-mono);">';
        }
        if (spec.description) html += '<span class="dim" style="font-size:var(--font-size-xs);">' + spec.description + '</span>';
        html += '</label>';
      }
      inputsSection.innerHTML = html;
    }

    // Initial render.
    var initial = select.value;
    updateDescription(initial);
    updateFields(initial);

    select.addEventListener('change', function () {
      var toolId = select.value;
      updateDescription(toolId);
      updateType(toolId);
      updateFields(toolId);
    });
  })();

  // Grey-out the inactive node-type field (Command vs Prompt) based on
  // which <input type="radio" name="type"> is selected. The form still
  // submits both fields — the server validates against the selected
  // type — but visually the irrelevant one is dimmed and disabled for
  // input so users don't waste time editing it.
  (function () {
    function syncFields() {
      var checked = document.querySelector('input[type="radio"][name="type"]:checked');
      if (!checked) return;
      var active = checked.value;
      var fields = document.querySelectorAll('[data-node-field]');
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.getAttribute('data-node-field') === active) {
          f.classList.remove('node-field--inactive');
        } else {
          f.classList.add('node-field--inactive');
        }
      }
    }
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('input[type="radio"][name="type"]')) {
        syncFields();
      }
    });
    // Run once on DOMContentLoaded so the initial render reflects the
    // pre-checked radio.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncFields);
    } else {
      syncFields();
    }
  })();

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
        for (var k = 0; k < (sugg.vars || []).length; k++) {
          items.push({
            insert: '$' + sugg.vars[k],
            label: '$' + sugg.vars[k],
            hint: 'global variable',
            group: 'var',
          });
        }
        for (var l = 0; l < sugg.secrets.length; l++) {
          items.push({
            insert: '$' + sugg.secrets[l],
            label: '$' + sugg.secrets[l],
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
        for (var p = 0; p < (sugg.vars || []).length; p++) {
          items.push({
            insert: '{{vars.' + sugg.vars[p] + '}}',
            label: '{{vars.' + sugg.vars[p] + '}}',
            hint: 'global variable',
            group: 'var',
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
      ensurePalette();
      var rect = textarea.getBoundingClientRect();
      palette.style.left = Math.round(rect.left + window.scrollX) + 'px';
      palette.style.top = Math.round(rect.bottom + window.scrollY + 4) + 'px';
      palette.style.minWidth = Math.round(Math.min(rect.width, 420)) + 'px';
    }

    var GROUP_LABELS = {
      upstream: 'Upstream outputs',
      input: 'Agent inputs',
      var: 'Global variables',
      secret: 'Secrets',
    };

    function renderPalette(items, selectedIndex) {
      ensurePalette();
      palette.innerHTML = '';
      if (items.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'template-palette__empty';
        empty.textContent = 'No matches';
        palette.appendChild(empty);
      } else {
        var lastGroup = null;
        for (var i = 0; i < items.length; i++) {
          if (items[i].group !== lastGroup) {
            lastGroup = items[i].group;
            var sep = document.createElement('div');
            sep.className = 'template-palette__group';
            sep.textContent = GROUP_LABELS[lastGroup] || lastGroup;
            palette.appendChild(sep);
          }

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
      // For tool-input fields (mode="both"), show whichever syntax the
      // user is typing. For dedicated Command/Prompt textareas, enforce
      // the single syntax. "both" is set on dynamically generated tool
      // input fields where the user may use either syntax.
      if (mode !== 'both') {
        if (mode === 'claude' && trig.mode === 'shell') { closePalette(); return; }
        if (mode === 'shell' && trig.mode === 'claude') { closePalette(); return; }
      }

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

  // Node vars filter — live filter by name or value on resolved variables
  (function () {
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.matches || !t.matches('.node-vars__filter')) return;
      var panelId = t.getAttribute('data-vars-panel');
      if (!panelId) return;
      var panel = document.getElementById(panelId);
      if (!panel) return;
      var q = t.value.toLowerCase();
      var rows = panel.querySelectorAll('tr[data-vars-name]');
      var visibleByGroup = {};
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var name = row.getAttribute('data-vars-name') || '';
        var value = row.getAttribute('data-vars-value') || '';
        var match = !q || name.indexOf(q) >= 0 || value.indexOf(q) >= 0;
        row.style.display = match ? '' : 'none';
        if (match) {
          var g = row.getAttribute('data-vars-group');
          visibleByGroup[g] = true;
        }
      }
      // Hide group headings when all their rows are filtered out
      var headings = panel.querySelectorAll('[data-vars-heading]');
      for (var j = 0; j < headings.length; j++) {
        var h = headings[j];
        var group = h.getAttribute('data-vars-heading');
        h.style.display = visibleByGroup[group] ? '' : 'none';
      }
    });
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

  // Run-now modal — open inputs form or show spinner while POST submits.
  (function () {
    var runModal = document.getElementById('run-modal');
    if (!runModal) return;

    // "Run now" button for agents with inputs — opens the modal form.
    var inputsBtn = document.getElementById('run-with-inputs-btn');
    if (inputsBtn) {
      inputsBtn.addEventListener('click', function () {
        runModal.classList.add('is-open');
      });
    }

    // When the form inside the modal submits, swap content to a spinner.
    var runForm = runModal.querySelector('[data-run-form]');
    if (runForm) {
      runForm.addEventListener('submit', function () {
        var mc = document.getElementById('run-modal-content');
        if (mc) mc.innerHTML =
          '<div style="text-align:center;padding:var(--space-6);">' +
          '<div class="spinner" style="margin:0 auto var(--space-3);"></div>' +
          '<p style="font-weight:var(--weight-medium);margin:0 0 var(--space-2);">Running...</p>' +
          '<p class="dim" style="font-size:var(--font-size-xs);margin:0;">Starting execution.</p></div>';
      });
    }

    // Also handle no-inputs agents (form outside modal with data-run-form).
    var externalForm = document.querySelector('form[data-run-form]:not(#run-modal form)');
    if (externalForm) {
      externalForm.addEventListener('submit', function () {
        runModal.classList.add('is-open');
        var mc = document.getElementById('run-modal-content');
        if (mc) mc.innerHTML =
          '<div style="text-align:center;padding:var(--space-6);">' +
          '<div class="spinner" style="margin:0 auto var(--space-3);"></div>' +
          '<p style="font-weight:var(--weight-medium);margin:0 0 var(--space-2);">Running...</p>' +
          '<p class="dim" style="font-size:var(--font-size-xs);margin:0;">Starting execution.</p></div>';
      });
    }

    // Close modal on backdrop click or data-close-modal buttons.
    runModal.addEventListener('click', function (e) {
      if (e.target === runModal) runModal.classList.remove('is-open');
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-modal')) runModal.classList.remove('is-open');
    });
  })();

  // Suggest improvements — modal with progress feedback, cancel, colored diff.
  (function () {
    var btn = document.getElementById('suggest-btn');
    var modal = document.getElementById('suggest-modal');
    var content = document.getElementById('suggest-modal-content');
    if (!btn || !modal || !content) return;
    var agentId = btn.getAttribute('data-agent-id');
    var PHASES = [
      [0,'Sending YAML to Claude...'],[5,'Reading the DAG structure...'],
      [15,'Analyzing cross-node data flow...'],[30,'Generating suggestions...'],
      [60,'Still working (complex agent)...'],[90,'Almost there...']
    ];

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function closeModal() { modal.classList.remove('is-open'); }

    function coloredDiff(oldT, newT) {
      var oL = oldT.split('\\n'), nL = newT.split('\\n');
      var oS = {}, nS = {};
      for (var i = 0; i < oL.length; i++) oS[oL[i].trim()] = true;
      for (var j = 0; j < nL.length; j++) nS[nL[j].trim()] = true;
      var DEL = 'background:rgba(255,0,0,0.08);color:#cf222e;';
      var ADD = 'background:rgba(0,180,0,0.08);color:#1a7f37;';
      var P = 'font-size:var(--font-size-xs);background:var(--color-surface-raised);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:var(--space-3);max-height:280px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin:0;';
      var h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-3);">';
      h += '<div><p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-1);">Current</p><pre style="' + P + '">';
      for (var a = 0; a < oL.length; a++) h += '<span style="display:block;' + (nS[oL[a].trim()] ? '' : DEL) + '">' + esc(oL[a]) + '</span>';
      h += '</pre></div><div><p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-1);">Suggested</p><pre style="' + P + '">';
      for (var b = 0; b < nL.length; b++) h += '<span style="display:block;' + (oS[nL[b].trim()] ? '' : ADD) + '">' + esc(nL[b]) + '</span>';
      h += '</pre></div></div>';
      return h;
    }

    btn.addEventListener('click', function () {
      modal.classList.add('is-open');
      var t0 = Date.now();
      content.innerHTML =
        '<div style="padding:var(--space-4);">' +
        '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">' +
          '<div class="spinner"></div>' +
          '<div style="flex:1;"><div style="font-weight:var(--weight-medium);">Analyzing ' + esc(agentId) + '</div>' +
          '<div class="dim" style="font-size:var(--font-size-xs);" id="sg-phase">' + PHASES[0][1] + '</div></div>' +
          '<div style="font-family:var(--font-mono);font-size:var(--font-size-lg);color:var(--color-text-muted);min-width:3rem;text-align:right;" id="sg-timer">0s</div>' +
        '</div>' +
        '<div style="height:4px;background:var(--color-border);border-radius:2px;overflow:hidden;margin-bottom:var(--space-3);">' +
          '<div id="sg-bar" style="height:100%;background:var(--color-primary);border-radius:2px;width:0%;transition:width 1s linear;"></div>' +
        '</div>' +
        '<div style="text-align:right;"><button type="button" class="btn btn--ghost btn--sm" id="sg-cancel">Cancel</button></div>' +
        '</div>';

      var tick = setInterval(function () {
        var s = Math.round((Date.now() - t0) / 1000);
        var te = document.getElementById('sg-timer'); if (te) te.textContent = s + 's';
        var be = document.getElementById('sg-bar'); if (be) be.style.width = Math.min(s/120*100, 98) + '%';
        var pe = document.getElementById('sg-phase'); if (pe) {
          var m = PHASES[0][1]; for (var i = 0; i < PHASES.length; i++) { if (s >= PHASES[i][0]) m = PHASES[i][1]; }
          pe.textContent = m;
        }
      }, 1000);

      var ctrl = new AbortController();
      var ce = document.getElementById('sg-cancel');
      if (ce) ce.addEventListener('click', function () { ctrl.abort(); clearInterval(tick); closeModal(); });

      fetch('/agents/' + encodeURIComponent(agentId) + '/analyze', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '', signal: ctrl.signal,
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        clearInterval(tick);
        if (!data.ok) {
          content.innerHTML =
            '<h3 style="margin:0 0 var(--space-3);">Analysis failed</h3>' +
            '<div class="flash flash--error">' + esc(data.error || 'Unknown error') + '</div>' +
            (data.runId ? '<p class="dim" style="font-size:var(--font-size-xs);margin:var(--space-2) 0 0;">Run: <a href="/runs/' + esc(data.runId) + '">' + esc(data.runId.slice(0,8)) + '</a></p>' : '') +
            '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Close</button></div>';
          return;
        }
        var bc = data.classification === 'NO_IMPROVEMENTS' ? 'badge--ok' : data.classification === 'REWRITE' ? 'badge--err' : 'badge--warn';
        var bl = data.classification === 'NO_IMPROVEMENTS' ? 'No improvements needed' : data.classification === 'REWRITE' ? 'Recommend rewrite' : 'Suggested improvements';
        var h = '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);"><span class="badge ' + bc + '">' + esc(bl) + '</span></div>';
        if (data.summary) h += '<p style="font-weight:var(--weight-medium);margin:0 0 var(--space-3);">' + esc(data.summary) + '</p>';
        if (data.details) h += '<pre style="white-space:pre-wrap;font-family:inherit;font-size:var(--font-size-sm);line-height:1.6;margin:0 0 var(--space-3);color:var(--color-text-muted);max-height:250px;overflow-y:auto;">' + esc(data.details) + '</pre>';
        if (data.yaml && data.currentYaml) {
          h += coloredDiff(data.currentYaml, data.yaml);
        } else if (data.yaml) {
          h += '<pre style="font-size:var(--font-size-xs);background:var(--color-surface-raised);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:var(--space-3);margin-bottom:var(--space-3);max-height:300px;overflow-y:auto;white-space:pre-wrap;">' + esc(data.yaml) + '</pre>';
        }
        if (data.yamlError) {
          h += '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' +
            '<strong>Suggested YAML has validation errors:</strong> ' + esc(data.yamlError) +
            '<br>Click "Edit YAML" to fix manually.</div>';
        }
        h += '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;flex-wrap:wrap;">';
        if (data.yaml) {
          var applyLabel = data.yamlError ? 'Edit YAML to fix' : 'Review + apply';
          h += '<button type="button" class="btn btn--primary btn--sm" id="sg-apply">' + esc(applyLabel) + '</button>';
        }
        h += '<button type="button" class="btn btn--ghost btn--sm" id="sg-dismiss">Dismiss</button></div>';
        content.innerHTML = h;
        var ab = document.getElementById('sg-apply');
        if (ab && data.yaml) ab.addEventListener('click', function () {
          var f = document.createElement('form'); f.method = 'POST';
          f.action = '/agents/' + encodeURIComponent(agentId) + '/yaml';
          var t = document.createElement('textarea'); t.name = 'prefillYaml'; t.value = data.yaml; t.style.display = 'none';
          f.appendChild(t); document.body.appendChild(f); f.submit();
        });
        var db = document.getElementById('sg-dismiss');
        if (db) db.addEventListener('click', closeModal);
      })
      .catch(function (err) {
        clearInterval(tick);
        if (err.name === 'AbortError') return;
        content.innerHTML =
          '<h3 style="margin:0 0 var(--space-3);">Error</h3>' +
          '<div class="flash flash--error">' + esc(String(err)) + '</div>' +
          '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Close</button></div>';
      });
    });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-modal')) closeModal();
    });
  })();

  // Secret save confirmation modal — shows the value one last time with
  // a copy button before the encrypted write. Value is never shown again.
  (function () {
    var form = document.getElementById('secret-set-form');
    var modal = document.getElementById('secret-confirm-modal');
    if (!form || !modal) return;

    var valueDisplay = document.getElementById('secret-confirm-value');
    var copyBtn = document.getElementById('secret-copy-btn');
    var cancelBtn = document.getElementById('secret-cancel-btn');
    var saveBtn = document.getElementById('secret-save-btn');

    form.addEventListener('submit', function (e) {
      var nameInput = document.getElementById('secret-name');
      var valueInput = document.getElementById('secret-value');
      if (!nameInput || !valueInput || !nameInput.value.trim() || !valueInput.value) return;

      e.preventDefault();
      valueDisplay.textContent = valueInput.value;
      modal.style.display = 'flex';
    });

    copyBtn.addEventListener('click', function () {
      var text = valueDisplay.textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
        });
      } else {
        // Fallback for non-HTTPS contexts.
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copyBtn.textContent = 'Copied!';
        setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
      }
    });

    cancelBtn.addEventListener('click', function () {
      modal.style.display = 'none';
      valueDisplay.textContent = '';
    });

    saveBtn.addEventListener('click', function () {
      modal.style.display = 'none';
      valueDisplay.textContent = '';
      form.submit();
    });

    // ESC to close
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        modal.style.display = 'none';
        valueDisplay.textContent = '';
      }
    });
  })();
})();
`;
