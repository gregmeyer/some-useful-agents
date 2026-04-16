import { listBuiltinTools, type ToolDefinition, type ToolStore } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

/**
 * All available tools for the node-form dropdown. Built-ins first, then
 * user tools. The two backcompat tools (shell-exec, claude-code) are
 * listed at the top since they're the most common.
 */
export function getAvailableTools(toolStore?: ToolStore): ToolDefinition[] {
  const builtins = listBuiltinTools();
  let userTools: ToolDefinition[] = [];
  try {
    if (toolStore) userTools = toolStore.listTools();
  } catch { /* store not available */ }
  return [...builtins, ...userTools];
}

/**
 * Render the tool picker: a `<select name="tool">` dropdown plus a
 * JSON payload of all tool schemas so client JS can swap input fields
 * dynamically when the selection changes.
 */
export function renderToolPicker(args: {
  tools: ToolDefinition[];
  selectedTool?: string;
  /** For edit-node: the current node's type, used to pre-select the right tool. */
  currentType?: 'shell' | 'claude-code';
}): SafeHtml {
  const { tools, selectedTool, currentType } = args;

  // Derive the effective selection. When editing a v0.15 node that
  // has no explicit `tool:`, default to its implicit tool.
  const effective = selectedTool
    ?? (currentType === 'shell' ? 'shell-exec' : currentType === 'claude-code' ? 'claude-code' : 'shell-exec');

  const options = tools.map((t) => {
    const selected = t.id === effective ? ' selected' : '';
    const label = t.id === 'shell-exec' ? 'Shell (shell-exec)'
      : t.id === 'claude-code' ? 'Claude Code (claude-code)'
      : `${t.id} — ${t.name}`;
    return html`<option value="${t.id}"${unsafeHtml(selected)}>${label}</option>`;
  });

  // Embed tool schemas so JS can render dynamic input fields.
  const schemasPayload = JSON.stringify(
    Object.fromEntries(tools.map((t) => [t.id, {
      inputs: t.inputs,
      outputs: t.outputs,
      implType: t.implementation.type,
      description: t.description,
    }])),
  ).replace(/<\/script/gi, '<\\/script');

  return html`
    <fieldset style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4);">
      <legend style="padding: 0 var(--space-2); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Tool</legend>
      <select name="tool" id="node-tool-select" style="padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: var(--font-mono); min-width: 16rem;">
        ${options as unknown as SafeHtml[]}
      </select>
      <p class="dim" style="margin: var(--space-2) 0 0; font-size: var(--font-size-xs);" id="tool-description"></p>
    </fieldset>
    <input type="hidden" name="type" id="node-type-hidden" value="${effective === 'claude-code' ? 'claude-code' : 'shell'}">
    <script id="tool-schemas" type="application/json">${unsafeHtml(schemasPayload)}</script>
  `;
}

/**
 * Render the dynamic tool-inputs section. For shell-exec/claude-code,
 * this is empty (those tools use the existing command/prompt textareas).
 * For other tools, generate one field per declared input.
 *
 * The section is server-rendered for the initially-selected tool; JS
 * swaps it when the dropdown changes. The `id="tool-inputs-section"`
 * container is the JS target.
 */
export function renderToolInputsSection(
  selectedTool: string,
  tools: ToolDefinition[],
  existingInputs?: Record<string, unknown>,
): SafeHtml {
  // shell-exec and claude-code use the existing command/prompt fields.
  if (selectedTool === 'shell-exec' || selectedTool === 'claude-code') {
    return html`<div id="tool-inputs-section"></div>`;
  }

  const tool = tools.find((t) => t.id === selectedTool);
  if (!tool) return html`<div id="tool-inputs-section"></div>`;

  const fields = Object.entries(tool.inputs).map(([name, spec]) => {
    const value = existingInputs?.[name] ?? spec.default ?? '';
    const required = spec.required ? 'required' : '';
    return html`
      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3);">
        <strong>${name} <span class="dim" style="font-weight: var(--weight-regular); font-size: var(--font-size-xs);">(${spec.type}${spec.required ? ', required' : ''})</span></strong>
        <input type="text" name="toolInput_${name}" value="${String(value)}" ${unsafeHtml(required)}
          style="padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: var(--font-mono);">
        ${spec.description ? html`<span class="dim" style="font-size: var(--font-size-xs);">${spec.description}</span>` : html``}
      </label>
    `;
  });

  return html`
    <div id="tool-inputs-section">
      ${fields as unknown as SafeHtml[]}
    </div>
  `;
}
