/**
 * Agent detail page helpers — form renderers, model data, small utilities.
 * Extracted from agent-detail-v2.ts.
 */

import type { Agent, OutputWidgetType, WidgetFieldType } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { WIDGET_TYPES as WIDGET_TYPE_INFO, FIELD_TYPES as FIELD_TYPE_INFO, EXAMPLE_WIDGETS } from './output-widget-help.js';

// ── Run inputs form ─────────────────────────────────────────────────────

export function renderRunInputsForm(agent: Agent, from?: string, previousInputs?: Record<string, string>): SafeHtml {
  const inputs = Object.entries(agent.inputs ?? {});
  const FIELD = 'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: var(--font-mono); width: 100%;';

  if (inputs.length === 0) {
    return html`
      <div style="text-align: center; padding: var(--space-6);">
        <div class="spinner" style="margin: 0 auto var(--space-3);"></div>
        <p style="font-weight: var(--weight-medium); margin: 0 0 var(--space-2);">Running ${agent.id}...</p>
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">Starting execution.</p>
      </div>
    `;
  }

  const fields = inputs.map(([name, spec]) => {
    // Previous run's value takes priority over spec default.
    const prevVal = previousInputs?.[name];
    const defVal = prevVal !== undefined ? prevVal : (spec.default !== undefined ? String(spec.default) : '');
    const reqLabel = spec.required !== false && spec.default === undefined
      ? html`<span style="color: var(--color-err); font-size: var(--font-size-xs);">required</span>`
      : html`<span class="dim" style="font-size: var(--font-size-xs);">optional</span>`;
    const desc = spec.description ? html`<span class="dim" style="font-size: var(--font-size-xs);">${spec.description}</span>` : html``;
    const isRequired = spec.required !== false && spec.default === undefined;

    // Render the appropriate input control based on type.
    let inputEl: SafeHtml;
    if (spec.type === 'enum' && Array.isArray(spec.values) && spec.values.length > 0) {
      const options = spec.values.map((v) => {
        const val = String(v);
        const selected = val === defVal ? ' selected' : '';
        return `<option value="${val}"${selected}>${val}</option>`;
      });
      inputEl = unsafeHtml(`<select name="input_${name}" style="${FIELD}">${options.join('')}</select>`);
    } else if (spec.type === 'boolean') {
      inputEl = unsafeHtml(
        `<select name="input_${name}" style="${FIELD}">` +
        `<option value="true"${defVal === 'true' ? ' selected' : ''}>true</option>` +
        `<option value="false"${defVal !== 'true' ? ' selected' : ''}>false</option>` +
        `</select>`
      );
    } else {
      inputEl = html`<input type="text" name="input_${name}" value="${defVal}" placeholder="${defVal || '(empty)'}" style="${FIELD}" ${isRequired ? 'required' : ''}>`;
    }

    return html`
      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3);">
        <div style="display: flex; align-items: baseline; gap: var(--space-2);">
          <strong style="font-size: var(--font-size-sm);">${name}</strong>
          <span class="badge badge--muted" style="font-size: 9px;">${spec.type}</span>
          ${reqLabel}
        </div>
        ${inputEl}
        ${desc}
      </label>
    `;
  });

  return html`
    <form method="POST" action="/agents/${agent.id}/run" data-run-form="${agent.id}">
      ${from ? html`<input type="hidden" name="from" value="${from}">` : html``}
      <h3 style="margin: 0 0 var(--space-3);">Run ${agent.id}</h3>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-4);">Set input values for this run.</p>
      ${fields as unknown as SafeHtml[]}
      <div style="display: flex; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-3);">
        <button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Cancel</button>
        <button type="submit" class="btn btn--primary btn--sm">Run</button>
      </div>
    </form>
  `;
}

// ── Variables editor ────────────────────────────────────────────────────

