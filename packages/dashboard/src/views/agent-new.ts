import { html, render, unsafeHtml, type SafeHtml } from './html.js';
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

/**
 * Render the "create agent" form. Pre-fills any submitted values so the
 * user doesn't lose their input on validation failure.
 */
export function renderAgentNew(args: {
  values?: AgentNewFormValues;
  error?: string;
}): string {
  const v = args.values ?? {};
  const type = v.type ?? 'shell';
  const isShell = type === 'shell';
  const isClaude = type === 'claude-code';

  const errorBlock = args.error
    ? html`<div class="flash flash--error">${args.error}</div>`
    : html``;

  const body = html`
    ${pageHeader({
      title: 'New agent',
      description: 'Create a single-node v2 DAG agent. For multi-node DAGs, create each node as its own agent, then chain them via the tutorial or CLI.',
    })}

    ${errorBlock}

    <form method="POST" action="/agents/new" class="card" style="max-width: 680px;">
      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
        <strong>Id</strong>
        <input type="text" name="id" required pattern="[a-z0-9][a-z0-9-]*"
               value="${v.id ?? ''}"
               placeholder="my-agent"
               style="${INPUT_STYLE}">
        <span class="dim" style="font-size: var(--font-size-xs);">Lowercase letters, digits, and hyphens. Must start with a letter or digit.</span>
      </label>

      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
        <strong>Name</strong>
        <input type="text" name="name" required value="${v.name ?? ''}" style="${INPUT_STYLE}">
      </label>

      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
        <strong>Description</strong>
        <input type="text" name="description" value="${v.description ?? ''}" style="${INPUT_STYLE}">
      </label>

      <fieldset style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4);">
        <legend style="padding: 0 var(--space-2); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Type</legend>
        <label style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2);">
          <input type="radio" name="type" value="shell" ${isShell ? 'checked' : ''}>
          <span><strong>Shell</strong> <span class="dim">\u2014 runs an arbitrary command locally</span></span>
        </label>
        <label style="display: flex; align-items: center; gap: var(--space-2);">
          <input type="radio" name="type" value="claude-code" ${isClaude ? 'checked' : ''}>
          <span><strong>Claude Code</strong> <span class="dim">\u2014 runs a Claude Code prompt</span></span>
        </label>
      </fieldset>

      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
        <strong>Command <span class="dim" style="font-weight: var(--weight-regular); font-size: var(--font-size-xs);">(shell agents only)</span></strong>
        <textarea name="command" rows="4" placeholder="echo hello" style="${TEXTAREA_STYLE}">${v.command ?? ''}</textarea>
      </label>

      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-6);">
        <strong>Prompt <span class="dim" style="font-weight: var(--weight-regular); font-size: var(--font-size-xs);">(claude-code agents only)</span></strong>
        <textarea name="prompt" rows="4" placeholder="Summarise the attached text." style="${TEXTAREA_STYLE}">${v.prompt ?? ''}</textarea>
      </label>

      <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
        <a class="btn" href="/agents">Cancel</a>
        <button type="submit" class="btn btn--primary">Create agent</button>
      </div>
    </form>
  `;

  return render(layout({ title: 'New agent', activeNav: 'agents' }, body));
}

const INPUT_STYLE: SafeHtml = unsafeHtml(
  'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: inherit;',
);
const TEXTAREA_STYLE: SafeHtml = unsafeHtml(
  'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); resize: vertical;',
);
