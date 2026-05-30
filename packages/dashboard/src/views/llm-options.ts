import type { LlmProvider } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

const PROVIDER_OPTIONS: ReadonlyArray<{ id: LlmProvider; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'apple-foundation-models', label: 'Apple Foundation Models' },
];

/**
 * Per-node LLM options for `type: llm-prompt` nodes — provider, model,
 * maxTurns, allowedTools. Rendered as a block of form-fields meant to
 * sit alongside the Prompt textarea inside the same `data-node-field`
 * container, so the existing tool-picker show/hide logic catches them.
 *
 * Values may come from a parsed node (numbers / arrays) or from a
 * re-rendered submitted form (strings); both shapes are normalised.
 */
export interface LlmOptionsValues {
  provider?: string;
  model?: string;
  maxTurns?: number | string;
  allowedTools?: string[] | string;
}

export function renderLlmOptions(values: LlmOptionsValues = {}): SafeHtml {
  const selected: LlmProvider = PROVIDER_OPTIONS.some((o) => o.id === values.provider)
    ? (values.provider as LlmProvider)
    : 'claude';
  const model = typeof values.model === 'string' ? values.model : '';
  const maxTurns =
    typeof values.maxTurns === 'number' ? String(values.maxTurns)
    : typeof values.maxTurns === 'string' ? values.maxTurns
    : '';
  const allowedTools =
    Array.isArray(values.allowedTools) ? values.allowedTools.join(', ')
    : typeof values.allowedTools === 'string' ? values.allowedTools
    : '';

  return html`
    <div class="form-field">
      <strong>Provider</strong>
      <select name="provider" class="form-field__input" style="width: auto;">
        ${PROVIDER_OPTIONS.map((opt) => html`<option value="${opt.id}" ${selected === opt.id ? 'selected' : ''}>${opt.label}</option>`) as unknown as SafeHtml[]}
      </select>
      <span class="form-field__hint">Which LLM provider runs the prompt. Inherits from the agent if unset.</span>
    </div>

    <div class="form-field">
      <strong>Model <span class="dim text-xs">(optional)</span></strong>
      <input type="text" name="model" value="${model}" placeholder="e.g. claude-opus-4-7"
        class="form-field__input">
      <span class="form-field__hint">Override the default model for this node. Provider-specific.</span>
    </div>

    <div class="form-field">
      <strong>Max turns <span class="dim text-xs">(optional)</span></strong>
      <input type="number" name="maxTurns" value="${maxTurns}" min="1" placeholder="5"
        class="form-field__input" style="width: 8rem;">
      <span class="form-field__hint">Cap on tool-use turns inside the prompt. Default 5.</span>
    </div>

    <div class="form-field">
      <strong>Allowed tools <span class="dim text-xs">(optional)</span></strong>
      <input type="text" name="allowedTools" value="${allowedTools}"
        placeholder="Read, Write, Edit, web-search" class="form-field__input">
      <span class="form-field__hint">Comma-separated allowlist of tools the LLM may invoke. Leave empty to use the provider's defaults.</span>
    </div>
  `;
}

export interface ParsedLlmOptions {
  provider?: LlmProvider;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
}

/** Parse LLM-options form fields out of a request body. Empty fields are omitted. */
export function parseLlmOptions(body: Record<string, unknown>): ParsedLlmOptions {
  const result: ParsedLlmOptions = {};

  if (typeof body.provider === 'string' && PROVIDER_OPTIONS.some((o) => o.id === body.provider)) {
    result.provider = body.provider as LlmProvider;
  }

  if (typeof body.model === 'string' && body.model.trim()) {
    result.model = body.model.trim();
  }

  if (typeof body.maxTurns === 'string' && body.maxTurns.trim()) {
    const n = parseInt(body.maxTurns, 10);
    if (Number.isFinite(n) && n > 0) result.maxTurns = n;
  } else if (typeof body.maxTurns === 'number' && body.maxTurns > 0) {
    result.maxTurns = body.maxTurns;
  }

  if (typeof body.allowedTools === 'string' && body.allowedTools.trim()) {
    const tools = body.allowedTools.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (tools.length > 0) result.allowedTools = tools;
  }

  return result;
}