export function renderVariablesEditor(agent: Agent): SafeHtml {
  const inputs = Object.entries(agent.inputs ?? {});
  const FIELD = 'padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);';

  const inputRows = inputs.map(([name, spec]) => {
    const defVal = spec.default !== undefined ? String(spec.default) : '';
    const desc = spec.description ?? '';
    const valsStr = Array.isArray((spec as { values?: string[] }).values)
      ? ((spec as { values?: string[] }).values ?? []).join(', ')
      : '';
    return html`
      <tr>
        <td class="mono">${name}<input type="hidden" name="inputName[]" value="${name}"></td>
        <td>${typeSelect(`type_${name}`, spec.type)}</td>
        <td><input type="text" name="default_${name}" value="${defVal}" placeholder="(none)" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
        <td><input type="text" name="values_${name}" value="${valsStr}" placeholder="a, b, c (enum only)" style="${FIELD} font-family: var(--font-mono); width: 14rem;"></td>
        <td><input type="text" name="description_${name}" value="${desc}" placeholder="(none)" style="${FIELD} width: 14rem;"></td>
      </tr>
    `;
  });

  const newRow = html`
    <tr style="border-top: 2px solid var(--color-border);">
      <td><input type="text" name="newInputName" placeholder="NEW_VAR" pattern="[A-Z_][A-Z0-9_]*" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
      <td><select name="newInputType" style="${FIELD}"><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="enum">enum</option></select></td>
      <td><input type="text" name="newInputDefault" placeholder="default" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
      <td><input type="text" name="newInputValues" placeholder="a, b, c (enum only)" style="${FIELD} font-family: var(--font-mono); width: 14rem;"></td>
      <td><input type="text" name="newInputDescription" placeholder="description" style="${FIELD} width: 14rem;"></td>
    </tr>
  `;

  return html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Agent-level inputs. Referenced as <code>$NAME</code> in shell or <code>{{inputs.NAME}}</code> in prompts.
    </p>
    <form method="POST" action="/agents/${agent.id}/inputs/update">
      <table class="table" style="font-size: var(--font-size-xs); margin-bottom: var(--space-3);">
        <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Values (enum)</th><th>Description</th></tr></thead>
        <tbody>${inputRows as unknown as SafeHtml[]}${newRow}</tbody>
      </table>
      <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
        <button type="submit" class="btn btn--primary btn--sm">Save variables</button>
      </div>
    </form>
  `;
}

// ── Output widget editor ────────────────────────────────────────────────

const WIDGET_TYPES: OutputWidgetType[] = ['dashboard', 'key-value', 'diff-apply', 'raw', 'ai-template'];
const FIELD_TYPES: WidgetFieldType[] = ['text', 'code', 'badge', 'metric', 'stat', 'preview', 'action'];

function widgetTypeSelect(current: string): string {
  const opts = WIDGET_TYPES.map((t) =>
    `<option value="${t}"${t === current ? ' selected' : ''}>${t}</option>`
  ).join('');
  return `<select name="widgetType" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);">${opts}</select>`;
}

function fieldTypeSelect(name: string, current: string): string {
  const opts = FIELD_TYPES.map((t) =>
    `<option value="${t}"${t === current ? ' selected' : ''}>${t}</option>`
  ).join('');
  return `<select name="${name}" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);">${opts}</select>`;
}

