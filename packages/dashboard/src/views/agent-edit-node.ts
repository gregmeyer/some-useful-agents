import type { Agent, AgentNode, ToolStore, VariablesStore } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { computePaletteSuggestions, renderPalettePayload } from './template-palette.js';
import { renderToolPicker, renderToolInputsSection, getAvailableTools } from './tool-picker.js';
import { renderControlFlowSection, isControlFlowNode } from './controlflow-edit.js';

export interface EditNodeFormValues {
  type?: string;
  command?: string;
  prompt?: string;
  dependsOn?: string[];
}

export function renderAgentEditNode(args: {
  agent: Agent;
  node: AgentNode;
  values?: EditNodeFormValues;
  error?: string;
  toolStore?: ToolStore;
  variablesStore?: VariablesStore;
}): string {
  const { agent, node, values: submitted, error, toolStore, variablesStore } = args;
  const allTools = getAvailableTools(toolStore);

  const v: EditNodeFormValues = {
    type: submitted?.type ?? node.type,
    command: submitted?.command ?? (node.type === 'shell' ? node.command : ''),
    prompt: submitted?.prompt ?? (node.type === 'claude-code' ? node.prompt : ''),
    dependsOn: submitted?.dependsOn ?? node.dependsOn ?? [],
  };
  const selectedDeps = new Set(v.dependsOn);

  const downstreamIds = collectDownstream(agent, node.id);
  const pickableUpstreams = agent.nodes.filter((n) => n.id !== node.id && !downstreamIds.has(n.id));

  const depToggles = pickableUpstreams.map((n) => html`
    <label class="dep-toggle">
      <input type="checkbox" name="dependsOn" value="${n.id}" ${selectedDeps.has(n.id) ? 'checked' : ''}>
      <code>${n.id}</code>
    </label>
  `);

  const errorBlock = error ? html`<div class="flash flash--error">${error}</div>` : html``;

  const body = html`
    ${pageHeader({
      title: `Edit ${node.id}`,
      back: { href: `/agents/${agent.id}`, label: `Back to ${agent.id}` },
      cta: html`
        <form method="POST" action="/agents/${agent.id}/nodes/${node.id}/delete" class="inline"
          data-confirm="Delete node '${node.id}'? Refuses if downstream nodes depend on it. Creates a new agent version.">
          <button type="submit" class="btn btn--warn">Delete node</button>
        </form>
      `,
      description: `Saving creates a new version of ${agent.id} (currently v${String(agent.version)}).`,
    })}

    ${errorBlock}

    <form method="POST" action="/agents/${agent.id}/nodes/${node.id}/edit" class="card" style="max-width: 680px;">
      <div class="form-field">
        <strong>Node id</strong>
        <input type="text" readonly value="${node.id}" class="form-field__input" style="background: var(--color-surface-raised); color: var(--color-text-muted);">
        <span class="form-field__hint">Immutable. Renaming would break every <code>{{upstream.${node.id}.result}}</code> reference. Delete + re-create if you need a different id.</span>
      </div>

      ${isControlFlowNode(node)
        ? renderControlFlowSection(agent, node)
        : html`
          ${renderToolPicker({ tools: allTools, selectedTool: node.tool, currentType: v.type })}
          ${renderToolInputsSection(node.tool ?? (v.type === 'claude-code' ? 'claude-code' : 'shell-exec'), allTools, node.toolInputs as Record<string, unknown> | undefined)}
        `}

      ${node.type === 'claude-code' || v.type === 'claude-code' ? html`
        <fieldset class="fieldset">
          <legend class="fieldset__legend">LLM Provider</legend>
          <select name="provider" class="form-field__input" style="width: auto;">
            <option value="claude" ${node.provider !== 'codex' ? 'selected' : ''}>Claude</option>
            <option value="codex" ${node.provider === 'codex' ? 'selected' : ''}>Codex</option>
          </select>
          <span class="dim text-xs" style="margin-left: var(--space-2);">Which LLM CLI to use for this node.</span>
        </fieldset>
      ` : html``}

      <fieldset class="fieldset">
        <legend class="fieldset__legend">Depends on</legend>
        <p class="dim text-xs mb-2">Pick upstream nodes. Downstream nodes + self are excluded to prevent cycles.</p>
        ${pickableUpstreams.length === 0
          ? html`<span class="dim text-xs">No eligible upstream nodes.</span>`
          : html`<div>${depToggles as unknown as SafeHtml[]}</div>`}
      </fieldset>

      ${renderAvailableVars(agent, node, variablesStore)}

      <fieldset class="fieldset">
        <legend class="fieldset__legend">Implementation</legend>

        <div class="node-field" data-node-field="shell">
          <div class="form-field">
            <strong>Command</strong>
            <textarea name="command" rows="4"
              class="form-field__textarea"
              data-template-palette="shell"
              data-palette-source="palette-edit-node">${v.command ?? ''}</textarea>
            <span class="form-field__hint">Type <code>$</code> for available env vars.</span>
          </div>
        </div>

        <div class="node-field" data-node-field="claude-code">
          <div class="form-field">
            <strong>Prompt</strong>
            <textarea name="prompt" rows="4"
              class="form-field__textarea"
              data-template-palette="claude"
              data-palette-source="palette-edit-node">${v.prompt ?? ''}</textarea>
            <span class="form-field__hint">Type <code>{{</code> for available template refs.</span>
          </div>
        </div>
      </fieldset>

      ${renderPalettePayload(
        'palette-edit-node',
        computePaletteSuggestions(agent, {
          excludeNodeId: node.id,
          nodeSecrets: node.secrets,
          variablesStore,
        }),
      )}

      <div class="flex-end">
        <a class="btn btn--ghost" href="/agents/${agent.id}">Cancel</a>
        <button type="submit" class="btn btn--primary">Save changes</button>
      </div>
    </form>
  `;

  return render(layout({ title: `Edit ${node.id} \u2014 ${agent.id}`, activeNav: 'agents' }, body));
}

