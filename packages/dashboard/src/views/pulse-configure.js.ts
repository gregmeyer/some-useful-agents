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

    function openModal(agentId, config, outputFields) {
      ensureModal();
      currentAgentId = agentId;
      currentConfig = config;
      currentOutputFields = outputFields || [];

      var reg = getRegistry();
      var selectedTemplate = config.template || 'metric';

      modal.innerHTML = '<div class="pulse-configure-modal__content">' +
        '<div class="pulse-configure-modal__header">' +
          '<h3 style="margin: 0;">Configure tile</h3>' +
          '<button type="button" class="pulse-configure-modal__close" title="Close">\\u00D7</button>' +
        '</div>' +
        '<form method="POST" action="/agents/' + encodeURIComponent(agentId) + '/signal" class="pulse-configure-modal__form">' +
          '<div class="pulse-configure-modal__section">' +
            '<label class="pulse-configure-modal__label">Template</label>' +
            '<div class="pulse-configure-modal__templates" id="cfg-template-grid"></div>' +
          '</div>' +
          '<div class="pulse-configure-modal__section">' +
            '<label class="pulse-configure-modal__label">Title</label>' +
            '<input type="text" name="title" value="' + esc(config.title || '') + '" class="input" style="width: 100%;">' +
          '</div>' +
          '<div class="pulse-configure-modal__section" style="display: flex; gap: var(--space-3);">' +
            '<div style="flex: 1;">' +
              '<label class="pulse-configure-modal__label">Icon</label>' +
              '<input type="text" name="icon" value="' + esc(config.icon || '') + '" class="input" style="width: 100%;" placeholder="emoji or symbol">' +
            '</div>' +
            '<div style="flex: 1;">' +
              '<label class="pulse-configure-modal__label">Size</label>' +
              '<select name="size" class="input" style="width: 100%;">' +
                '<option value="1x1"' + (config.size === '1x1' ? ' selected' : '') + '>1\\u00D71</option>' +
                '<option value="2x1"' + (config.size === '2x1' ? ' selected' : '') + '>2\\u00D71 (wide)</option>' +
                '<option value="1x2"' + (config.size === '1x2' ? ' selected' : '') + '>1\\u00D72 (tall)</option>' +
                '<option value="2x2"' + (config.size === '2x2' ? ' selected' : '') + '>2\\u00D72 (large)</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="pulse-configure-modal__section" style="display: flex; gap: var(--space-3);">' +
            '<div style="flex: 1;">' +
              '<label class="pulse-configure-modal__label">Accent</label>' +
              '<select name="accent" class="input" style="width: 100%;">' +
                '<option value=""' + (!config.accent ? ' selected' : '') + '>None</option>' +
                '<option value="teal"' + (config.accent === 'teal' ? ' selected' : '') + '>Teal</option>' +
                '<option value="blue"' + (config.accent === 'blue' ? ' selected' : '') + '>Blue</option>' +
                '<option value="green"' + (config.accent === 'green' ? ' selected' : '') + '>Green</option>' +
                '<option value="orange"' + (config.accent === 'orange' ? ' selected' : '') + '>Orange</option>' +
                '<option value="red"' + (config.accent === 'red' ? ' selected' : '') + '>Red</option>' +
                '<option value="purple"' + (config.accent === 'purple' ? ' selected' : '') + '>Purple</option>' +
              '</select>' +
            '</div>' +
            '<div style="flex: 1;">' +
              '<label class="pulse-configure-modal__label">Refresh</label>' +
              '<input type="text" name="refresh" value="' + esc(config.refresh || '') + '" class="input" style="width: 100%;" placeholder="e.g. 5m, 1h">' +
            '</div>' +
          '</div>' +
          '<div class="pulse-configure-modal__section">' +
            '<label class="pulse-configure-modal__label">Field mapping</label>' +
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

      // Build template picker grid
      var grid = document.getElementById('cfg-template-grid');
      var templateNames = Object.keys(reg);
      for (var i = 0; i < templateNames.length; i++) {
        var t = reg[templateNames[i]];
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'pulse-configure-modal__tpl-card' + (t.name === selectedTemplate ? ' is-active' : '');
        card.setAttribute('data-template', t.name);
        card.innerHTML = '<span class="pulse-configure-modal__tpl-icon">' + (t.icon || '') + '</span>' +
          '<span class="pulse-configure-modal__tpl-name">' + esc(t.displayName) + '</span>';
        card.title = t.description || '';
        card.addEventListener('click', (function (name) {
          return function () {
            document.getElementById('cfg-template-value').value = name;
            var cards = grid.querySelectorAll('.pulse-configure-modal__tpl-card');
            for (var j = 0; j < cards.length; j++) cards[j].classList.remove('is-active');
            this.classList.add('is-active');
            renderMappingForm(name);
          };
        })(t.name));
        grid.appendChild(card);
      }

      // Initial mapping form
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
        label.style.cssText = 'font-size: var(--font-size-xs); color: var(--color-text-muted); display: block; margin-bottom: 2px;';
        label.textContent = slot.label + (slot.required ? ' *' : '');
        row.appendChild(label);

        var select = document.createElement('select');
        select.className = 'input';
        select.style.cssText = 'width: 100%; margin-bottom: var(--space-2);';

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
        litInput.style.cssText = 'width: 100%; margin-bottom: var(--space-2);';
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
