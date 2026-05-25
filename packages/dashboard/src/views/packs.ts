import type { Pack } from '@some-useful-agents/core';
import { html, render } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { sectionTabs } from './section-tabs.js';

/**
 * Render `/packs` — the browse-all-packs page. Cards split into two
 * sections: installed first, then available. Empty-state when nothing
 * is registered (the daemon hasn't found any built-in packs yet).
 */
export function renderPacksList(args: { packs: Pack[]; flash?: { kind: 'ok' | 'error' | 'info'; message: string } }): string {
  const installed = args.packs.filter((p) => p.installedAt !== null);
  const available = args.packs.filter((p) => p.installedAt === null);

  const card = (p: Pack) => {
    const dashboardCount = p.manifest.dashboards?.length ?? 0;
    const agentCount = p.manifest.agents?.length ?? 0;
    const stateBadge = p.installedAt
      ? html`<span class="badge badge--ok">Installed</span>`
      : html`<span class="badge dim">Available</span>`;
    return html`
      <a href="/packs/${encodeURIComponent(p.id)}" class="card" style="display: flex; flex-direction: column; gap: var(--space-2); text-decoration: none; color: inherit;">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2);">
          <h3 style="margin: 0; font-size: var(--font-size-md); font-weight: var(--weight-semibold);">${p.name}</h3>
          ${stateBadge}
        </div>
        ${p.description
          ? html`<p style="margin: 0; color: var(--color-text-muted); font-size: var(--font-size-sm); line-height: 1.4;">${p.description}</p>`
          : html``}
        <div style="display: flex; gap: var(--space-3); font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: auto;">
          <span>v${p.version}</span>
          <span>${String(dashboardCount)} dashboard${dashboardCount === 1 ? '' : 's'}</span>
          <span>${String(agentCount)} agent${agentCount === 1 ? '' : 's'}</span>
          <span class="dim" style="margin-left: auto;">${p.source}</span>
        </div>
      </a>
    `;
  };

  const section = (title: string, packs: Pack[]) => {
    if (!packs.length) return html``;
    return html`
      <section style="margin-bottom: var(--space-5);">
        <h2 style="margin: 0 0 var(--space-3) 0; font-size: var(--font-size-md); font-weight: var(--weight-semibold);">${title} <span class="dim">(${String(packs.length)})</span></h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3);">
          ${packs.map(card)}
        </div>
      </section>
    `;
  };

  const empty = args.packs.length === 0
    ? html`<p class="dim" style="padding: var(--space-4); text-align: center;">No packs registered yet. Built-in packs are loaded from <code>packages/core/packs/*.yaml</code> on daemon start.</p>`
    : html``;

  const body = html`
    ${pageHeader({
      title: 'Packs',
      description: 'Curated bundles of agents and dashboards. Install a pack to register its dashboards and contributed agents in one step.',
    })}
    ${sectionTabs('packs')}
    ${section('Installed', installed)}
    ${section('Available', available)}
    ${empty}
  `;

  return render(layout({ title: 'Packs', activeNav: 'packs' as 'packs', flash: args.flash }, body));
}

/**
 * Render `/packs/:id` — pack detail. Shows manifest contents and the
 * Install or Uninstall action depending on current state.
 */
export function renderPackDetail(args: { pack: Pack; flash?: { kind: 'ok' | 'error' | 'info'; message: string } }): string {
  const p = args.pack;
  const installed = p.installedAt !== null;
  const installedAt = p.installedAt ? new Date(p.installedAt).toISOString() : null;

  const actionForm = installed
    ? html`
        <form method="POST" action="/packs/${encodeURIComponent(p.id)}/uninstall" style="display: inline;">
          <button type="submit" class="btn btn--ghost">Uninstall</button>
        </form>
      `
    : html`
        <form method="POST" action="/packs/${encodeURIComponent(p.id)}/install" style="display: inline;">
          <button type="submit" class="btn btn--primary">Install</button>
        </form>
      `;

  const dashboardsBlock = p.manifest.dashboards?.length
    ? html`
        <section style="margin-top: var(--space-4);">
          <h2 style="margin: 0 0 var(--space-2) 0; font-size: var(--font-size-md); font-weight: var(--weight-semibold);">Dashboards</h2>
          <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2);">
            ${p.manifest.dashboards.map((d) => {
              const sectionLabels = d.sections.map((s) => `${s.title} (${s.agentIds.length})`).join(' · ');
              return html`
                <li class="card" style="padding: var(--space-3);">
                  <div style="font-weight: var(--weight-semibold);">${d.name}</div>
                  <div class="dim" style="font-size: var(--font-size-sm);">${sectionLabels}</div>
                </li>
              `;
            })}
          </ul>
        </section>
      `
    : html``;

  const agentsBlock = p.manifest.agents?.length
    ? html`
        <section style="margin-top: var(--space-4);">
          <h2 style="margin: 0 0 var(--space-2) 0; font-size: var(--font-size-md); font-weight: var(--weight-semibold);">Agents</h2>
          <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-2);">
            ${p.manifest.agents.map((a) => html`<li><code style="background: var(--color-surface-raised); padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm);">${a.id}</code></li>`)}
          </ul>
          <p class="dim" style="font-size: var(--font-size-sm); margin: var(--space-2) 0 0 0;">Install creates any agents not already present (reference-only — uninstall keeps them).</p>
        </section>
      `
    : html``;

  const body = html`
    ${pageHeader({
      title: p.name,
      back: { href: '/packs', label: 'Back to packs' },
      description: p.description ?? undefined,
    })}
    <div class="card" style="display: flex; flex-direction: column; gap: var(--space-3);">
      <div style="display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: baseline;">
        ${installed
          ? html`<span class="badge badge--ok">Installed${installedAt ? html` · ${installedAt}` : html``}</span>`
          : html`<span class="badge dim">Available</span>`}
        <span class="dim" style="font-size: var(--font-size-sm);">v${p.version}</span>
        <span class="dim" style="font-size: var(--font-size-sm);">source: ${p.source}</span>
        ${p.author ? html`<span class="dim" style="font-size: var(--font-size-sm);">by ${p.author}</span>` : html``}
        <div style="margin-left: auto;">${actionForm}</div>
      </div>
    </div>
    ${dashboardsBlock}
    ${agentsBlock}
  `;

  return render(layout({ title: `${p.name} · Packs`, activeNav: 'packs' as 'packs', flash: args.flash }, body));
}
