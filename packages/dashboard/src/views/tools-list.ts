import type { ToolDefinition } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export function renderToolsList(args: {
  builtins: ToolDefinition[];
  userTools: ToolDefinition[];
  filter?: { q?: string; type?: string };
}): string {
  const f = args.filter ?? {};
  let builtins = args.builtins;
  let userTools = args.userTools;

  // Apply search filter.
  if (f.q) {
    const q = f.q.toLowerCase();
    builtins = builtins.filter((t) => t.id.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));
    userTools = userTools.filter((t) => t.id.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));
  }
  // Apply type filter.
  if (f.type) {
    builtins = builtins.filter((t) => t.implementation.type === f.type);
    userTools = userTools.filter((t) => t.implementation.type === f.type);
  }

  const total = builtins.length + userTools.length;

  const filterBar = html`
    <form method="GET" action="/tools" class="filters" style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-bottom: var(--space-4);">
      <input type="text" name="q" value="${f.q ?? ''}" placeholder="Search tools..."
        style="padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: var(--font-mono); width: 16rem;">
      <select name="type" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm);">
        <option value="">All types</option>
        <option value="shell"${f.type === 'shell' ? ' selected' : ''}>shell</option>
        <option value="claude-code"${f.type === 'claude-code' ? ' selected' : ''}>claude-code</option>
        <option value="builtin"${f.type === 'builtin' ? ' selected' : ''}>builtin</option>
      </select>
      <button type="submit" class="btn btn--sm">Filter</button>
      ${(f.q || f.type) ? html`<a href="/tools" class="dim" style="font-size: var(--font-size-xs);">Reset</a>` : html``}
    </form>
  `;

  const body = html`
    ${pageHeader({ title: 'Tools' })}

    ${filterBar}

    ${total === 0 ? html`
      <div class="settings-empty">
        <h3 style="margin-top: 0;">No tools found</h3>
        <p class="dim">${f.q || f.type ? 'No tools match your filters.' : 'Tools are named, reusable units of work that agent nodes invoke.'}</p>
        ${f.q || f.type ? html`<a href="/tools" class="btn btn--sm">Reset filters</a>` : html``}
      </div>
    ` : html``}

    ${builtins.length > 0 ? html`
      <section>
        <h2>Built-in tools</h2>
        <div class="agent-grid">
          ${builtins.map((t) => renderToolCard(t)) as unknown as SafeHtml[]}
        </div>
      </section>
    ` : html``}

    ${userTools.length > 0 ? html`
      <section style="margin-top: var(--space-6);">
        <h2>User tools</h2>
        <div class="agent-grid">
          ${userTools.map((t) => renderToolCard(t)) as unknown as SafeHtml[]}
        </div>
      </section>
    ` : html``}

    <footer style="margin-top: var(--space-8); text-align: center;">
      <p class="dim">${String(total)} tool${total === 1 ? '' : 's'} ${f.q || f.type ? 'matching' : 'available'}</p>
    </footer>
  `;

  return render(layout({ title: 'Tools', activeNav: 'tools' }, body));
}

function renderToolCard(t: ToolDefinition): SafeHtml {
  const sourceBadge = t.source === 'builtin'
    ? html`<span class="badge badge--muted">builtin</span>`
    : t.source === 'community'
      ? html`<span class="badge badge--err">community</span>`
      : html`<span class="badge badge--ok">${t.source}</span>`;

  const implBadge = t.implementation.type === 'shell'
    ? html`<span class="badge badge--ok">shell</span>`
    : t.implementation.type === 'claude-code'
      ? html`<span class="badge badge--info">claude-code</span>`
      : html`<span class="badge badge--muted">${t.implementation.type}</span>`;

  const inputCount = Object.keys(t.inputs).length;
  const outputCount = Object.keys(t.outputs).length;

  return html`
    <article class="agent-card">
      <div class="agent-card__header">
        <h3 class="agent-card__title"><a href="/tools/${t.id}">${t.id}</a></h3>
        ${sourceBadge}
        ${implBadge}
      </div>
      <p class="agent-card__desc">${t.description ?? 'No description.'}</p>
      <div class="agent-card__meta">
        <span>${String(inputCount)} input${inputCount === 1 ? '' : 's'}</span>
        <span>${String(outputCount)} output${outputCount === 1 ? '' : 's'}</span>
      </div>
    </article>
  `;
}