export function renderOutputWidgetEditor(agent: Agent): SafeHtml {
  const widget = agent.outputWidget;
  const currentType: OutputWidgetType = widget?.type ?? 'raw';
  const FIELD = 'padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);';

  // Widget cards
  const cards = WIDGET_TYPES.map((t) => {
    const info = WIDGET_TYPE_INFO[t];
    const active = t === currentType ? ' is-active' : '';
    return unsafeHtml(`
      <button type="button" class="ow-card${active}" data-widget-type="${t}" style="
        text-align: left;
        padding: var(--space-3);
        border: 2px solid ${t === currentType ? 'var(--color-primary)' : 'var(--color-border)'};
        border-radius: var(--radius-sm);
        background: var(--color-surface-raised);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      ">
        <div style="font-weight: var(--weight-bold); font-size: var(--font-size-sm);">${info.displayName}</div>
        <div class="dim" style="font-size: var(--font-size-xs); line-height: 1.4;">${info.description}</div>
        <pre style="margin: var(--space-2) 0 0; font-size: 10px; color: var(--color-text-muted); white-space: pre-wrap; line-height: 1.3;">${info.layoutHint}</pre>
      </button>
    `);
  });

  // Example dropdown
  const exampleOptions = Object.entries(EXAMPLE_WIDGETS).map(
    ([key, ex]) => `<option value="${key}">${ex.label} — ${ex.description}</option>`,
  ).join('');

  // Field rows
  const fieldRows = (widget?.fields ?? []).map((f, i) => unsafeHtml(`
    <tr data-row="${i}">
      <td><input type="text" name="fieldName_${i}" value="${f.name}" style="${FIELD} font-family: var(--font-mono); width: 8rem;"></td>
      <td><input type="text" name="fieldLabel_${i}" value="${f.label ?? ''}" placeholder="${f.name}" style="${FIELD} width: 8rem;"></td>
      <td>${fieldTypeSelectWithTooltip(`fieldType_${i}`, f.type, currentType)}</td>
      <td><button type="button" class="btn btn--ghost btn--sm ow-remove-row" style="padding: 2px 6px; font-size: var(--font-size-xs); color: var(--color-err);">\u00D7</button></td>
    </tr>
  `));

  const helperCopyJson = JSON.stringify(
    Object.fromEntries(WIDGET_TYPES.map((t) => [t, WIDGET_TYPE_INFO[t].helperCopy])),
  );
  const compatByType = JSON.stringify(
    Object.fromEntries(WIDGET_TYPES.map((t) => [t, WIDGET_TYPE_INFO[t].compatibleFields])),
  );
  const fieldTypeDescs = JSON.stringify(
    Object.fromEntries(FIELD_TYPES.map((ft) => [ft, FIELD_TYPE_INFO[ft].description])),
  );
  const examplesJson = JSON.stringify(EXAMPLE_WIDGETS);

  return html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Controls how run output renders on the agent detail page. Pick a widget, declare which output fields show up, and preview the result before saving.
    </p>

    <form method="POST" action="/agents/${agent.id}/output-widget/update" id="ow-form">
      <input type="hidden" name="widgetType" id="ow-widget-type" value="${currentType}">

      <div class="ow-cards" id="ow-cards" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--space-2); margin-bottom: var(--space-3);">
        ${cards as unknown as SafeHtml[]}
      </div>

      <p id="ow-helper" class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3); line-height: 1.5; background: var(--color-surface); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); border-left: 3px solid var(--color-primary);">
        ${WIDGET_TYPE_INFO[currentType].helperCopy}
      </p>

      <div id="ow-fields-block">
        <table class="table" style="font-size: var(--font-size-xs); margin-bottom: var(--space-3);">
          <thead><tr><th>Field name</th><th>Label</th><th>Type</th><th></th></tr></thead>
          <tbody id="widget-fields">
            ${fieldRows as unknown as SafeHtml[]}
          </tbody>
        </table>
      </div>

      <div id="ow-ai-block" style="display: ${currentType === 'ai-template' ? 'block' : 'none'}; margin-bottom: var(--space-3);">
        <label style="display: block; font-size: var(--font-size-xs); font-weight: var(--weight-medium); color: var(--color-text-muted); margin-bottom: var(--space-1);">Describe the layout</label>
        <textarea name="prompt" id="ow-ai-prompt" rows="4" style="width: 100%; ${FIELD} font-family: var(--font-mono);" placeholder="A card showing the run score, status pill, and a sparkline of the last 7 results.">${widget?.prompt ?? ''}</textarea>

        <div style="display: flex; gap: var(--space-2); align-items: center; margin: var(--space-2) 0;">
          <button type="button" class="btn btn--ghost btn--sm" id="ow-ai-generate">${widget?.template ? 'Regenerate' : 'Generate'} template</button>
          <select id="ow-ai-provider" style="${FIELD}">
            <option value="claude" selected>Claude</option>
          </select>
          <span id="ow-ai-status" class="dim" style="font-size: var(--font-size-xs);"></span>
        </div>

        <details ${widget?.template ? '' : 'open'} style="margin-bottom: var(--space-2);">
          <summary style="cursor: pointer; font-size: var(--font-size-xs); color: var(--color-text-muted);">${widget?.template ? 'Generated HTML (edit to tune)' : 'Template HTML'}</summary>
          <textarea name="template" id="ow-ai-template" rows="8" style="width: 100%; ${FIELD} font-family: var(--font-mono); margin-top: var(--space-2);" placeholder="Click Generate to fill, or paste HTML.">${widget?.template ?? ''}</textarea>
        </details>

        <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">
          Reference output values via <code>{{outputs.NAME}}</code> or <code>{{result}}</code>. Sanitized to a tag/attribute allowlist before save.
        </p>
      </div>

      <div style="display: flex; gap: var(--space-2); justify-content: space-between; align-items: center; flex-wrap: wrap; margin-bottom: var(--space-3);">
        <div style="display: flex; gap: var(--space-2); align-items: center;">
          <button type="button" class="btn btn--ghost btn--sm" id="add-widget-field-btn">+ Add field</button>
          <select id="ow-example" style="${FIELD}">
            <option value="">Load example…</option>
            ${unsafeHtml(exampleOptions)}
          </select>
        </div>
        <div style="display: flex; gap: var(--space-2);">
          ${widget ? html`<button type="submit" name="action" value="remove" class="btn btn--ghost btn--sm" style="color: var(--color-err);">Remove widget</button>` : html``}
          <button type="submit" name="action" value="save" class="btn btn--primary btn--sm">Save widget</button>
        </div>
      </div>
    </form>

    <div class="card" style="margin-top: var(--space-3);">
      <p class="card__title" style="display: flex; align-items: center; justify-content: space-between;">
        Preview
        <span class="dim" style="font-size: var(--font-size-xs); font-weight: var(--weight-regular);">rendered with sample data</span>
      </p>
      <div id="ow-preview" class="dim" style="font-size: var(--font-size-xs); padding: var(--space-3); background: var(--color-surface); border-radius: var(--radius-sm); min-height: 4rem;">
        Add a field to see the preview.
      </div>
    </div>

    ${unsafeHtml(`<script>
    (function () {
      var AGENT_ID = ${JSON.stringify(agent.id)};
      var FIELD_TYPES = ${JSON.stringify(FIELD_TYPES)};
      var HELPERS = ${helperCopyJson};
      var COMPAT = ${compatByType};
      var FIELD_DESCS = ${fieldTypeDescs};
      var EXAMPLES = ${examplesJson};

      var form = document.getElementById('ow-form');
      var hidden = document.getElementById('ow-widget-type');
      var helper = document.getElementById('ow-helper');
      var cards = document.getElementById('ow-cards');
      var tbody = document.getElementById('widget-fields');
      var addBtn = document.getElementById('add-widget-field-btn');
      var exampleSel = document.getElementById('ow-example');
      var preview = document.getElementById('ow-preview');

      function currentWidget() { return hidden.value; }
      function activeCard() { return cards.querySelector('.ow-card.is-active'); }

      function selectCard(type) {
        hidden.value = type;
        var all = cards.querySelectorAll('.ow-card');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var active = el.getAttribute('data-widget-type') === type;
          el.classList.toggle('is-active', active);
          el.style.borderColor = active ? 'var(--color-primary)' : 'var(--color-border)';
        }
        helper.textContent = HELPERS[type] || '';
        // Toggle ai-template panel vs field-table panel.
        var aiBlock = document.getElementById('ow-ai-block');
        var fieldBlock = document.getElementById('ow-fields-block');
        var loadEx = document.getElementById('ow-example');
        var addBtnEl = document.getElementById('add-widget-field-btn');
        if (aiBlock && fieldBlock) {
          if (type === 'ai-template') {
            aiBlock.style.display = 'block';
            fieldBlock.style.display = 'none';
            if (loadEx) loadEx.style.display = 'none';
            if (addBtnEl) addBtnEl.style.display = 'none';
          } else {
            aiBlock.style.display = 'none';
            fieldBlock.style.display = '';
            if (loadEx) loadEx.style.display = '';
            if (addBtnEl) addBtnEl.style.display = '';
          }
        }
        refreshFieldDimming();
        refreshPreview();
      }

      function refreshFieldDimming() {
        var type = currentWidget();
        var valid = (COMPAT[type] || []).reduce(function (acc, ft) { acc[ft] = true; return acc; }, {});
        var selects = tbody.querySelectorAll('select[name^="fieldType_"]');
        for (var i = 0; i < selects.length; i++) {
          var opts = selects[i].options;
          for (var j = 0; j < opts.length; j++) {
            opts[j].style.color = valid[opts[j].value] ? '' : 'var(--color-text-muted)';
            opts[j].textContent = opts[j].value + (valid[opts[j].value] ? '' : ' (n/a)');
          }
        }
      }

      function typeOptionsHtml(selected) {
        var type = currentWidget();
        var valid = (COMPAT[type] || []).reduce(function (acc, ft) { acc[ft] = true; return acc; }, {});
        return FIELD_TYPES.map(function (t) {
          var label = t + (valid[t] ? '' : ' (n/a)');
          var colorStyle = valid[t] ? '' : ' style="color: var(--color-text-muted);"';
          var sel = t === selected ? ' selected' : '';
          return '<option value="' + t + '"' + colorStyle + sel + '>' + label + '</option>';
        }).join('');
      }

      function addRow(data) {
        data = data || {};
        var idx = tbody.rows.length;
        var tr = document.createElement('tr');
        tr.setAttribute('data-row', String(idx));
        var tip = FIELD_DESCS[data.type || 'text'] || '';
        tr.innerHTML =
          '<td><input type="text" name="fieldName_' + idx + '" value="' + esc(data.name || '') + '" placeholder="field_name" style="padding:var(--space-1) var(--space-2);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-xs);font-family:var(--font-mono);width:8rem;"></td>' +
          '<td><input type="text" name="fieldLabel_' + idx + '" value="' + esc(data.label || '') + '" placeholder="Label" style="padding:var(--space-1) var(--space-2);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-xs);width:8rem;"></td>' +
          '<td><select name="fieldType_' + idx + '" title="' + esc(tip) + '" style="padding:var(--space-1) var(--space-2);border:1px solid var(--color-border-strong);border-radius:var(--radius-sm);font-size:var(--font-size-xs);">' + typeOptionsHtml(data.type || 'text') + '</select></td>' +
          '<td><button type="button" class="btn btn--ghost btn--sm ow-remove-row" style="padding:2px 6px;font-size:var(--font-size-xs);color:var(--color-err);">\\u00D7</button></td>';
        tbody.appendChild(tr);
      }

      function esc(s) { return String(s).replace(/[&<>"\\']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"\\'":'&#39;' }[c]; }); }

      function clearRows() { while (tbody.firstChild) tbody.removeChild(tbody.firstChild); }

      function loadExample(key) {
        var ex = EXAMPLES[key];
        if (!ex || !ex.schema) return;
        if (tbody.rows.length > 0 && !confirm('Replace current fields with "' + ex.label + '"?')) return;
        selectCard(ex.schema.type);
        clearRows();
        for (var i = 0; i < ex.schema.fields.length; i++) addRow(ex.schema.fields[i]);
        refreshFieldDimming();
        refreshPreview();
      }

      var previewTimer = null;
      function refreshPreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
          // Express only parses urlencoded + json; FormData would send multipart
          // and arrive as an empty body. Build URLSearchParams from the form.
          var params = new URLSearchParams();
          var fd = new FormData(form);
          fd.forEach(function (value, key) {
            if (key === 'action') return;
            params.append(key, typeof value === 'string' ? value : '');
          });
          fetch('/agents/' + encodeURIComponent(AGENT_ID) + '/output-widget/preview', {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            credentials: 'same-origin',
          }).then(function (r) { return r.text(); }).then(function (html) {
            preview.innerHTML = html || '<span class="dim">Add a field to see the preview.</span>';
          }).catch(function () {
            preview.innerHTML = '<span class="dim">Preview unavailable.</span>';
          });
        }, 200);
      }

      cards.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== cards) {
          if (t.classList && t.classList.contains('ow-card')) {
            e.preventDefault();
            selectCard(t.getAttribute('data-widget-type'));
            return;
          }
          t = t.parentNode;
        }
      });
      addBtn.addEventListener('click', function () { addRow(); refreshFieldDimming(); refreshPreview(); });
      tbody.addEventListener('click', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('ow-remove-row')) {
          var tr = e.target.closest('tr');
          if (tr) { tr.parentNode.removeChild(tr); refreshPreview(); }
        }
      });
      tbody.addEventListener('input', refreshPreview);
      tbody.addEventListener('change', refreshPreview);
      exampleSel.addEventListener('change', function () {
        if (this.value) { loadExample(this.value); this.value = ''; }
      });

      // ai-template generate button
      var aiGenBtn = document.getElementById('ow-ai-generate');
      var aiPromptEl = document.getElementById('ow-ai-prompt');
      var aiTemplateEl = document.getElementById('ow-ai-template');
      var aiProviderEl = document.getElementById('ow-ai-provider');
      var aiStatusEl = document.getElementById('ow-ai-status');
      // Build a modal overlay reused for every Generate click. Stays in DOM
      // so creating + tearing down is cheap; toggled via display.
      var aiModal = document.createElement('div');
      aiModal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center;';
      aiModal.innerHTML =
        '<div style="background:var(--color-surface-raised);padding:var(--space-5);border-radius:var(--radius-md);max-width:24rem;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.2);">' +
          '<div class="spinner" style="margin:0 auto var(--space-3);width:32px;height:32px;border-width:3px;"></div>' +
          '<p style="font-weight:var(--weight-bold);margin:0 0 var(--space-2);font-size:var(--font-size-sm);">Generating template…</p>' +
          '<p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-3);" id="ow-ai-modal-detail">Sending prompt to <span id="ow-ai-modal-provider">Claude</span>. Typically 5–30s.</p>' +
          '<p class="dim" style="font-size:var(--font-size-xs);margin:0 0 var(--space-3);font-family:var(--font-mono);" id="ow-ai-modal-elapsed">0s</p>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="ow-ai-modal-cancel">Cancel</button>' +
        '</div>';
      document.body.appendChild(aiModal);

      if (aiGenBtn) {
        aiGenBtn.addEventListener('click', function () {
          var promptVal = (aiPromptEl && aiPromptEl.value || '').trim();
          if (!promptVal) { aiStatusEl.textContent = 'Write a prompt first.'; return; }

          var providerLabel = (aiProviderEl && aiProviderEl.options[aiProviderEl.selectedIndex] && aiProviderEl.options[aiProviderEl.selectedIndex].textContent) || 'Claude';
          var providerEl = document.getElementById('ow-ai-modal-provider');
          if (providerEl) providerEl.textContent = providerLabel;
          var elapsedEl = document.getElementById('ow-ai-modal-elapsed');
          var detailEl = document.getElementById('ow-ai-modal-detail');
          var startTime = Date.now();
          var elapsedTimer = setInterval(function () {
            if (!elapsedEl) return;
            var s = Math.floor((Date.now() - startTime) / 1000);
            elapsedEl.textContent = s + 's';
            if (s > 30 && detailEl) detailEl.textContent = 'Still working… complex prompts can take a minute.';
          }, 500);

          var controller = new AbortController();
          var cancelBtn = document.getElementById('ow-ai-modal-cancel');
          var onCancel = function () { controller.abort(); };
          if (cancelBtn) cancelBtn.addEventListener('click', onCancel);

          aiModal.style.display = 'flex';
          aiGenBtn.disabled = true;
          aiStatusEl.textContent = '';

          var params2 = new URLSearchParams();
          params2.append('prompt', promptVal);
          if (aiProviderEl && aiProviderEl.value) params2.append('provider', aiProviderEl.value);

          fetch('/agents/' + encodeURIComponent(AGENT_ID) + '/output-widget/generate', {
            method: 'POST',
            body: params2,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            credentials: 'same-origin',
            signal: controller.signal,
          }).then(function (r) {
            if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
            return r.text();
          }).then(function (html) {
            aiTemplateEl.value = html;
            var seconds = Math.floor((Date.now() - startTime) / 1000);
            aiStatusEl.textContent = 'Generated in ' + seconds + 's. Edit + Save when ready.';
            refreshPreview();
          }).catch(function (err) {
            aiStatusEl.textContent = err.name === 'AbortError' ? 'Cancelled.' : ('Failed: ' + err.message);
          }).finally(function () {
            clearInterval(elapsedTimer);
            if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
            aiModal.style.display = 'none';
            aiGenBtn.disabled = false;
          });
        });
      }
      if (aiTemplateEl) aiTemplateEl.addEventListener('input', refreshPreview);

      // Add tooltips to existing rows + initial preview
      var existingSelects = tbody.querySelectorAll('select[name^="fieldType_"]');
      for (var i = 0; i < existingSelects.length; i++) {
        existingSelects[i].title = FIELD_DESCS[existingSelects[i].value] || '';
      }
      // Honour the initial widget type's panel visibility on first render
      selectCard(currentWidget());
      refreshFieldDimming();
      refreshPreview();
    })();
    </script>`)}
  `;
}

function fieldTypeSelectWithTooltip(name: string, current: string, _widgetType: string): string {
  const opts = FIELD_TYPES.map((t) => {
    const sel = t === current ? ' selected' : '';
    return `<option value="${t}"${sel}>${t}</option>`;
  }).join('');
  const tip = FIELD_TYPE_INFO[current as keyof typeof FIELD_TYPE_INFO]?.description ?? '';
  return `<select name="${name}" title="${tip}" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);">${opts}</select>`;
}

