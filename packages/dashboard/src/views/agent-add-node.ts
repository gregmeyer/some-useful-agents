import type { Agent, AgentStore, ToolStore, VariablesStore } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { computePaletteSuggestions, renderPalettePayload } from './template-palette.js';
import { renderToolPicker, renderToolInputsSection, getAvailableTools } from './tool-picker.js';
import { NODE_PATTERNS } from './node-patterns.js';

/**
 * Render a reference card listing everything the author can inject into
 * the new node's command or prompt. Covers:
 *   - upstream node outputs (both shell env-var and claude-code template forms)
 *   - the current run-time vocabulary (`result` is all we have today;
 *     structured fields like `exit_code`, `duration_ms`, and JSON paths
 *     arrive in v0.16 — see docs/templating.md)
 *
 * Panel is static content; no JS. Users read, copy-paste.
 */
function availableVariablesPanel(agent: Agent): SafeHtml {
  if (agent.nodes.length === 0) {
    return html`
      <details class="card card--muted" style="margin-bottom: var(--space-4);">
        <summary>Available variables</summary>
        <p class="dim" style="margin: var(--space-2) 0 0;">This agent has no nodes yet. Once upstream nodes exist, their outputs will appear here.</p>
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
    <details class="card card--muted" style="margin-bottom: var(--space-4);">
      <summary>Available variables <span class="dim" style="font-weight: var(--weight-regular);">(click to expand)</span></summary>
      <div style="margin-top: var(--space-3);">
        <p class="card__title" style="margin-top: 0;">Upstream node outputs</p>
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">
          Only upstream nodes you mark in <em>Depends on</em> above are actually resolvable at run time. The value is the full stdout of that node as a single string.
        </p>
        <table class="table" style="font-size: var(--font-size-xs); margin-bottom: var(--space-3);">
          <thead>
            <tr>
              <th>Upstream</th>
              <th>Claude-code template</th>
              <th>Shell env var</th>
            </tr>
          </thead>
          <tbody>${upstreamRows as unknown as SafeHtml[]}</tbody>
        </table>
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">
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
  /** Selected upstream node ids (multi-select). */
  dependsOn?: string[];
}

/**
 * Render the "add a node to this agent" form. Lists the agent's current
 * nodes so the user can see what they're extending, then a form with a
 * dependsOn multi-select limited to existing ids.
 *
 * After submit, the route appends the node and bumps to a new version
 * (via agentStore.upsertAgent), then redirects back to this same form
 * with a flash so the user can chain another node if they want.
 */
export function renderAgentAddNode(args: {
  agent: Agent;
  values?: AddNodeFormValues;
  error?: string;
  flash?: string;
  /** True if the user just landed here from /agents/new — surface a "Done" hint. */
  fromCreate?: boolean;
  /** v0.16+: tool store for the tool picker dropdown. */
  toolStore?: ToolStore;
  /** Agent store for listing invocable agents in the tool picker. */
  agentStore?: AgentStore;
  variablesStore?: VariablesStore;
}): string {
  const { agent, values: v = {}, error, flash, fromCreate, toolStore, agentStore, variablesStore } = args;
  const allTools = getAvailableTools(toolStore);
  const allAgents = agentStore ? agentStore.listAgents() : [];
  const selectedTool = v.type === 'claude-code' ? 'claude-code' : 'shell-exec';
  const type = v.type ?? 'shell';
  const isShell = type === 'shell';
  const isClaude = type === 'claude-code';
  const selectedDeps = new Set(v.dependsOn ?? []);

  const errorBlock = error
    ? html`<div class="flash flash--error">${error}</div>`
    : html``;
  const flashBlock = flash
    ? html`<div class="flash flash--ok">${flash}</div>`
    : html``;

  // Existing-nodes summary card. Stays simple — read-only list.
  const existingNodesCard = html`
    <section class="card" style="margin-bottom: var(--space-4);">
      <p class="card__title">Current nodes (v${String(agent.version)})</p>
      <ul style="margin: 0; padding-left: var(--space-6);">
        ${agent.nodes.map((n) => html`
          <li>
            <code>${n.id}</code>
            <span class="dim">\u2014 ${n.type}${n.dependsOn?.length ? ` (depends on: ${n.dependsOn.join(', ')})` : ''}</span>
          </li>
        `) as unknown as SafeHtml[]}
      </ul>
    </section>
  `;

  // Dependency checkboxes — each existing node id becomes a toggle.
  const depToggles = agent.nodes.map((n) => html`
    <label style="display: inline-flex; align-items: center; gap: var(--space-1); margin-right: var(--space-3); font-weight: var(--weight-regular); font-size: var(--font-size-sm);">
      <input type="checkbox" name="dependsOn" value="${n.id}" ${selectedDeps.has(n.id) ? 'checked' : ''}>
      <code>${n.id}</code>
    </label>
  `);

  // Default the new node's id to a sensible suggestion, but only when the
  // user hasn't typed anything yet.
  const suggestedId = v.id ?? suggestNextNodeId(agent);

  const headerCta = html`
    <span style="display: inline-flex; gap: var(--space-2);">
      <a class="btn btn--ghost btn--sm" href="/agents/${agent.id}">Done \u2014 view DAG</a>
    </span>
  `;

  const body = html`
    ${pageHeader({
      title: `Add node to ${agent.id}`,
      cta: headerCta,
      description: fromCreate
        ? 'Just created the agent. Want to chain another node downstream? Add it here, or click Done to finish.'
        : 'Append a node to this agent. Saving creates a new version (the previous version stays in history).',
    })}

    ${flashBlock}
    ${errorBlock}

    ${existingNodesCard}

    <section style="margin-bottom: var(--space-4);">
      <p class="card__title" style="margin-bottom: var(--space-2);">Quick start patterns</p>
      <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
        ${NODE_PATTERNS.map((p) => html`
          <button type="button" class="btn btn--sm" data-pattern-tool="${p.tool}" data-pattern-defaults="${unsafeHtml(JSON.stringify(p.defaults).replace(/"/g, '&quot;'))}"
            style="text-align: left; display: flex; flex-direction: column; align-items: flex-start; padding: var(--space-2) var(--space-3);"
            onclick="(function(btn){var sel=document.getElementById('node-tool-select');if(sel){sel.value=btn.getAttribute('data-pattern-tool');sel.dispatchEvent(new Event('change'));}})(this)">
            <strong style="font-size: var(--font-size-xs);">${p.name}</strong>
            <span class="dim" style="font-size: var(--font-size-xs);">${p.description}</span>
          </button>
        `) as unknown as SafeHtml[]}
      </div>
    </section>

    <form method="POST" action="/agents/${agent.id}/add-node" class="card" style="max-width: 680px;">
      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
        <strong>Node id</strong>
        <input type="text" name="id" required pattern="[a-z0-9][a-z0-9_-]*"
               value="${suggestedId}"
               placeholder="next-step"
               style="${INPUT_STYLE}">
        <span class="dim" style="font-size: var(--font-size-xs);">Lowercase, hyphens or underscores. Must be unique within this agent.</span>
      </label>

      ${renderToolPicker({ tools: allTools, agents: allAgents, selectedTool, currentType: v.type, currentAgentId: agent.id })}
      ${renderToolInputsSection(selectedTool, allTools)}

      <fieldset style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4);">
        <legend style="padding: 0 var(--space-2); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Depends on</legend>
        <p class="dim" style="margin: 0 0 var(--space-2); font-size: var(--font-size-xs);">Pick zero or more upstream nodes. The new node runs after all of them complete.</p>
        ${depToggles as unknown as SafeHtml[]}
      </fieldset>

      ${availableVariablesPanel(agent)}

      <fieldset style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4);">
        <legend style="padding: 0 var(--space-2); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Implementation</legend>

        <div class="node-field" data-node-field="shell">
          <label style="display: flex; flex-direction: column; gap: var(--space-1);">
            <strong>Command</strong>
            <textarea name="command" rows="4" placeholder='echo "$UPSTREAM_FETCH_RESULT" | wc -w'
              style="${TEXTAREA_STYLE}"
              data-template-palette="shell"
              data-palette-source="palette-add-node">${v.command ?? ''}</textarea>
            <span class="dim" style="font-size: var(--font-size-xs);">Type <code>$</code> for available env vars.</span>
          </label>
        </div>

        <div class="node-field" data-node-field="claude-code">
          <label style="display: flex; flex-direction: column; gap: var(--space-1);">
            <strong>Prompt</strong>
            <textarea name="prompt" rows="4" placeholder='Summarise: {{upstream.fetch.result}}'
              style="${TEXTAREA_STYLE}"
              data-template-palette="claude"
              data-palette-source="palette-add-node">${v.prompt ?? ''}</textarea>
            <span class="dim" style="font-size: var(--font-size-xs);">Type <code>{{</code> for available template refs.</span>
          </label>
        </div>
      </fieldset>

      ${renderPalettePayload('palette-add-node', computePaletteSuggestions(agent, { variablesStore }))}

      <div style="display: flex; gap: var(--space-2); justify-content: flex-end; align-items: center;">
        <a class="btn btn--ghost" href="/agents/${agent.id}">Cancel</a>
        <a class="btn" href="/agents/${agent.id}">Done here \u2014 view DAG</a>
        <button type="submit" class="btn btn--primary">Add node</button>
      </div>
    </form>
  `;

  return render(layout({ title: `Add node \u2014 ${agent.id}`, activeNav: 'agents' }, body));
}

/**
 * Suggest a node id that doesn't collide. Defaults to "main" for empty
 * agents (shouldn't happen — they always have at least one) or
 * "step-2", "step-3", ... numbered after current count.
 */
function suggestNextNodeId(agent: Agent): string {
  const existing = new Set(agent.nodes.map((n) => n.id));
  let n = agent.nodes.length + 1;
  while (existing.has(`step-${n}`)) n++;
  return `step-${n}`;
}

const INPUT_STYLE: SafeHtml = unsafeHtml(
  'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit;',
);
const TEXTAREA_STYLE: SafeHtml = unsafeHtml(
  'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); resize: vertical;',
);
