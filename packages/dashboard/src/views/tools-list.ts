import type { ToolDefinition } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export function renderToolsList(args: {
  builtins: ToolDefinition[];
  userTools: ToolDefinition[];
}): string {
  const { builtins, userTools } = args;
  const total = builtins.length + userTools.length;

  const body = html`
    ${pageHeader({ title: 'Tools' })}

    ${total === 0 ? html`
      <div class="settings-empty">
        <h3 style="margin-top: 0;">No tools yet</h3>
        <p class="dim">Tools are named, reusable units of work that agent nodes invoke.<br>
          9 built-in tools ship with sua. Create your own in <code>tools/</code>.</p>
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
      <p class="dim">${String(total)} tool${total === 1 ? '' : 's'} available</p>
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