// ── Notify editor ────────────────────────────────────────────────────────

/**
 * Renders the notify-handlers editor on the agent's Config tab.
 *
 * UX is intentionally simple — a single textarea with the JSON for the
 * `notify:` block. The schema is small enough that a structured form
 * would be more clicks than typing it. Save round-trips through the
 * agent-v2 schema, so any error surfaces inline as a flash.
 */
export function renderNotifyEditor(agent: Agent): SafeHtml {
  const FIELD = 'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-family: var(--font-mono); width: 100%;';
  const current = agent.notify ? JSON.stringify(agent.notify, null, 2) : '';
  const placeholder = JSON.stringify({
    on: ['failure'],
    secrets: ['SLACK_WEBHOOK'],
    handlers: [
      { type: 'slack', webhook_secret: 'SLACK_WEBHOOK', channel: '#alerts' },
      { type: 'file', path: 'logs/failures.jsonl' },
    ],
  }, null, 2);

  return html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Fires after every run commits. Handlers run in parallel; a broken handler
      logs and is skipped — it never fails the run.
    </p>
    <form method="POST" action="/agents/${agent.id}/notify/update">
      <textarea name="notify" rows="14" placeholder="${placeholder}" style="${FIELD}">${current}</textarea>
      <p class="dim" style="font-size: var(--font-size-xs); margin: var(--space-2) 0;">
        JSON shape mirrors the YAML <code>notify:</code> block. Trigger: <code>failure</code>, <code>success</code>, or <code>always</code>.
        Secrets must be declared in <code>secrets:</code> and set via <a href="/settings/secrets">Settings → Secrets</a>.
      </p>
      <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
        ${agent.notify ? html`<button type="submit" name="action" value="remove" class="btn btn--ghost btn--sm" style="color: var(--color-err);">Remove notify</button>` : html``}
        <button type="submit" name="action" value="save" class="btn btn--primary btn--sm">Save notify</button>
      </div>
    </form>
  `;
}

// ── Small helpers ────────────────────────────────────────────────────────

export function typeSelect(namePrefix: string, current: string): SafeHtml {
  const opt = (val: string) => val === current ? html`<option value="${val}" selected>${val}</option>` : html`<option value="${val}">${val}</option>`;
  return html`<select name="${namePrefix}" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);">${opt('string')}${opt('number')}${opt('boolean')}${opt('enum')}</select>`;
}

