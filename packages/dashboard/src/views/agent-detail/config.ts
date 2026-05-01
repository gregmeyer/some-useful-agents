import { html, type SafeHtml } from '../html.js';
import {
  renderVariablesEditor,
  renderNotifyEditor,
  providerOption,
  renderModelOptions,
} from '../agent-detail-helpers.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';

/**
 * One Config-tab section as a `.card` with a standardised header.
 * Folds the repeated `style="margin: 0 0 var(--space-3);"` heading
 * pattern into one place.
 */
function configCard(title: string, body: SafeHtml): SafeHtml {
  return html`
    <section class="card">
      <h3 style="margin: 0 0 var(--space-3);">${title}</h3>
      ${body}
    </section>
  `;
}

/**
 * Wrap a heavyweight editor (Output Widget, Notify) in a collapsed
 * `<details>` when the agent already has the feature configured. When
 * not configured, render a small "Set up" CTA that opens the editor.
 * This keeps the Config tab roughly one viewport tall by default.
 */
function collapsibleSection(args: {
  title: string;
  configured: boolean;
  emptyCta: SafeHtml;
  editor: SafeHtml;
}): SafeHtml {
  if (!args.configured) {
    return html`
      <section class="card">
        <h3 style="margin: 0 0 var(--space-3);">${args.title}</h3>
        ${args.emptyCta}
      </section>
    `;
  }
  return html`
    <details class="card config-collapsible">
      <summary>
        <h3 style="margin: 0; display: inline;">${args.title}</h3>
        <span class="dim" style="margin-left: var(--space-2); font-size: var(--font-size-xs);">configured — click to edit</span>
      </summary>
      <div style="padding: var(--space-3) 0 0;">
        ${args.editor}
      </div>
    </details>
  `;
}

export async function renderAgentConfig(args: AgentDetailArgs): Promise<string> {
  const { agent, secretsStore } = args;

  // Secret counts for the Secrets summary line
  let secretsSet = 0;
  let secretsMissing = 0;
  const allSecrets = new Set<string>();
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) allSecrets.add(name);
  }
  for (const name of allSecrets) {
    try { if (await secretsStore.has(name)) secretsSet++; else secretsMissing++; } catch { /* unknown */ }
  }

  // ── Left column: lightweight controls ──────────────────────────────
  const mcpCard = configCard('MCP exposure', html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Lets MCP clients (Claude Desktop, Claude Code, Cursor) call this agent via <a href="/settings/mcp">sua's MCP server</a>.
    </p>
    <form method="POST" action="/agents/${agent.id}/mcp" style="display: flex; gap: var(--space-2); align-items: center;">
      <input type="hidden" name="enabled" value="${agent.mcp ? 'false' : 'true'}">
      ${agent.mcp
        ? html`<span class="badge badge--ok">exposed</span><button type="submit" class="btn btn--sm btn--warn">Stop exposing</button>`
        : html`<span class="badge badge--muted">not exposed</span><button type="submit" class="btn btn--sm">Expose via MCP</button>`}
    </form>
  `);

  const llmCard = configCard('LLM defaults', html`
    <form method="POST" action="/agents/${agent.id}/llm" id="llm-form" style="display: flex; flex-direction: column; gap: var(--space-2);">
      <div style="display: flex; gap: var(--space-2); align-items: center;">
        <label style="font-size: var(--font-size-xs); color: var(--color-text-muted); min-width: 55px;">Provider</label>
        <select name="provider" id="llm-provider" class="form-field" style="flex: 1; padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm);">
          ${providerOption('claude', agent.provider)}
          ${providerOption('codex', agent.provider)}
        </select>
      </div>
      <div style="display: flex; gap: var(--space-2); align-items: center;">
        <label style="font-size: var(--font-size-xs); color: var(--color-text-muted); min-width: 55px;">Model</label>
        <select name="model" id="llm-model" class="form-field" style="flex: 1; padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm); font-family: var(--font-mono);">
          ${renderModelOptions(agent.provider, agent.model)}
        </select>
      </div>
      <div id="llm-model-desc" class="dim" style="font-size: var(--font-size-xs); min-height: 1.2em;"></div>
      <div style="display: flex; justify-content: flex-end;">
        <button type="submit" class="btn btn--sm">Save</button>
      </div>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">Applies to all claude-code nodes. Individual nodes can override in YAML.</p>
    </form>
  `);

  const variablesCard = configCard('Variables', renderVariablesEditor(agent));

  const secretsCard = configCard('Secrets', html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">
      ${String(allSecrets.size)} declared. ${String(secretsSet)} set, ${String(secretsMissing)} missing.
    </p>
    <a href="/settings/secrets" class="btn btn--sm">Manage secrets</a>
  `);

  // ── Right column: heavyweight collapsibles ─────────────────────────
  // Output Widget editor lives on its own page — `/agents/<id>/output-widget`
  // — because the editor is large enough to deserve a focused surface
  // with sub-tabs (Type / Fields / Interactive / Preview). On the Config
  // tab we just summarise + link.
  const outputWidgetSection = (() => {
    if (!agent.outputWidget) {
      return configCard('Output Widget', html`
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
          Render run output as a widget on the agent overview and the Pulse tile.
        </p>
        <a class="btn btn--sm" href="/agents/${agent.id}/output-widget">Set up output widget</a>
      `);
    }
    const fieldCount = agent.outputWidget.fields?.length ?? 0;
    const summary = agent.outputWidget.type === 'ai-template'
      ? 'AI-generated HTML template'
      : `${String(fieldCount)} field${fieldCount === 1 ? '' : 's'}`;
    return configCard('Output Widget', html`
      <dl class="kv" style="margin: 0 0 var(--space-3); font-size: var(--font-size-xs);">
        <dt>Type</dt><dd class="mono">${agent.outputWidget.type}</dd>
        <dt>Layout</dt><dd>${summary}</dd>
        ${agent.outputWidget.interactive ? html`<dt>Interactive</dt><dd>yes — runs in place</dd>` : html``}
      </dl>
      <a class="btn btn--sm" href="/agents/${agent.id}/output-widget">Edit output widget</a>
    `);
  })();

  const notifySection = collapsibleSection({
    title: 'Notify',
    configured: !!agent.notify,
    emptyCta: html`
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
        Send a Slack message or webhook when a run finishes.
      </p>
      <details class="config-empty-cta">
        <summary><span class="btn btn--sm">Set up notify</span></summary>
        <div style="margin-top: var(--space-3);">
          ${renderNotifyEditor(agent)}
        </div>
      </details>
    `,
    editor: renderNotifyEditor(agent),
  });

  // Variables runs full-width because its editor is a 5-column table that
  // doesn't compress gracefully into half a viewport. Keeping it above the
  // two-column grid puts the most-frequently-edited control where the eye
  // lands first and avoids horizontal overflow into the right column.
  const content = html`
    ${variablesCard}
    <div class="config-grid" style="margin-top: var(--space-4);">
      <div class="config-grid__col">
        ${llmCard}
        ${mcpCard}
        ${secretsCard}
      </div>
      <div class="config-grid__col">
        ${outputWidgetSection}
        ${notifySection}
      </div>
    </div>
  `;

  return agentPageShell({ ...args, activeTab: 'config' }, content);
}
