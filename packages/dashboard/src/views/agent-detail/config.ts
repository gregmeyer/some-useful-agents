import { html } from '../html.js';
import {
  renderVariablesEditor,
  renderOutputWidgetEditor,
  renderNotifyEditor,
  statusOption,
  providerOption,
  renderModelOptions,
} from '../agent-detail-helpers.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';

export async function renderAgentConfig(args: AgentDetailArgs): Promise<string> {
  const { agent, secretsStore } = args;

  // Secret counts for the secrets section
  let secretsSet = 0;
  let secretsMissing = 0;
  const allSecrets = new Set<string>();
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) allSecrets.add(name);
  }
  for (const name of allSecrets) {
    try { if (await secretsStore.has(name)) secretsSet++; else secretsMissing++; } catch { /* unknown */ }
  }

  const content = html`
    <!-- Status -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">Status</h3>
      <form method="POST" action="/agents/${agent.id}/status" style="display: flex; gap: var(--space-2); align-items: center;">
        <select name="newStatus" class="form-field" style="padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm);">
          ${statusOption('active', agent.status)}
          ${statusOption('paused', agent.status)}
          ${statusOption('draft', agent.status)}
          ${statusOption('archived', agent.status)}
        </select>
        <button type="submit" class="btn btn--sm">Apply</button>
      </form>
    </section>

    <!-- LLM defaults -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">LLM defaults</h3>
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
          <button type="submit" class="btn btn--sm">Apply</button>
        </div>
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">Applies to all claude-code nodes. Individual nodes can override in YAML.</p>
      </form>
    </section>

    <!-- MCP exposure -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">MCP exposure</h3>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
        When on, this agent appears in <code>list-agents</code> and is runnable via <code>run-agent</code> from MCP clients (Claude Desktop, Claude Code, Cursor) connected to <a href="/settings/mcp">sua's MCP server</a>.
        Toggling rewrites the agent record but does not restart the running MCP server — restart it from <a href="/settings/mcp">Settings → MCP</a> so the new agent list is loaded.
      </p>
      <form method="POST" action="/agents/${agent.id}/mcp" style="display: flex; gap: var(--space-2); align-items: center;">
        <input type="hidden" name="enabled" value="${agent.mcp ? 'false' : 'true'}">
        ${agent.mcp
          ? html`<span class="badge badge--ok">exposed</span><button type="submit" class="btn btn--sm btn--warn">Stop exposing</button>`
          : html`<span class="badge badge--muted">not exposed</span><button type="submit" class="btn btn--sm btn--primary">Expose via MCP</button>`}
      </form>
    </section>

    <!-- Variables -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">Variables</h3>
      ${renderVariablesEditor(agent)}
    </section>

    <!-- Output Widget -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">Output Widget</h3>
      ${renderOutputWidgetEditor(agent)}
    </section>

    <!-- Notify -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">Notify</h3>
      ${renderNotifyEditor(agent)}
    </section>

    <!-- Secrets -->
    <section class="card">
      <h3 style="margin: 0 0 var(--space-3);">Secrets</h3>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">
        ${String(allSecrets.size)} declared. ${String(secretsSet)} set, ${String(secretsMissing)} missing.
      </p>
      <a href="/settings/secrets" class="btn btn--sm">Manage secrets</a>
    </section>
  `;

  return agentPageShell({ ...args, activeTab: 'config' }, content);
}