export function vStatusBadge(status: string): SafeHtml {
  const kind = status === 'active' ? 'badge--ok' : status === 'paused' ? 'badge--warn' : status === 'archived' ? 'badge--muted' : 'badge--info';
  return html`<span class="badge ${kind}">${status}</span>`;
}

export function statusOption(value: string, current: string): SafeHtml {
  const selected = value === current ? unsafeHtml(' selected') : unsafeHtml('');
  return html`<option value="${value}"${selected}>${value}</option>`;
}

export function providerOption(value: string, current?: string): SafeHtml {
  const effective = current ?? 'claude';
  const selected = value === effective ? unsafeHtml(' selected') : unsafeHtml('');
  return html`<option value="${value}"${selected}>${value}</option>`;
}

interface ModelEntry { id: string; label: string; desc: string }

const CLAUDE_MODELS: ModelEntry[] = [
  { id: '', label: 'default', desc: 'Uses the Claude CLI default model' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Most capable. Deep analysis, complex reasoning, long outputs' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Fast + capable. Good balance of speed and quality' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fastest. Best for simple tasks, classification, extraction' },
];

const CODEX_MODELS: ModelEntry[] = [
  { id: '', label: 'default', desc: 'Uses the Codex CLI default model' },
  { id: 'o4-mini', label: 'o4-mini', desc: 'Fast reasoning model. Good for code analysis and generation' },
  { id: 'o3', label: 'o3', desc: 'Most capable reasoning model. Deep multi-step analysis' },
  { id: 'gpt-4.1', label: 'GPT-4.1', desc: 'Latest GPT. Strong at code, instruction following' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', desc: 'Compact GPT-4.1. Fast, lower cost' },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', desc: 'Smallest GPT-4.1. Very fast, simple tasks' },
];

export function renderModelOptions(provider?: string, currentModel?: string): SafeHtml {
  const models = (provider === 'codex') ? CODEX_MODELS : CLAUDE_MODELS;
  const effective = currentModel ?? '';
  const options = models.map((m) => {
    const sel = m.id === effective ? unsafeHtml(' selected') : unsafeHtml('');
    return html`<option value="${m.id}" title="${m.desc}"${sel}>${m.label}</option>`;
  });
  if (effective && !models.some((m) => m.id === effective)) {
    options.push(html`<option value="${effective}" selected>${effective}</option>`);
  }
  return html`${options as unknown as SafeHtml[]}`;
}

export function oneLine(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '\u2026';
}
