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

/**
 * Render the edit form for an existing node in a v2 agent. The node id
 * is shown read-only — renaming would break every downstream
 * `{{upstream.<id>.result}}` / `$UPSTREAM_<ID>_RESULT` reference in the
 * same agent. Users who want a different id delete + recreate.
 *
 * Saving produces a new agent version (via `createNewVersion`).
 */
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

  // Fall back to the node's current values if nothing's been submitted.
  const v: EditNodeFormValues = {
    type: submitted?.type ?? node.type,
    command: submitted?.command ?? (node.type === 'shell' ? node.command : ''),
    prompt: submitted?.prompt ?? (node.type === 'claude-code' ? node.prompt : ''),
    dependsOn: submitted?.dependsOn ?? node.dependsOn ?? [],
  };
  const isShell = v.type === 'shell';
  const isClaude = v.type === 'claude-code';
  const selectedDeps = new Set(v.dependsOn);

  // You can depend on any OTHER node in the same agent (never on yourself).
  // Also exclude nodes that transitively depend on this one — would be a
  // cycle. We compute the set of downstream ids via a simple BFS.
  const downstreamIds = collectDownstream(agent, node.id);
  const pickableUpstreams = agent.nodes.filter((n) => n.id !== node.id && !downstreamIds.has(n.id));

  const depToggles = pickableUpstreams.map((n) => html`
    <label style="display: inline-flex; align-items: center; gap: var(--space-1); margin-right: var(--space-3); font-weight: var(--weight-regular); font-size: var(--font-size-sm);">
      <input type="checkbox" name="dependsOn" value="${n.id}" ${selectedDeps.has(n.id) ? 'checked' : ''}>
      <code>${n.id}</code>
    </label>
  `);

  const errorBlock = error
    ? html`<div class="flash flash--error">${error}</div>`
    : html``;

  const headerCta = html`
    <form method="POST" action="/agents/${agent.id}/nodes/${node.id}/delete" style="margin: 0;"
      data-confirm="Delete node '${node.id}'? Refuses if downstream nodes depend on it. Creates a new agent version.">
      <button type="submit" class="btn btn--warn">Delete node</button>
    </form>
  `;

  const body = html`
    ${pageHeader({
      title: `Edit ${node.id}`,
      back: { href: `/agents/${agent.id}`, label: `Back to ${agent.id}` },
      cta: headerCta,
      description: `Saving creates a new version of ${agent.id} (currently v${String(agent.version)}).`,
    })}

    ${errorBlock}

    <form method="POST" action="/agents/${agent.id}/nodes/${node.id}/edit" class="card" style="max-width: 680px;">
      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
        <strong>Node id</strong>
        <input type="text" readonly value="${node.id}" style="${INPUT_STYLE} background: var(--color-surface-raised); color: var(--color-text-muted);">
        <span class="dim" style="font-size: var(--font-size-xs);">Immutable. Renaming would break every <code>{{upstream.${node.id}.result}}</code> reference in this agent. Delete + re-create if you need a different id.</span>
      </label>

      ${isControlFlowNode(node)
        ? renderControlFlowSection(agent, node)
        : html`
          ${renderToolPicker({ tools: allTools, selectedTool: node.tool, currentType: v.type })}
          ${renderToolInputsSection(node.tool ?? (v.type === 'claude-code' ? 'claude-code' : 'shell-exec'), allTools, node.toolInputs as Record<string, unknown> | undefined)}
        `}

      <fieldset style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4);">
        <legend style="padding: 0 var(--space-2); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Depends on</legend>
        <p class="dim" style="margin: 0 0 var(--space-2); font-size: var(--font-size-xs);">Pick upstream nodes. Downstream nodes + self are excluded to prevent cycles.</p>
        ${pickableUpstreams.length === 0
          ? html`<span class="dim" style="font-size: var(--font-size-xs);">No eligible upstream nodes.</span>`
          : html`<div>${depToggles as unknown as SafeHtml[]}</div>`}
      </fieldset>

      ${renderAvailableVars(agent, node, variablesStore)}

      <fieldset style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4);">
        <legend style="padding: 0 var(--space-2); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Implementation</legend>

        <div class="node-field" data-node-field="shell">
          <label style="display: flex; flex-direction: column; gap: var(--space-1);">
            <strong>Command</strong>
            <textarea name="command" rows="4"
              style="${TEXTAREA_STYLE}"
              data-template-palette="shell"
              data-palette-source="palette-edit-node">${v.command ?? ''}</textarea>
            <span class="dim" style="font-size: var(--font-size-xs);">Type <code>$</code> for available env vars.</span>
          </label>
        </div>

        <div class="node-field" data-node-field="claude-code">
          <label style="display: flex; flex-direction: column; gap: var(--space-1);">
            <strong>Prompt</strong>
            <textarea name="prompt" rows="4"
              style="${TEXTAREA_STYLE}"
              data-template-palette="claude"
              data-palette-source="palette-edit-node">${v.prompt ?? ''}</textarea>
            <span class="dim" style="font-size: var(--font-size-xs);">Type <code>{{</code> for available template refs.</span>
          </label>
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

      <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
        <a class="btn btn--ghost" href="/agents/${agent.id}">Cancel</a>
        <button type="submit" class="btn btn--primary">Save changes</button>
      </div>
    </form>
  `;

  return render(layout({ title: `Edit ${node.id} \u2014 ${agent.id}`, activeNav: 'agents' }, body));
}

