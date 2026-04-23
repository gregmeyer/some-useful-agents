/**
 * Agent detail page helpers — form renderers, model data, small utilities.
 * Extracted from agent-detail-v2.ts.
 */

import type { Agent } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

// ── Run inputs form ─────────────────────────────────────────────────────

export function renderRunInputsForm(agent: Agent, from?: string): SafeHtml {
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
    const defVal = spec.default !== undefined ? String(spec.default) : '';
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
    return html`
      <tr>
        <td class="mono">${name}<input type="hidden" name="inputName[]" value="${name}"></td>
        <td>${typeSelect(`type_${name}`, spec.type)}</td>
        <td><input type="text" name="default_${name}" value="${defVal}" placeholder="(none)" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
        <td><input type="text" name="description_${name}" value="${desc}" placeholder="(none)" style="${FIELD} width: 14rem;"></td>
      </tr>
    `;
  });

  const newRow = html`
    <tr style="border-top: 2px solid var(--color-border);">
      <td><input type="text" name="newInputName" placeholder="NEW_VAR" pattern="[A-Z_][A-Z0-9_]*" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
      <td><select name="newInputType" style="${FIELD}"><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="enum">enum</option></select></td>
      <td><input type="text" name="newInputDefault" placeholder="default" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
      <td><input type="text" name="newInputDescription" placeholder="description" style="${FIELD} width: 14rem;"></td>
    </tr>
  `;

  return html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Agent-level inputs. Referenced as <code>$NAME</code> in shell or <code>{{inputs.NAME}}</code> in prompts.
    </p>
    <form method="POST" action="/agents/${agent.id}/inputs/update">
      <table class="table" style="font-size: var(--font-size-xs); margin-bottom: var(--space-3);">
        <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>${inputRows as unknown as SafeHtml[]}${newRow}</tbody>
      </table>
      <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
        <button type="submit" class="btn btn--primary btn--sm">Save variables</button>
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
