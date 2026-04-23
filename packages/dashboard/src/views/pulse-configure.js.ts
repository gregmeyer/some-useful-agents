/**
 * Pulse configure tile modal: template picker, mapping form, metadata fields.
 * Opens when the gear icon is clicked on a non-system tile.
 */
export const PULSE_CONFIGURE_JS = `
  (function () {
    var modal = null;
    var registry = null;
    var currentAgentId = null;
    var currentConfig = null;
    var currentOutputFields = [];

    var ACCENT_COLORS = {
      '': '#6b7280',
      teal: '#2dd4bf',
      blue: '#60a5fa',
      green: '#4ade80',
      orange: '#fb923c',
      red: '#f87171',
      purple: '#a78bfa',
    };

    // Layout hint per template — shows how the template arranges data.
    var LAYOUT_HINTS = {
      'metric': '\\u250C\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502  42ms   \\u2502\\n\\u2502  label  \\u2502\\n\\u2514\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2518',
      'time-series': 'Sparkline chart + current value',
      'text-headline': 'Bold headline\\nBody text below',
      'table': 'Column headers\\nRow 1  Row 2  Row 3',
      'status': '\\u25CF healthy \\u2014 message',
      'comparison': 'Left value  vs  Right value',
      'key-value': 'Label: Value\\nLabel: Value\\nLabel: Value',
      'story': 'What changed (bold)\\nTime period (badge)\\nWhat it means (body)',
      'funnel': '\\u2588\\u2588\\u2588\\u2588\\u2588\\u2588\\u2588\\u2588 Stage 1\\n\\u2588\\u2588\\u2588\\u2588\\u2588\\u2588 Stage 2\\n\\u2588\\u2588\\u2588\\u2588 Stage 3',
      'media': 'Image/video player + caption',
      'text-image': 'Text alongside image',
      'image': 'Full image display',
    };

    function getRegistry() {
      if (registry) return registry;
      var el = document.getElementById('pulse-template-registry');
      if (!el) return {};
      try { registry = JSON.parse(el.textContent || '{}'); } catch { registry = {}; }
      return registry;
    }

    function ensureModal() {
      if (modal) return;
      modal = document.createElement('div');
      modal.className = 'pulse-configure-modal';
      modal.style.display = 'none';
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
      document.body.appendChild(modal);
    }

    function closeModal() {
      if (modal) modal.style.display = 'none';
      currentAgentId = null;
      currentConfig = null;
    }

    function accentSwatch(value, label, selected) {
      var color = ACCENT_COLORS[value] || '#6b7280';
      var border = selected ? '2px solid var(--color-primary)' : '2px solid transparent';
      return '<button type="button" class="cfg-accent-btn" data-accent="' + esc(value) + '" ' +
        'style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:var(--radius-sm);border:' + border + ';background:var(--color-surface-raised);cursor:pointer;" ' +
        'title="' + esc(label) + '">' +
        '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + color + ';"></span>' +
        '<span style="font-size:var(--font-size-xs);">' + esc(label) + '</span>' +
        '</button>';
    }

    function openModal(agentId, config, outputFields) {
      ensureModal();
      currentAgentId = agentId;
      currentConfig = config;
      currentOutputFields = outputFields || [];

      var reg = getRegistry();
      var selectedTemplate = config.template || 'metric';
      var currentAccent = config.accent || '';

      var accentSwatches = '';
      var accentEntries = [['', 'None'], ['teal', 'Teal'], ['blue', 'Blue'], ['green', 'Green'], ['orange', 'Orange'], ['red', 'Red'], ['purple', 'Purple']];
      for (var a = 0; a < accentEntries.length; a++) {
        accentSwatches += accentSwatch(accentEntries[a][0], accentEntries[a][1], accentEntries[a][0] === currentAccent);
      }

      modal.innerHTML = '<div class="pulse-configure-modal__content">' +
        '<div class="pulse-configure-modal__header">' +
          '<h3 style="margin: 0;">Configure tile</h3>' +
          '<button type="button" class="pulse-configure-modal__close" title="Close">\\u00D7</button>' +
        '</div>' +
        '<form method="POST" action="/agents/' + encodeURIComponent(agentId) + '/signal" class="pulse-configure-modal__form">' +

          // Template picker
          '<div class="pulse-configure-modal__section">' +
            '<label class="pulse-configure-modal__label">Template</label>' +
            '<div class="pulse-configure-modal__templates" id="cfg-template-grid"></div>' +
            '<div id="cfg-template-hint" class="cfg-template-hint"></div>' +
          '</div>' +

          '<hr class="cfg-divider">' +

          // Title
          '<div class="pulse-configure-modal__section">' +
            '<label class="pulse-configure-modal__label">Title</label>' +
            '<input type="text" name="title" value="' + esc(config.title || '') + '" class="input" style="width: 100%;">' +
          '</div>' +

          // Icon + Size row
          '<div class="pulse-configure-modal__section" style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4);">' +
            '<div>' +
              '<label class="pulse-configure-modal__label">Icon</label>' +
              '<input type="text" name="icon" value="' + esc(config.icon || '') + '" class="input" style="width: 100%;" placeholder="emoji or symbol">' +
            '</div>' +
            '<div>' +
              '<label class="pulse-configure-modal__label">Size</label>' +
              '<select name="size" class="input" style="width: 100%;">' +
                '<option value="1x1"' + (config.size === '1x1' ? ' selected' : '') + '>1\\u00D71</option>' +
                '<option value="2x1"' + (config.size === '2x1' ? ' selected' : '') + '>2\\u00D71 (wide)</option>' +
                '<option value="1x2"' + (config.size === '1x2' ? ' selected' : '') + '>1\\u00D72 (tall)</option>' +
                '<option value="2x2"' + (config.size === '2x2' ? ' selected' : '') + '>2\\u00D72 (large)</option>' +
              '</select>' +
            '</div>' +
          '</div>' +

          // Accent
          '<div class="pulse-configure-modal__section">' +
            '<label class="pulse-configure-modal__label">Accent</label>' +
            '<div style="display: flex; flex-wrap: wrap; gap: var(--space-2);" id="cfg-accent-row">' +
              accentSwatches +
            '</div>' +
            '<input type="hidden" name="accent" id="cfg-accent-value" value="' + esc(currentAccent) + '">' +
          '</div>' +

          // Refresh
          '<div class="pulse-configure-modal__section">' +
            '<label class="pulse-configure-modal__label">Auto-refresh</label>' +
            '<input type="text" name="refresh" value="' + esc(config.refresh || '') + '" class="input" style="width: 100%;" placeholder="e.g. 5m, 1h, 24h (leave empty to disable)">' +
          '</div>' +

          '<hr class="cfg-divider">' +

          // Field mapping
          '<div class="pulse-configure-modal__section">' +
            '<label class="pulse-configure-modal__label">Field mapping</label>' +
            '<p style="font-size:var(--font-size-xs);color:var(--color-text-subtle);margin:0 0 var(--space-2);">Map your agent\\u2019s output fields to the template\\u2019s display slots.</p>' +
            '<div id="cfg-mapping-form"></div>' +
          '</div>' +

          '<input type="hidden" name="template" id="cfg-template-value" value="' + esc(selectedTemplate) + '">' +
          '<input type="hidden" name="mapping" id="cfg-mapping-value" value="">' +

          '<div class="pulse-configure-modal__footer">' +
            '<button type="button" class="btn btn--ghost btn--sm" onclick="this.closest(\\'.pulse-configure-modal\\').style.display=\\'none\\'">Cancel</button>' +
            '<button type="submit" class="btn btn--primary btn--sm">Save</button>' +
          '</div>' +
        '</form>' +
      '</div>';

      // Close button
      modal.querySelector('.pulse-configure-modal__close').addEventListener('click', closeModal);

      // Accent swatch click
      var accentBtns = modal.querySelectorAll('.cfg-accent-btn');
      for (var ab = 0; ab < accentBtns.length; ab++) {
        accentBtns[ab].addEventListener('click', function () {
          var val = this.getAttribute('data-accent');
          document.getElementById('cfg-accent-value').value = val;
          var all = modal.querySelectorAll('.cfg-accent-btn');
          for (var j = 0; j < all.length; j++) all[j].style.border = '2px solid transparent';
          this.style.border = '2px solid var(--color-primary)';
        });
      }

      // Score templates by how well they match the agent's output fields.
      function scoreFit(tpl) {
        if (!tpl.slots || tpl.slots.length === 0) return 0;
        var requiredSlots = tpl.slots.filter(function(s) { return s.required; });
        if (requiredSlots.length === 0) return 0;
        var matched = 0;
        for (var s = 0; s < requiredSlots.length; s++) {
          if (currentOutputFields.indexOf(requiredSlots[s].name) !== -1) matched++;
        }
        return matched / requiredSlots.length;
      }

      // Build template picker grid
      var grid = document.getElementById('cfg-template-grid');
      var templateNames = Object.keys(reg);
      // Find best-fit template for "Suggested" badge.
      var bestFitName = '';
      var bestFitScore = 0;
      for (var b = 0; b < templateNames.length; b++) {
        var score = scoreFit(reg[templateNames[b]]);
        if (score > bestFitScore) { bestFitScore = score; bestFitName = templateNames[b]; }
      }

      for (var i = 0; i < templateNames.length; i++) {
        var t = reg[templateNames[i]];
        var isSuggested = t.name === bestFitName && bestFitScore > 0;
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'pulse-configure-modal__tpl-card' + (t.name === selectedTemplate ? ' is-active' : '') + (isSuggested ? ' is-suggested' : '');
        card.setAttribute('data-template', t.name);
        card.innerHTML = '<span class="pulse-configure-modal__tpl-icon">' + (t.icon || '') + '</span>' +
          '<span class="pulse-configure-modal__tpl-name">' + esc(t.displayName) + '</span>' +
          (isSuggested ? '<span class="cfg-suggested-badge">Suggested</span>' : '');
        card.title = t.description || '';
        card.addEventListener('click', (function (name) {
          return function () {
            document.getElementById('cfg-template-value').value = name;
            var cards = grid.querySelectorAll('.pulse-configure-modal__tpl-card');
            for (var j = 0; j < cards.length; j++) cards[j].classList.remove('is-active');
            this.classList.add('is-active');
            renderMappingForm(name);
            updateTemplateHint(name);
          };
        })(t.name));
        grid.appendChild(card);
      }

      // Initial template hint + mapping form
      updateTemplateHint(selectedTemplate);
      renderMappingForm(selectedTemplate);

      // Serialize mapping on submit
      modal.querySelector('form').addEventListener('submit', function () {
        var mappingObj = {};
        var rows = document.querySelectorAll('#cfg-mapping-form .cfg-mapping-row');
        for (var r = 0; r < rows.length; r++) {
          var slotName = rows[r].getAttribute('data-slot');
          var select = rows[r].querySelector('select');
          var literalInput = rows[r].querySelector('.cfg-literal-input');
          if (select && select.value === '__literal__' && literalInput) {
            mappingObj[slotName] = literalInput.value;
          } else if (select) {
            mappingObj[slotName] = select.value;
          }
        }
        document.getElementById('cfg-mapping-value').value = JSON.stringify(mappingObj);
      });

      modal.style.display = 'flex';
    }

    function updateTemplateHint(templateName) {
      var hint = document.getElementById('cfg-template-hint');
      if (!hint) return;
      var reg = getRegistry();
      var tpl = reg[templateName];
      if (!tpl) { hint.innerHTML = ''; return; }

      var layout = LAYOUT_HINTS[templateName] || tpl.description || '';
      hint.innerHTML =
        '<div class="cfg-template-hint__inner">' +
          '<div class="cfg-template-hint__desc">' + esc(tpl.description) + '</div>' +
          (layout ? '<pre class="cfg-template-hint__layout">' + esc(layout) + '</pre>' : '') +
        '</div>';
    }

    function renderMappingForm(templateName) {
      var reg = getRegistry();
      var tpl = reg[templateName];
      var container = document.getElementById('cfg-mapping-form');
      if (!container || !tpl) return;
      container.innerHTML = '';

      var currentMapping = currentConfig.mapping || {};

      if (tpl.slots.length === 0) {
        container.innerHTML = '<p style="font-size: var(--font-size-xs); color: var(--color-text-muted);">This template has no configurable slots.</p>';
        return;
      }

      for (var i = 0; i < tpl.slots.length; i++) {
        var slot = tpl.slots[i];
        var row = document.createElement('div');
        row.className = 'cfg-mapping-row';
        row.setAttribute('data-slot', slot.name);

        var label = document.createElement('label');
        label.className = 'cfg-mapping-label';
        label.innerHTML = esc(slot.label) + (slot.required ? ' <span style="color:var(--color-err);">*</span>' : '') +
          ' <span class="cfg-slot-type">' + esc(slot.type) + '</span>';
        row.appendChild(label);

        var select = document.createElement('select');
        select.className = 'input cfg-mapping-select';

        // Add output field options
        var currentVal = currentMapping[slot.name] || '';
        var hasFieldMatch = false;

        for (var f = 0; f < currentOutputFields.length; f++) {
          var opt = document.createElement('option');
          opt.value = currentOutputFields[f];
          opt.textContent = currentOutputFields[f];
          if (currentVal === currentOutputFields[f]) {
            opt.selected = true;
            hasFieldMatch = true;
          }
          select.appendChild(opt);
        }

        // "result" option (raw output)
        var resultOpt = document.createElement('option');
        resultOpt.value = 'result';
        resultOpt.textContent = 'result (raw output)';
        if (currentVal === 'result') { resultOpt.selected = true; hasFieldMatch = true; }
        select.appendChild(resultOpt);

        // Literal option
        var litOpt = document.createElement('option');
        litOpt.value = '__literal__';
        litOpt.textContent = 'Literal value...';
        if (currentVal && !hasFieldMatch) { litOpt.selected = true; }
        select.appendChild(litOpt);

        row.appendChild(select);

        // Literal input (shown when literal is selected)
        var litInput = document.createElement('input');
        litInput.type = 'text';
        litInput.className = 'input cfg-literal-input';
        litInput.placeholder = 'Enter literal value';
        litInput.value = (!hasFieldMatch && currentVal) ? currentVal : '';
        litInput.style.display = (!hasFieldMatch && currentVal) ? '' : 'none';
        row.appendChild(litInput);

        select.addEventListener('change', (function (input) {
          return function () {
            input.style.display = this.value === '__literal__' ? '' : 'none';
          };
        })(litInput));

        container.appendChild(row);
      }
    }

    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Click handler for gear buttons
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.pulse-tile__configure-btn') : null;
      if (!btn) return;
      var agentId = btn.getAttribute('data-tile-id');
      if (!agentId) return;

      var header = btn.closest('.pulse-tile__header');
      if (!header) return;

      var config = {};
      var outputFields = [];
      try { config = JSON.parse(header.getAttribute('data-signal-config') || '{}'); } catch {}
      try { outputFields = JSON.parse(header.getAttribute('data-output-fields') || '[]'); } catch {}

      openModal(agentId, config, outputFields);
    });
  })();
`;
