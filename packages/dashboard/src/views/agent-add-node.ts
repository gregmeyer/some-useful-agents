import type { Agent, AgentStore, ToolStore, VariablesStore } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { computePaletteSuggestions, renderPalettePayload } from './template-palette.js';
import { renderToolPicker, renderToolInputsSection, getAvailableTools } from './tool-picker.js';
import { NODE_PATTERNS } from './node-patterns.js';

function availableVariablesPanel(agent: Agent): SafeHtml {
  if (agent.nodes.length === 0) {
    return html`
      <details class="card card--muted mb-4">
        <summary>Available variables</summary>
        <p class="dim mt-3">This agent has no nodes yet. Once upstream nodes exist, their outputs will appear here.</p>
      </details>
    `;
  }

  const upstreamRows = agent.nodes.map((n) => html`
    <tr>
      <td class="mono">${n.id}</td>
      <td><code>{{upstream.${n.id}.result}}</code></td>
      <td><code>$UPSTREAM_${n.id.toUpperCase().replace(/-/g, '_')}_RESULT</code></td>
    </tr>
  `);

  return html`
    <details class="card card--muted mb-4">
      <summary>Available variables <span class="dim">(click to expand)</span></summary>
      <div class="mt-3">
        <p class="card__title mt-0">Upstream node outputs</p>
        <p class="dim text-xs mb-2">
          Only upstream nodes you mark in <em>Depends on</em> above are actually resolvable at run time. The value is the full stdout of that node as a single string.
        </p>
        <table class="table text-xs mb-3">
          <thead>
            <tr>
              <th>Upstream</th>
              <th>Claude-code template</th>
              <th>Shell env var</th>
            </tr>
          </thead>
          <tbody>${upstreamRows as unknown as SafeHtml[]}</tbody>
        </table>
        <p class="dim text-xs mb-0">
          Structured outputs with declared variables (<code>{{upstream.fetch.json.items[0].title}}</code>, <code>{{upstream.fetch.exit_code}}</code>, etc.) arrive in v0.16.
          See <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/templating.md" target="_blank" rel="noreferrer">docs/templating.md</a> for the full reference.
        </p>
      </div>
    </details>
  `;
}

export interface AddNodeFormValues {
  id?: string;
  type?: 'shell' | 'claude-code';
  command?: string;
  prompt?: string;
  dependsOn?: string[];
}

