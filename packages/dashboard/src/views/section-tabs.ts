import { html, type SafeHtml } from './html.js';

/** The Agents section groups the building blocks + executions + scheduling. */
export type AgentsSection = 'start' | 'agents' | 'behaviors' | 'skills' | 'tools' | 'runs' | 'packs' | 'scheduled';

/**
 * In-page tab strip for the Agents section, mirroring the Settings shell's
 * `.tab-strip`. Rendered on each section landing page (not on deep detail
 * pages) so switching between Agents / Tools / Runs / Packs / Scheduled is a
 * server-rendered click with no global subnav bar.
 *
 * Scheduled used to be a top-level nav entry; moved into this sub-nav
 * once Inbox became the primary "needs your attention" surface and the
 * top bar got rebalanced around it.
 *
 * Nodes left this strip in ADR-0034: it is reference documentation about how
 * agents are built, not a resource you manage, and nothing in the product
 * linked to it. It now lives under Help.
 */
export function sectionTabs(active: AgentsSection): SafeHtml {
  const tab = (id: AgentsSection, href: string, label: string): SafeHtml => html`
    <a href="${href}" class="${active === id ? 'is-active' : ''}">${label}</a>
  `;
  // Agents, Runs and Scheduled are what you open most; the building blocks are under More (it shows which one you're on).
  const more: Array<[AgentsSection, string, string]> = [['start', '/start', 'Start here'], ['behaviors', '/behaviors', 'Behaviors'], ['skills', '/skills', 'Skills'], ['tools', '/tools', 'Tools'], ['packs', '/packs', 'Packs']];
  const on = more.find(([id]) => id === active);
  return html`
    <nav class="tab-strip" aria-label="Agents section">
      ${tab('agents', '/agents', 'Agents')}
      ${tab('runs', '/runs', 'Runs')}
      ${tab('scheduled', '/scheduled', 'Scheduled')}
      <details class="tab-strip__more" data-tab-more>
        <summary class="${on ? 'is-active' : ''}">${on ? on[2] : 'More'}</summary>
        <div class="tab-strip__more-panel">${more.map(([id, href, label]) => tab(id, href, label)) as unknown as SafeHtml[]}</div>
      </details>
    </nav>
  `;
}
