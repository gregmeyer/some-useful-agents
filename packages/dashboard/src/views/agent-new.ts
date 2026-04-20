import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export interface AgentNewFormValues {
  id?: string;
  name?: string;
  description?: string;
  type?: 'shell' | 'claude-code';
  command?: string;
  prompt?: string;
}

export function renderAgentNew(args: {
  values?: AgentNewFormValues;
  error?: string;
}): string {
  const v = args.values ?? {};
  const type = v.type ?? 'shell';
  const isShell = type === 'shell';
  const isClaude = type === 'claude-code';

  const errorBlock = args.error ? html`<div class="flash flash--error">${args.error}</div>` : html``;

  const body = html`
    ${pageHeader({
      title: 'New agent',
      description: 'Create a single-node v2 DAG agent. For multi-node DAGs, create each node as its own agent, then chain them via the tutorial or CLI.',
    })}

    ${errorBlock}

    <form method="POST" action="/agents/new" class="card" style="max-width: 680px;">
      <div class="form-field">
        <strong>Id</strong>
        <input type="text" name="id" required pattern="[a-z0-9][a-z0-9-]*"
               value="${v.id ?? ''}" placeholder="my-agent"
               class="form-field__input">
        <span class="form-field__hint">Lowercase letters, digits, and hyphens. Must start with a letter or digit.</span>
      </div>

      <div class="form-field">
        <strong>Name</strong>
        <input type="text" name="name" required value="${v.name ?? ''}" class="form-field__input">
      </div>

      <div class="form-field">
        <strong>Description</strong>
        <input type="text" name="description" value="${v.description ?? ''}" class="form-field__input">
      </div>

      <fieldset class="fieldset">
        <legend class="fieldset__legend">Type</legend>
        <label class="radio-option mb-2">
          <input type="radio" name="type" value="shell" ${isShell ? 'checked' : ''}>
          <span><strong>Shell</strong> <span class="dim">\u2014 runs an arbitrary command locally</span></span>
        </label>
        <label class="radio-option">
          <input type="radio" name="type" value="claude-code" ${isClaude ? 'checked' : ''}>
          <span><strong>Claude Code</strong> <span class="dim">\u2014 runs a Claude Code prompt</span></span>
        </label>
      </fieldset>

      <div class="form-field">
        <strong>Command <span class="dim text-xs">(shell agents only)</span></strong>
        <textarea name="command" rows="4" placeholder="echo hello" class="form-field__textarea">${v.command ?? ''}</textarea>
      </div>

      <div class="form-field mb-4">
        <strong>Prompt <span class="dim text-xs">(claude-code agents only)</span></strong>
        <textarea name="prompt" rows="4" placeholder="Summarise the attached text." class="form-field__textarea">${v.prompt ?? ''}</textarea>
      </div>

      <div class="flex-end">
        <a class="btn" href="/agents">Cancel</a>
        <button type="submit" class="btn btn--primary">Create agent</button>
      </div>
    </form>
  `;

  return render(layout({ title: 'New agent', activeNav: 'agents' }, body));
}