function collectDownstream(agent: Agent, startId: string): Set<string> {
  const down = new Set<string>();
  const frontier = [startId];
  while (frontier.length > 0) {
    const cur = frontier.pop()!;
    for (const n of agent.nodes) {
      if (n.dependsOn?.includes(cur) && !down.has(n.id)) {
        down.add(n.id);
        frontier.push(n.id);
      }
    }
  }
  return down;
}

function renderAvailableVars(agent: Agent, node: AgentNode, variablesStore?: VariablesStore): SafeHtml {
  const inputs = Object.entries(agent.inputs ?? {});
  const upstreams = (node.dependsOn ?? []).filter((id) => agent.nodes.some((n) => n.id === id));
  const secrets = node.secrets ?? [];
  const globalVars = variablesStore ? Object.entries(variablesStore.list()) : [];

  if (inputs.length === 0 && upstreams.length === 0 && secrets.length === 0 && globalVars.length === 0) {
    return html``;
  }

  const rows: SafeHtml[] = [];

  for (const [name, spec] of inputs) {
    const defVal = spec.default !== undefined ? String(spec.default) : '';
    const desc = spec.description ?? '';
    const info = [defVal ? `default: ${defVal}` : 'required', desc].filter(Boolean).join(' \u2014 ');
    rows.push(html`
      <tr>
        <td class="mono" style="color: var(--color-primary);">$${name}</td>
        <td>agent input</td>
        <td class="dim">${info}</td>
        <td><a href="/agents/${agent.id}#variables" class="dim text-xs">edit</a></td>
      </tr>
    `);
  }

  for (const [name, variable] of globalVars) {
    const desc = variable.description ?? '';
    const info = [`value: ${variable.value}`, desc].filter(Boolean).join(' \u2014 ');
    rows.push(html`
      <tr>
        <td class="mono" style="color: var(--color-primary);">$${name}</td>
        <td>global variable</td>
        <td class="dim">${info}</td>
        <td><a href="/settings/variables" class="dim text-xs">edit</a></td>
      </tr>
    `);
  }

  for (const id of upstreams) {
    const envName = `UPSTREAM_${id.toUpperCase().replace(/-/g, '_')}_RESULT`;
    rows.push(html`
      <tr>
        <td class="mono" style="color: var(--color-primary);">$${envName}</td>
        <td>upstream output</td>
        <td class="dim">from node "${id}"</td>
        <td></td>
      </tr>
    `);
  }

  for (const name of secrets) {
    rows.push(html`
      <tr>
        <td class="mono" style="color: var(--color-warn);">$${name}</td>
        <td>secret</td>
        <td class="dim">injected at runtime</td>
        <td><a href="/settings/secrets" class="dim text-xs">edit</a></td>
      </tr>
    `);
  }

  return html`
    <fieldset class="fieldset" style="background: var(--color-surface-raised);">
      <legend class="fieldset__legend">Available variables</legend>
      ${rows.length > 0 ? html`
        <table class="table text-xs mb-3">
          <thead><tr><th>Variable</th><th>Source</th><th>Info</th><th></th></tr></thead>
          <tbody>${rows as unknown as SafeHtml[]}</tbody>
        </table>
      ` : html`
        <p class="dim text-xs mb-3">No variables in scope. Add an agent input below.</p>
      `}
      <details class="mt-0">
        <summary class="text-xs" style="color: var(--color-primary); font-weight: var(--weight-medium);">+ Add a variable</summary>
        <div class="mt-3" style="display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: flex-end;">
          <label class="flex-col text-xs">
            Name
            <input type="text" name="newInputName" placeholder="API_URL" pattern="[A-Z_][A-Z0-9_]*"
              class="form-field__input" style="width: 10rem; font-family: var(--font-mono);">
          </label>
          <label class="flex-col text-xs">
            Type
            <select name="newInputType" class="form-field__input" style="width: auto;">
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="enum">enum</option>
            </select>
          </label>
          <label class="flex-col text-xs">
            Default
            <input type="text" name="newInputDefault" placeholder="optional"
              class="form-field__input" style="width: 10rem; font-family: var(--font-mono);">
          </label>
          <label class="flex-col text-xs">
            Description
            <input type="text" name="newInputDescription" placeholder="optional"
              class="form-field__input" style="width: 14rem;">
          </label>
        </div>
        <p class="dim text-xs mt-3">
          New variables are added as agent-level inputs when you save. Name must be UPPERCASE_WITH_UNDERSCORES.
          Use <code>$NAME</code> in shell commands or <code>{{inputs.NAME}}</code> in prompts.
        </p>
      </details>
    </fieldset>
  `;
}
