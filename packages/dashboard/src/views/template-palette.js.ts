/**
 * Template palette autocomplete JS: autocomplete for $ (shell) and {{ (claude-code)
 * in node command/prompt textareas.
 *
 * Extracted from js.ts. Inlined via layout.ts.
 */
export const TEMPLATE_PALETTE_JS = `
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
        if (/\\\\s/.test(c)) return null;
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
`;
