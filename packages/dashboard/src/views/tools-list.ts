import type { ToolDefinition } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

type Tab = 'user' | 'builtin';

export function renderToolsList(args: {
  builtins: ToolDefinition[];
  userTools: ToolDefinition[];
  filter?: { q?: string; type?: string };
  tab?: Tab;
  limit?: number;
  offset?: number;
}): string {
  const f = args.filter ?? {};
  const limit = args.limit ?? 12;
  const offset = args.offset ?? 0;
  const tab: Tab = args.tab === 'builtin' ? 'builtin' : 'user';

  // Apply search + type filters to both sets (for accurate tab counts).
  const applyFilters = (list: ToolDefinition[]): ToolDefinition[] => {
    let r = list;
    if (f.q) {
      const q = f.q.toLowerCase();
      r = r.filter((t) => t.id.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));
    }
    if (f.type) r = r.filter((t) => t.implementation.type === f.type);
    return r;
  };
  const filteredBuiltins = applyFilters(args.builtins);
  const filteredUserTools = applyFilters(args.userTools);

  const activeList = tab === 'user' ? filteredUserTools : filteredBuiltins;
  const total = activeList.length;
  const paged = activeList.slice(offset, offset + limit);

  const tabLink = (t: Tab, label: string, count: number): SafeHtml => {
    const isActive = t === tab;
    const url = toolBuildUrl(f, limit, 0, t);
    const style = isActive
      ? 'border-bottom: 2px solid var(--color-primary); color: var(--color-text); font-weight: var(--weight-bold);'
      : 'border-bottom: 2px solid transparent; color: var(--color-text-muted);';
    return html`<a href="${url}" style="padding: var(--space-2) var(--space-1); ${style} text-decoration: none;">${label} <span class="dim">(${String(count)})</span></a>`;
  };

  const tabStrip = html`
    <nav style="display: flex; gap: var(--space-4); border-bottom: 1px solid var(--color-border); margin-bottom: var(--space-4);">
      ${tabLink('user', 'User tools', filteredUserTools.length)}
      ${tabLink('builtin', 'Built-in', filteredBuiltins.length)}
    </nav>
  `;

  const filterBar = html`
    <form method="GET" action="/tools" class="filters" style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-bottom: var(--space-4);">
      <input type="hidden" name="tab" value="${tab}">
      <input type="text" name="q" value="${f.q ?? ''}" placeholder="Search tools..."
        style="padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: var(--font-mono); width: 16rem;">
      <select name="type" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm);">
        <option value="">All types</option>
        <option value="shell"${f.type === 'shell' ? ' selected' : ''}>shell</option>
        <option value="claude-code"${f.type === 'claude-code' ? ' selected' : ''}>claude-code</option>
        <option value="builtin"${f.type === 'builtin' ? ' selected' : ''}>builtin</option>
        <option value="mcp"${f.type === 'mcp' ? ' selected' : ''}>mcp</option>
      </select>
      <button type="submit" class="btn btn--sm">Filter</button>
      ${(f.q || f.type) ? html`<a href="${toolBuildUrl({}, limit, 0, tab)}" class="dim" style="font-size: var(--font-size-xs);">Reset</a>` : html``}
    </form>
  `;

  const emptyState = html`
    <div class="settings-empty">
      <h3 style="margin-top: 0;">${tab === 'user' ? 'No user tools' : 'No built-in tools match'}</h3>
      <p class="dim">
        ${f.q || f.type
          ? 'No tools match your filters.'
          : tab === 'user'
            ? 'User tools come from MCP imports or custom definitions. Import from an MCP server to populate this list.'
            : 'Built-in tools ship with the runtime.'}
      </p>
      ${f.q || f.type
        ? html`<a href="${toolBuildUrl({}, limit, 0, tab)}" class="btn btn--sm">Reset filters</a>`
        : tab === 'user' ? html`<a href="/tools/mcp/import" class="btn btn--sm">Import from MCP server</a>` : html``}
    </div>
  `;

  const body = html`
    ${pageHeader({
      title: 'Tools',
      cta: html`<a href="/tools/mcp/import" class="btn btn--sm">Import from MCP server</a>`,
    })}

    ${tabStrip}
    ${filterBar}

    ${total === 0 ? emptyState : html`
      <div class="agent-grid">
        ${paged.map((t) => renderToolCard(t)) as unknown as SafeHtml[]}
      </div>
      ${toolPager(f, tab, limit, offset, total)}
      <footer style="margin-top: var(--space-8); text-align: center;">
        <p class="dim">${String(total)} ${tab === 'user' ? 'user' : 'built-in'} tool${total === 1 ? '' : 's'} ${f.q || f.type ? 'matching' : 'available'}</p>
      </footer>
    `}
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
      : t.implementation.type === 'mcp'
        ? html`<span class="badge badge--info">mcp</span>`
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

function toolPager(f: { q?: string; type?: string }, tab: Tab, limit: number, offset: number, total: number): SafeHtml {
  const start = Math.min(offset + 1, total);
  const end = Math.min(offset + limit, total);
  const prev = Math.max(0, offset - limit);
  const next = offset + limit;

  const sizes = [12, 24, 48, 100];
  const sizeLinks = sizes.map((s) => {
    const url = toolBuildUrl(f, s, 0, tab);
    return s === limit
      ? html`<a href="${url}" style="font-weight: var(--weight-bold); color: var(--color-text);">${String(s)}</a>`
      : html`<a href="${url}">${String(s)}</a>`;
  });

  return html`
    <div class="pager">
      <div>Showing ${String(start)}\u2013${String(end)} of ${String(total)}</div>
      <div style="display: flex; align-items: center; gap: var(--space-3);">
        <span style="display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-xs); color: var(--color-text-muted);">
          Show: ${sizeLinks as unknown as SafeHtml[]}
        </span>
        <span style="color: var(--color-border);">|</span>
        ${offset > 0 ? html`<a href="${toolBuildUrl(f, limit, prev, tab)}">\u2190 Prev</a>` : html`<span class="dim">\u2190 Prev</span>`}
        ${next < total ? html`<a href="${toolBuildUrl(f, limit, next, tab)}">Next \u2192</a>` : html`<span class="dim">Next \u2192</span>`}
      </div>
    </div>
  `;
}

function toolBuildUrl(f: { q?: string; type?: string }, limit: number, offset: number, tab: Tab): string {
  const params = new URLSearchParams();
  if (tab !== 'user') params.set('tab', tab);
  if (f.q) params.set('q', f.q);
  if (f.type) params.set('type', f.type);
  if (limit !== 12) params.set('limit', String(limit));
  if (offset !== 0) params.set('offset', String(offset));
  const qs = params.toString();
  return qs ? `/tools?${qs}` : '/tools';
}
