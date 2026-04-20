import { listBuiltinTools, type Agent, type ToolDefinition, type ToolStore } from '@some-useful-agents/core';
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
  /** Other agents that can be invoked as sub-nodes. */
  agents?: Agent[];
  selectedTool?: string;
  /** For edit-node: the current node's type, used to pre-select the right tool. */
  currentType?: string;
  /** The current agent id — excluded from the agents list to prevent self-invocation. */
  currentAgentId?: string;
}): SafeHtml {
  const { tools, agents = [], selectedTool, currentType, currentAgentId } = args;

  // Derive the effective selection. When editing a v0.15 node that
  // has no explicit `tool:`, default to its implicit tool.
  const effective = selectedTool
    ?? (currentType === 'shell' ? 'shell-exec' : currentType === 'claude-code' ? 'claude-code'
      : currentType === 'agent-invoke' && selectedTool ? selectedTool : 'shell-exec');

  const toolOptions = tools.map((t) => {
    const selected = t.id === effective ? ' selected' : '';
    const label = t.id === 'shell-exec' ? 'Shell (shell-exec)'
      : t.id === 'claude-code' ? 'Claude Code (claude-code)'
      : `${t.id} — ${t.name}`;
    return html`<option value="${t.id}"${unsafeHtml(selected)}>${label}</option>`;
  });

  // Filter out the current agent to prevent self-invocation loops.
  const invocableAgents = agents.filter((a) => a.id !== currentAgentId && a.status === 'active');
  const agentOptions = invocableAgents.map((a) => {
    const val = `agent:${a.id}`;
    const selected = val === effective ? ' selected' : '';
    const inputCount = Object.keys(a.inputs ?? {}).length;
    const label = `${a.id} — ${a.name}${inputCount > 0 ? ` (${inputCount} inputs)` : ''}`;
    return html`<option value="${val}"${unsafeHtml(selected)}>${label}</option>`;
  });

  // Embed tool schemas so JS can render dynamic input fields.
  // Include agent entries with their input specs for agent-invoke fields.
  const schemas: Record<string, unknown> = Object.fromEntries(tools.map((t) => [t.id, {
    inputs: t.inputs,
    outputs: t.outputs,
    implType: t.implementation.type,
    description: t.description,
  }]));

  for (const a of invocableAgents) {
    const agentInputs: Record<string, { type: string; description?: string; required?: boolean; default?: unknown }> = {};
    for (const [name, spec] of Object.entries(a.inputs ?? {})) {
      agentInputs[name] = {
        type: spec.type,
        description: spec.description,
        required: spec.required,
        default: spec.default,
      };
    }
    schemas[`agent:${a.id}`] = {
      inputs: agentInputs,
      outputs: { result: { type: 'string', description: 'Sub-agent output' } },
      implType: 'agent-invoke',
      description: a.description ?? `Invoke agent "${a.id}" as a sub-node`,
      agentMeta: { name: a.name, nodeCount: a.nodes.length },
    };
  }

  const schemasPayload = JSON.stringify(schemas).replace(/<\/script/gi, '<\\/script');

  const hiddenType = effective.startsWith('agent:') ? 'agent-invoke'
    : effective === 'claude-code' ? 'claude-code' : 'shell';

  return html`
    <fieldset class="fieldset">
      <legend class="fieldset__legend">Tool</legend>
      <select name="tool" id="node-tool-select" class="form-field__input mono" style="min-width: 16rem; width: auto;">
        ${toolOptions as unknown as SafeHtml[]}
        ${agentOptions.length > 0 ? html`<optgroup label="Agents">${agentOptions as unknown as SafeHtml[]}</optgroup>` : html``}
      </select>
      <p class="dim text-xs mt-3 mb-0" id="tool-description"></p>
    </fieldset>
    <input type="hidden" name="type" id="node-type-hidden" value="${hiddenType}">
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
      <div class="form-field mb-3">
        <strong>${name} <span class="dim text-xs" style="font-weight: var(--weight-regular);">(${spec.type}${spec.required ? ', required' : ''})</span></strong>
        <input type="text" name="toolInput_${name}" value="${String(value)}" ${unsafeHtml(required)}
          class="form-field__input mono">
        ${spec.description ? html`<span class="form-field__hint">${spec.description}</span>` : html``}
      </div>
    `;
  });

  return html`
    <div id="tool-inputs-section">
      ${fields as unknown as SafeHtml[]}
    </div>
  `;
}
