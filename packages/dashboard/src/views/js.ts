/**
 * Inline JS. Tiny vanilla script for:
 *   1. The community-shell confirm modal (open/close, checkbox-gated submit)
 *   2. Auto-poll on /runs/:id when the run is still in-progress
 *
 * Inlined so there's no second HTTP round-trip for ~2KB of logic.
 */
export const DASHBOARD_JS = `
(function () {
  // ── Community-shell confirm modal + audit checkbox ─────────────────
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

  // ── Tool-picker dropdown ───────────────────────────────────────────
  // Swap visible input fields when the tool changes.
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
      typeHidden.value = implType === 'agent-invoke' ? 'agent-invoke'
        : implType === 'claude-code' ? 'claude-code' : 'shell';
    }

    function updateFields(toolId) {
      var isAgent = toolId.indexOf('agent:') === 0;
      // Show/hide the built-in command/prompt textareas.
      var shellField = document.querySelector('[data-node-field="shell"]');
      var claudeField = document.querySelector('[data-node-field="claude-code"]');
      if (shellField) shellField.style.display = (!isAgent && toolId === 'shell-exec') ? '' : 'none';
      if (claudeField) claudeField.style.display = (!isAgent && toolId === 'claude-code') ? '' : 'none';
      // Hide the Implementation fieldset entirely for agent-invoke nodes.
      var implFieldset = shellField && shellField.closest('fieldset');
      if (implFieldset) implFieldset.style.display = isAgent ? 'none' : '';

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

      // For agent-invoke, show an info card above the input mapping fields.
      var agentInfoHtml = '';
      if (isAgent && schema.agentMeta) {
        agentInfoHtml = '<div style="background:var(--color-surface-raised);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:var(--space-3);margin-bottom:var(--space-3);">' +
          '<p style="margin:0 0 var(--space-1);font-weight:var(--weight-semibold);">' + (schema.agentMeta.name || toolId.replace('agent:','')) + '</p>' +
          '<p class="dim" style="margin:0;font-size:var(--font-size-xs);">' + (schema.description || '') + '</p>' +
          '<p class="dim" style="margin:var(--space-1) 0 0;font-size:var(--font-size-xs);">' + schema.agentMeta.nodeCount + ' node' + (schema.agentMeta.nodeCount === 1 ? '' : 's') + '</p>' +
          '</div>' +
          '<p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-2);"><strong>Input mapping</strong> \\u2014 map values to this agent\\u0027s declared inputs. Use upstream refs or literal values.</p>';
      }
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
      inputsSection.innerHTML = agentInfoHtml + html;
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

  // ── Node type field toggle ─────────────────────────────────────────
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

  // ── ESC closes modals ──────────────────────────────────────────────
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

  // ── Confirm-before-submit ──────────────────────────────────────────
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

  // ── Template palette autocomplete ──────────────────────────────────
  // Autocomplete for $ (shell env vars) and {{
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
      // Estimate cursor Y position within the textarea using a mirror div.
      // This places the palette near the line being edited, not at the
      // bottom of the entire textarea.
      var cursorTop = 0;
      try {
        var mirror = document.createElement('div');
        var cs = window.getComputedStyle(textarea);
        mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;';
        mirror.style.width = cs.width;
        mirror.style.font = cs.font;
        mirror.style.padding = cs.padding;
        mirror.style.border = cs.border;
        mirror.style.lineHeight = cs.lineHeight;
        mirror.style.letterSpacing = cs.letterSpacing;
        var textBefore = textarea.value.substring(0, textarea.selectionStart);
        mirror.textContent = textBefore;
        var marker = document.createElement('span');
        marker.textContent = '|';
        mirror.appendChild(marker);
        document.body.appendChild(mirror);
        cursorTop = marker.offsetTop - textarea.scrollTop;
        document.body.removeChild(mirror);
      } catch (e) {
        cursorTop = 0;
      }
      // Position palette just below the cursor line, clamped within the textarea bounds.
      var lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight, 10) || 20;
      var top = rect.top + cursorTop + lineHeight + 4;
      // Don't let it go above the textarea or below the viewport.
      top = Math.max(top, rect.top + lineHeight);
      top = Math.min(top, rect.bottom + 4);
      palette.style.left = Math.round(rect.left + window.scrollX) + 'px';
      palette.style.top = Math.round(top + window.scrollY) + 'px';
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

  // ── Node vars filter ───────────────────────────────────────────────
  // Live filter by name or value on resolved variables
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

  // ── Run status auto-poll ───────────────────────────────────────────
  var runDetail = document.querySelector('[data-run-in-progress]');
  if (runDetail) {
    var runId = runDetail.getAttribute('data-run-in-progress');
    var finalPollCount = 0;
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
            if (fresh.querySelector('[data-run-in-progress]')) {
              // Still in progress — keep polling.
              finalPollCount = 0;
              setTimeout(poll, 2000);
            } else if (finalPollCount < 5) {
              // Run status flipped to terminal but node execution records
              // may lag behind (executor race). Poll a few more times with
              // increasing delays to catch the final node-level updates.
              finalPollCount++;
              setTimeout(poll, finalPollCount <= 2 ? 1000 : 2000);
            }
          }
        })
        .catch(function () { setTimeout(poll, 5000); });
    };
    setTimeout(poll, 2000);
  }

  // ── Run-now modal ──────────────────────────────────────────────────
  // Open inputs form or show spinner while POST submits.
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

    var SPINNER_HTML =
      '<div style="text-align:center;padding:var(--space-6);">' +
      '<div class="spinner" style="margin:0 auto var(--space-3);"></div>' +
      '<p style="font-weight:var(--weight-medium);margin:0 0 var(--space-2);">Running...</p>' +
      '<p class="dim" style="font-size:var(--font-size-xs);margin:0;">Starting execution.</p></div>';

    // When the form inside the modal submits, swap to spinner AFTER the
    // browser has processed the submit (setTimeout avoids disconnecting
    // the form before the POST fires).
    var runForm = runModal.querySelector('[data-run-form]');
    if (runForm) {
      runForm.addEventListener('submit', function () {
        setTimeout(function () {
          var mc = document.getElementById('run-modal-content');
          if (mc) mc.innerHTML = SPINNER_HTML;
        }, 0);
      });
    }

    // No-inputs agents: form is outside the modal. Show modal with spinner.
    var externalForm = document.querySelector('form[data-run-form]:not(#run-modal form)');
    if (externalForm) {
      externalForm.addEventListener('submit', function () {
        runModal.classList.add('is-open');
        setTimeout(function () {
          var mc = document.getElementById('run-modal-content');
          if (mc) mc.innerHTML = SPINNER_HTML;
        }, 0);
      });
    }

    // Close modal on backdrop click or data-close-modal buttons.
    runModal.addEventListener('click', function (e) {
      if (e.target === runModal) runModal.classList.remove('is-open');
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-modal')) runModal.classList.remove('is-open');
    });
  })();

  // ── Suggest improvements modal ─────────────────────────────────────
  // Modal with progress feedback, cancel, colored diff.
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

    // Lightweight markdown to HTML for analysis output.
    function renderMd(text) {
      var h = esc(text);
      h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>' + '$' + '1</strong>');
      h = h.replace(/\\*(.+?)\\*/g, '<em>' + '$' + '1</em>');
      h = h.replace(/^- (.+)$/gm, function(m,p1) { return '<li style="margin-left:var(--space-4);list-style:disc;">' + p1 + '</li>'; });
      h = h.replace(/\\n{2,}/g, '<br><br>');
      h = h.replace(/\\n/g, '<br>');
      return h;
    }

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

    function renderResult(data) {
      var bc = data.classification === 'NO_IMPROVEMENTS' ? 'badge--ok' : data.classification === 'REWRITE' ? 'badge--err' : 'badge--warn';
      var bl = data.classification === 'NO_IMPROVEMENTS' ? 'No improvements needed' : data.classification === 'REWRITE' ? 'Recommend rewrite' : 'Suggested improvements';
      var h = '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);"><span class="badge ' + bc + '">' + esc(bl) + '</span></div>';
      if (data.summary) h += '<p style="font-weight:var(--weight-medium);margin:0 0 var(--space-3);">' + renderMd(data.summary) + '</p>';
      if (data.details) h += '<div style="font-size:var(--font-size-sm);line-height:1.6;margin:0 0 var(--space-3);color:var(--color-text-muted);max-height:250px;overflow-y:auto;">' + renderMd(data.details) + '</div>';
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
    }

    btn.addEventListener('click', function () {
      modal.classList.add('is-open');

      // Step 1: Show a prompt form so the user can optionally describe what to focus on.
      content.innerHTML =
        '<div style="padding:var(--space-4);">' +
          '<h3 style="margin:0 0 var(--space-2);">Suggest improvements for ' + esc(agentId) + '</h3>' +
          '<p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-3);">Optionally describe what you want the analysis to focus on. Leave blank for a general review.</p>' +
          '<textarea id="sg-focus" rows="3" placeholder="e.g. &quot;Are there missing error handlers?&quot; or &quot;The last run timed out, what can I improve?&quot;" style="width:100%;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-sm);font-family:var(--font-mono);resize:vertical;background:var(--color-surface-raised);color:var(--color-text);"></textarea>' +
          '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-3);">' +
            '<button type="button" class="btn btn--ghost btn--sm" id="sg-prompt-cancel">Cancel</button>' +
            '<button type="button" class="btn btn--primary btn--sm" id="sg-prompt-go">Analyze</button>' +
          '</div>' +
        '</div>';
      document.getElementById('sg-prompt-cancel').addEventListener('click', closeModal);
      document.getElementById('sg-focus').focus();

      document.getElementById('sg-prompt-go').addEventListener('click', function () {
      var focusText = (document.getElementById('sg-focus').value || '').trim();

      // Step 2: Switch to progress view and start analysis.
      var t0 = Date.now();
      var cancelled = false;
      var pollTimer = null;
      var tickTimer = null;

      function showProgress(phaseMsg) {
        var s = Math.round((Date.now() - t0) / 1000);
        content.innerHTML =
          '<div style="padding:var(--space-4);">' +
          '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">' +
            '<div class="spinner"></div>' +
            '<div style="flex:1;"><div style="font-weight:var(--weight-medium);">Analyzing ' + esc(agentId) + '</div>' +
            '<div class="dim" style="font-size:var(--font-size-xs);" id="sg-phase">' + esc(phaseMsg) + '</div></div>' +
            '<div style="font-family:var(--font-mono);font-size:var(--font-size-lg);color:var(--color-text-muted);min-width:3rem;text-align:right;" id="sg-timer">' + s + 's</div>' +
          '</div>' +
          '<div style="height:4px;background:var(--color-border);border-radius:2px;overflow:hidden;margin-bottom:var(--space-3);">' +
            '<div style="height:100%;background:var(--color-primary);border-radius:2px;width:' + Math.min(s/120*100, 98) + '%;transition:width 1s linear;"></div>' +
          '</div>' +
          '<div style="text-align:right;"><button type="button" class="btn btn--ghost btn--sm" id="sg-cancel">Cancel</button></div>' +
          '</div>';
        var ce = document.getElementById('sg-cancel');
        if (ce) ce.addEventListener('click', function () { cancelled = true; clearInterval(tickTimer); clearTimeout(pollTimer); closeModal(); });
      }

      // Initial progress display.
      showProgress(PHASES[0][1]);

      // Timer tick updates the elapsed time + phase messages.
      tickTimer = setInterval(function () {
        var s = Math.round((Date.now() - t0) / 1000);
        var te = document.getElementById('sg-timer'); if (te) te.textContent = s + 's';
        var be = content.querySelector('[style*="background:var(--color-primary)"]'); if (be) be.style.width = Math.min(s/120*100, 98) + '%';
        var pe = document.getElementById('sg-phase'); if (pe) {
          var m = PHASES[0][1]; for (var i = 0; i < PHASES.length; i++) { if (s >= PHASES[i][0]) m = PHASES[i][1]; }
          pe.textContent = m;
        }
      }, 1000);

      // Start the analysis with optional focus text.
      fetch('/agents/' + encodeURIComponent(agentId) + '/analyze', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: focusText ? 'focus=' + encodeURIComponent(focusText) : '',
      })
      .then(function (r) { return r.json(); })
      .then(function (startData) {
        if (!startData.ok || !startData.runId) {
          clearInterval(tickTimer);
          content.innerHTML =
            '<h3 style="margin:0 0 var(--space-3);">Analysis failed</h3>' +
            '<div class="flash flash--error">' + esc(startData.error || 'Failed to start') + '</div>' +
            '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Close</button></div>';
          return;
        }

        var runId = startData.runId;
        var savedCurrentYaml = startData.currentYaml;

        // Poll for progress + results.
        function poll() {
          if (cancelled) return;
          fetch('/agents/' + encodeURIComponent(agentId) + '/analyze/' + encodeURIComponent(runId), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (cancelled) return;
              if (data.status === 'running') {
                // Update phase from server-provided phase message or progress events.
                var pe = document.getElementById('sg-phase');
                if (pe) {
                  if (data.phase) pe.textContent = data.phase;
                  else if (data.progress && data.progress.length > 0) {
                    var latest = data.progress[data.progress.length - 1];
                    if (latest.message) pe.textContent = latest.message;
                  }
                }
                pollTimer = setTimeout(poll, 2000);
              } else if (data.status === 'done') {
                clearInterval(tickTimer);
                data.currentYaml = data.currentYaml || savedCurrentYaml;
                renderResult(data);
              } else {
                clearInterval(tickTimer);
                content.innerHTML =
                  '<h3 style="margin:0 0 var(--space-3);">Analysis failed</h3>' +
                  '<div class="flash flash--error">' + esc(data.error || 'Unknown error') + '</div>' +
                  '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Close</button></div>';
              }
            })
            .catch(function () { if (!cancelled) pollTimer = setTimeout(poll, 3000); });
        }

        pollTimer = setTimeout(poll, 2000);
      })
      .catch(function (err) {
        clearInterval(tickTimer);
        content.innerHTML =
          '<h3 style="margin:0 0 var(--space-3);">Error</h3>' +
          '<div class="flash flash--error">' + esc(String(err)) + '</div>' +
          '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Close</button></div>';
      });
    }); // end sg-prompt-go click
    }); // end suggest-btn click

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-modal')) closeModal();
    });

    // Auto-open from run detail page: ?suggest=1&focus=<error text>
    var params = new URLSearchParams(window.location.search);
    if (params.get('suggest') === '1') {
      btn.click();
      // Pre-fill focus after the modal renders.
      setTimeout(function () {
        var ta = document.getElementById('sg-focus');
        var focusParam = params.get('focus');
        if (ta && focusParam) ta.value = focusParam;
      }, 50);
    }
  })();

  // ── LLM provider/model sync ─────────────────────────────────────────
  // When the provider dropdown changes, repopulate the model dropdown
  // with the correct models and show the selected model's description.
  (function () {
    var providerSel = document.getElementById('llm-provider');
    var modelSel = document.getElementById('llm-model');
    var descEl = document.getElementById('llm-model-desc');
    if (!providerSel || !modelSel || !descEl) return;

    var MODELS = {
      claude: [
        { id: '', label: 'default', desc: 'Uses the Claude CLI default model' },
        { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Most capable. Deep analysis, complex reasoning, long outputs' },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Fast + capable. Good balance of speed and quality' },
        { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fastest. Best for simple tasks, classification, extraction' }
      ],
      codex: [
        { id: '', label: 'default', desc: 'Uses the Codex CLI default model' },
        { id: 'o4-mini', label: 'o4-mini', desc: 'Fast reasoning model. Good for code analysis and generation' },
        { id: 'o3', label: 'o3', desc: 'Most capable reasoning model. Deep multi-step analysis' },
        { id: 'gpt-4.1', label: 'GPT-4.1', desc: 'Latest GPT. Strong at code, instruction following' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', desc: 'Compact GPT-4.1. Fast, lower cost' },
        { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', desc: 'Smallest GPT-4.1. Very fast, simple tasks' }
      ]
    };

    function updateModels() {
      var provider = providerSel.value || 'claude';
      var models = MODELS[provider] || MODELS.claude;
      var currentVal = modelSel.value;
      modelSel.innerHTML = '';
      for (var i = 0; i < models.length; i++) {
        var opt = document.createElement('option');
        opt.value = models[i].id;
        opt.textContent = models[i].label;
        opt.title = models[i].desc;
        if (models[i].id === currentVal) opt.selected = true;
        modelSel.appendChild(opt);
      }
      // If previous value isn't in the new list, select default.
      if (modelSel.value !== currentVal) modelSel.selectedIndex = 0;
      updateDesc();
    }

    function updateDesc() {
      var provider = providerSel.value || 'claude';
      var models = MODELS[provider] || MODELS.claude;
      var selOpt = modelSel.options[modelSel.selectedIndex];
      descEl.textContent = selOpt ? (selOpt.title || '') : '';
    }

    providerSel.addEventListener('change', updateModels);
    modelSel.addEventListener('change', updateDesc);
    // Show description for initial selection.
    updateDesc();
  })();

  // ── Secret save confirmation ───────────────────────────────────────
  // Shows the value one last time with
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

  // ── Build from goal wizard ─────────────────────────────────────────
  // Modal wizard that designs a new agent from a prompt.
  (function () {
    var btn = document.getElementById('build-from-goal-btn');
    var modal = document.getElementById('build-modal');
    var content = document.getElementById('build-modal-content');
    if (!btn || !modal || !content) return;

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function closeModal() { modal.classList.remove('is-open'); }

    btn.addEventListener('click', function () { modal.classList.add('is-open'); });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-close-build')) closeModal();
    });

    var submitBtn = document.getElementById('build-submit-btn');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', function () {
      var goalEl = document.getElementById('build-goal');
      var focusEl = document.getElementById('build-focus');
      var goal = goalEl ? goalEl.value.trim() : '';
      if (!goal) { goalEl && goalEl.focus(); return; }
      var focus = focusEl ? focusEl.value.trim() : '';

      var t0 = Date.now();
      var cancelled = false;
      var pollTimer = null;
      var PHASES = [[0,'Designing agent...'],[5,'Selecting tools...'],[15,'Building node pipeline...'],[30,'Generating YAML...'],[60,'Still working...'],[90,'Almost there...']];

      content.innerHTML =
        '<div style="padding:var(--space-4);">' +
        '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">' +
          '<div class="spinner"></div>' +
          '<div style="flex:1;"><div style="font-weight:var(--weight-medium);">Building agent</div>' +
          '<div class="dim" style="font-size:var(--font-size-xs);" id="build-phase">Designing agent...</div></div>' +
          '<div style="font-family:var(--font-mono);font-size:var(--font-size-lg);color:var(--color-text-muted);min-width:3rem;text-align:right;" id="build-timer">0s</div>' +
        '</div>' +
        '<div style="height:4px;background:var(--color-border);border-radius:2px;overflow:hidden;margin-bottom:var(--space-3);">' +
          '<div id="build-bar" style="height:100%;background:var(--color-primary);border-radius:2px;width:0%;transition:width 1s linear;"></div>' +
        '</div>' +
        '<div style="text-align:right;"><button type="button" class="btn btn--ghost btn--sm" id="build-cancel">Cancel</button></div></div>';

      var serverPhase = '';
      var tickTimer = setInterval(function () {
        var s = Math.round((Date.now() - t0) / 1000);
        var te = document.getElementById('build-timer'); if (te) te.textContent = s + 's';
        var be = document.getElementById('build-bar'); if (be) be.style.width = Math.min(s/120*100, 98) + '%';
        // Only use timer-based fallback phases when no server phase has arrived.
        if (!serverPhase) {
          var pe = document.getElementById('build-phase'); if (pe) {
            var m = PHASES[0][1]; for (var i = 0; i < PHASES.length; i++) { if (s >= PHASES[i][0]) m = PHASES[i][1]; }
            pe.textContent = m;
          }
        }
      }, 1000);

      var ce = document.getElementById('build-cancel');
      if (ce) ce.addEventListener('click', function () { cancelled = true; clearInterval(tickTimer); clearTimeout(pollTimer); closeModal(); });

      fetch('/agents/build', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'goal=' + encodeURIComponent(goal) + (focus ? '&focus=' + encodeURIComponent(focus) : ''),
      })
      .then(function (r) { return r.json(); })
      .then(function (startData) {
        if (!startData.ok || !startData.runId) {
          clearInterval(tickTimer);
          content.innerHTML = '<div class="flash flash--error">' + esc(startData.error || 'Failed') + '</div>' +
            '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Close</button></div>';
          return;
        }
        var runId = startData.runId;

        function poll() {
          if (cancelled) return;
          fetch('/agents/build/' + encodeURIComponent(runId), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (cancelled) return;
              if (data.status === 'running') {
                if (data.phase) {
                  serverPhase = data.phase;
                  var pe = document.getElementById('build-phase');
                  if (pe) pe.textContent = data.phase;
                }
                pollTimer = setTimeout(poll, 2000);
              } else if (data.status === 'done') {
                clearInterval(tickTimer);
                var h = '<h3 style="margin:0 0 var(--space-3);">Agent designed</h3>';
                if (data.agentName) h += '<p style="font-weight:var(--weight-medium);margin:0 0 var(--space-2);">' + esc(data.agentName) + ' <span class="dim">(' + esc(data.agentId) + ')</span></p>';
                if (data.yamlError) {
                  h += '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' +
                    '<strong>Validation error:</strong> ' + esc(data.yamlError) +
                    '<br>Edit the YAML below to fix, then create.</div>';
                }
                if (data.yaml) {
                  h += '<label style="display:flex;flex-direction:column;gap:var(--space-1);margin-bottom:var(--space-3);">' +
                    '<span class="dim" style="font-size:var(--font-size-xs);font-weight:var(--weight-semibold);">Review and edit YAML before creating</span>' +
                    '<textarea id="build-yaml-editor" rows="15" ' +
                    'style="padding:var(--space-3);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);' +
                    'font-family:var(--font-mono);font-size:var(--font-size-xs);resize:vertical;line-height:1.5;tab-size:2;">' +
                    esc(data.yaml) + '</textarea></label>';
                }
                h += '<div id="build-result-flash"></div>';
                h += '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;flex-wrap:wrap;">';
                if (data.yaml) {
                  h += '<button type="button" class="btn btn--primary btn--sm" id="build-create-btn">Create agent</button>';
                }
                h += '<button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Dismiss</button></div>';
                content.innerHTML = h;

                var createBtn = document.getElementById('build-create-btn');
                if (createBtn) {
                  createBtn.addEventListener('click', function () {
                    var yamlEditor = document.getElementById('build-yaml-editor');
                    var yamlText = yamlEditor ? yamlEditor.value : '';
                    if (!yamlText.trim()) return;
                    createBtn.disabled = true;
                    createBtn.textContent = 'Creating...';
                    var flashEl = document.getElementById('build-result-flash');
                    if (flashEl) flashEl.innerHTML = '';
                    fetch('/agents/build/create', {
                      method: 'POST', credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ yaml: yamlText }),
                    })
                    .then(function (r) { return r.json(); })
                    .then(function (result) {
                      if (result.ok) {
                        window.location.href = '/agents/' + encodeURIComponent(result.agentId);
                      } else {
                        createBtn.disabled = false;
                        createBtn.textContent = 'Create agent';
                        // If agent already exists, show a link to it.
                        var msg = result.error || 'Creation failed';
                        var existsMatch = msg.match(/["']([a-z0-9][a-z0-9-]*)["'] already exists/i);
                        if (existsMatch && flashEl) {
                          flashEl.innerHTML = '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' +
                            esc(msg) + ' <a href="/agents/' + encodeURIComponent(existsMatch[1]) + '" style="font-weight:var(--weight-semibold);">Open existing agent \u2192</a></div>';
                        } else if (flashEl) {
                          flashEl.innerHTML = '<div class="flash flash--error" style="margin-bottom:var(--space-3);font-size:var(--font-size-xs);">' + esc(msg) + '</div>';
                        }
                      }
                    });
                  });
                }
              } else {
                clearInterval(tickTimer);
                content.innerHTML = '<div class="flash flash--error">' + esc(data.error || 'Build failed') + '</div>' +
                  '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Close</button></div>';
              }
            })
            .catch(function () { if (!cancelled) pollTimer = setTimeout(poll, 3000); });
        }
        pollTimer = setTimeout(poll, 2000);
      })
      .catch(function (err) {
        clearInterval(tickTimer);
        content.innerHTML = '<div class="flash flash--error">' + esc(String(err)) + '</div>' +
          '<div style="margin-top:var(--space-3);text-align:right;"><button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Close</button></div>';
      });
    });
  })();
})();
`;
