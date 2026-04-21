/**
 * Inline JS — core dashboard utilities.
 *
 * Large feature modules (pulse layout, suggest improvements, build-from-goal,
 * template palette) have been extracted to separate *.js.ts files and are
 * concatenated in layout.ts.
 *
 * What remains here: community-shell modal, tool-picker, node-type toggle,
 * ESC handler, confirm-before-submit, node-vars filter, run status poll,
 * run-now modal, LLM provider/model sync, secret save confirmation.
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

})();
`;