/**
 * BFS over the agent's DAG from `startId`, collecting every node that
 * transitively depends on it. Used to disallow dependsOn choices that
 * would create a cycle.
 */
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

/**
 * Visible summary of variables available to this node. Shows agent-level
 * inputs (with defaults), upstream node outputs, and declared secrets
 * so the user knows what they can reference in the command/prompt without
 * having to type $ to discover them.
 */
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
    const info = [
      defVal ? `default: ${defVal}` : 'required',
      desc,
    ].filter(Boolean).join(' \u2014 ');
    rows.push(html`
      <tr>
        <td class="mono" style="color: var(--color-primary);">$${name}</td>
        <td>agent input</td>
        <td class="dim">${info}</td>
      </tr>
    `);
  }

  for (const [name, variable] of globalVars) {
    const desc = variable.description ?? '';
    const info = [
      `value: ${variable.value}`,
      desc,
    ].filter(Boolean).join(' \u2014 ');
    rows.push(html`
      <tr>
        <td class="mono" style="color: var(--color-primary);">$${name}</td>
        <td>global variable</td>
        <td class="dim">${info}</td>
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
      </tr>
    `);
  }

  for (const name of secrets) {
    rows.push(html`
      <tr>
        <td class="mono" style="color: var(--color-warn);">$${name}</td>
        <td>secret</td>
        <td class="dim">injected at runtime</td>
      </tr>
    `);
  }

  return html`
    <fieldset style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4); background: var(--color-surface-raised);">
      <legend style="padding: 0 var(--space-2); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Available variables</legend>
      ${rows.length > 0 ? html`
        <table class="table" style="font-size: var(--font-size-xs); margin-bottom: var(--space-3);">
          <thead><tr><th>Variable</th><th>Source</th><th>Info</th></tr></thead>
          <tbody>${rows as unknown as SafeHtml[]}</tbody>
        </table>
      ` : html`
        <p class="dim" style="margin: 0 0 var(--space-3); font-size: var(--font-size-xs);">No variables in scope. Add an agent input below.</p>
      `}
      <details style="margin-top: var(--space-1);">
        <summary style="cursor: pointer; font-size: var(--font-size-xs); color: var(--color-primary); font-weight: var(--weight-medium);">+ Add a variable</summary>
        <div style="margin-top: var(--space-2); display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: flex-end;">
          <label style="display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-xs);">
            Name
            <input type="text" name="newInputName" placeholder="API_URL" pattern="[A-Z_][A-Z0-9_]*"
              style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-family: var(--font-mono); width: 10rem;">
          </label>
          <label style="display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-xs);">
            Type
            <select name="newInputType" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);">
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="enum">enum</option>
            </select>
          </label>
          <label style="display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-xs);">
            Default
            <input type="text" name="newInputDefault" placeholder="optional"
              style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-family: var(--font-mono); width: 10rem;">
          </label>
          <label style="display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-xs);">
            Description
            <input type="text" name="newInputDescription" placeholder="optional"
              style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs); width: 14rem;">
          </label>
        </div>
        <p class="dim" style="margin: var(--space-2) 0 0; font-size: var(--font-size-xs);">
          New variables are added as agent-level inputs when you save. Name must be UPPERCASE_WITH_UNDERSCORES.
          Use <code>$NAME</code> in shell commands or <code>{{inputs.NAME}}</code> in prompts.
        </p>
      </details>
    </fieldset>
  `;
}

const INPUT_STYLE: SafeHtml = unsafeHtml(
  'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit;',
);
const TEXTAREA_STYLE: SafeHtml = unsafeHtml(
  'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); resize: vertical;',
);