export function renderAgentAddNode(args: {
  agent: Agent;
  values?: AddNodeFormValues;
  error?: string;
  flash?: string;
  fromCreate?: boolean;
  toolStore?: ToolStore;
  agentStore?: AgentStore;
  variablesStore?: VariablesStore;
}): string {
  const { agent, values: v = {}, error, flash, fromCreate, toolStore, agentStore, variablesStore } = args;
  const allTools = getAvailableTools(toolStore);
  const allAgents = agentStore ? agentStore.listAgents() : [];
  const selectedTool = v.type === 'claude-code' ? 'claude-code' : 'shell-exec';
  const selectedDeps = new Set(v.dependsOn ?? []);
  const suggestedId = v.id ?? suggestNextNodeId(agent);

  const errorBlock = error ? html`<div class="flash flash--error">${error}</div>` : html``;
  const flashBlock = flash ? html`<div class="flash flash--ok">${flash}</div>` : html``;

  const existingNodesCard = html`
    <section class="card mb-4">
      <p class="card__title">Current nodes (v${String(agent.version)})</p>
      <ul class="mb-0" style="padding-left: var(--space-6);">
        ${agent.nodes.map((n) => html`
          <li>
            <code>${n.id}</code>
            <span class="dim">\u2014 ${n.type}${n.dependsOn?.length ? ` (depends on: ${n.dependsOn.join(', ')})` : ''}</span>
          </li>
        `) as unknown as SafeHtml[]}
      </ul>
    </section>
  `;

  const depToggles = agent.nodes.map((n) => html`
    <label class="dep-toggle">
      <input type="checkbox" name="dependsOn" value="${n.id}" ${selectedDeps.has(n.id) ? 'checked' : ''}>
      <code>${n.id}</code>
    </label>
  `);

  const body = html`
    ${pageHeader({
      title: `Add node to ${agent.id}`,
      cta: html`<a class="btn btn--ghost btn--sm" href="/agents/${agent.id}">Done \u2014 view DAG</a>`,
      description: fromCreate
        ? 'Just created the agent. Want to chain another node downstream? Add it here, or click Done to finish.'
        : 'Append a node to this agent. Saving creates a new version (the previous version stays in history).',
    })}

    ${flashBlock}
    ${errorBlock}
    ${existingNodesCard}

    <section class="mb-4">
      <p class="card__title mb-2">Quick start patterns</p>
      <div class="pattern-strip">
        ${NODE_PATTERNS.map((p) => html`
          <button type="button" class="btn btn--sm pattern-btn" data-pattern-tool="${p.tool}" data-pattern-defaults="${unsafeHtml(JSON.stringify(p.defaults).replace(/"/g, '&quot;'))}"
            onclick="(function(btn){var sel=document.getElementById('node-tool-select');if(sel){sel.value=btn.getAttribute('data-pattern-tool');sel.dispatchEvent(new Event('change'));}})(this)">
            <strong class="text-xs">${p.name}</strong>
            <span class="dim text-xs">${p.description}</span>
          </button>
        `) as unknown as SafeHtml[]}
      </div>
    </section>

    <form method="POST" action="/agents/${agent.id}/add-node" class="card" style="max-width: 680px;">
      <div class="form-field">
        <strong>Node id</strong>
        <input type="text" name="id" required pattern="[a-z0-9][a-z0-9_-]*"
               value="${suggestedId}" placeholder="next-step"
               class="form-field__input">
        <span class="form-field__hint">Lowercase, hyphens or underscores. Must be unique within this agent.</span>
      </div>

      ${renderToolPicker({ tools: allTools, agents: allAgents, selectedTool, currentType: v.type, currentAgentId: agent.id })}
      ${renderToolInputsSection(selectedTool, allTools)}

      <fieldset class="fieldset">
        <legend class="fieldset__legend">Depends on</legend>
        <p class="dim text-xs mb-2">Pick zero or more upstream nodes. The new node runs after all of them complete.</p>
        ${depToggles as unknown as SafeHtml[]}
      </fieldset>

      ${availableVariablesPanel(agent)}

      <fieldset class="fieldset">
        <legend class="fieldset__legend">Implementation</legend>

        <div class="node-field" data-node-field="shell">
          <div class="form-field">
            <strong>Command</strong>
            <textarea name="command" rows="4" placeholder='echo "$UPSTREAM_FETCH_RESULT" | wc -w'
              class="form-field__textarea"
              data-template-palette="shell"
              data-palette-source="palette-add-node">${v.command ?? ''}</textarea>
            <span class="form-field__hint">Type <code>$</code> for available env vars.</span>
          </div>
        </div>

        <div class="node-field" data-node-field="claude-code">
          <div class="form-field">
            <strong>Prompt</strong>
            <textarea name="prompt" rows="4" placeholder='Summarise: {{upstream.fetch.result}}'
              class="form-field__textarea"
              data-template-palette="claude"
              data-palette-source="palette-add-node">${v.prompt ?? ''}</textarea>
            <span class="form-field__hint">Type <code>{{</code> for available template refs.</span>
          </div>
        </div>
      </fieldset>

      ${renderPalettePayload('palette-add-node', computePaletteSuggestions(agent, { variablesStore }))}

      <div class="flex-end" style="align-items: center;">
        <a class="btn btn--ghost" href="/agents/${agent.id}">Cancel</a>
        <a class="btn" href="/agents/${agent.id}">Done here \u2014 view DAG</a>
        <button type="submit" class="btn btn--primary">Add node</button>
      </div>
    </form>
  `;

  return render(layout({ title: `Add node \u2014 ${agent.id}`, activeNav: 'agents' }, body));
}

function suggestNextNodeId(agent: Agent): string {
  const existing = new Set(agent.nodes.map((n) => n.id));
  let n = agent.nodes.length + 1;
  while (existing.has(`step-${n}`)) n++;
  return `step-${n}`;
}
