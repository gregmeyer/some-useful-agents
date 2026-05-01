import { html } from '../html.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';

export function renderAgentYaml(args: AgentDetailArgs & { yaml: string; error?: string }): string {
  const { yaml, error } = args;
  const agent = args.agent;

  const content = html`
    ${error ? html`<div class="flash flash--error">${error}</div>` : html``}
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      v${String(agent.version)}. Saving creates a new version. The YAML is validated before save.
    </p>
    <form method="POST" action="/agents/${agent.id}/yaml" class="card" style="max-width: 800px;">
      <label style="display: flex; flex-direction: column; gap: var(--space-2);">
        <textarea name="yaml" rows="30" required
          style="padding: var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); resize: vertical; line-height: 1.5; tab-size: 2;">${yaml}</textarea>
      </label>
      <div style="margin-top: var(--space-3); display: flex; gap: var(--space-2); justify-content: flex-end;">
        <a class="btn btn--ghost" href="/agents/${agent.id}">Cancel</a>
        <button type="submit" class="btn btn--primary">Save YAML</button>
      </div>
    </form>
  `;

  return agentPageShell({ ...args, activeTab: 'yaml' }, content);
}
