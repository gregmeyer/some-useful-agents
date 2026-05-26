import { html, type SafeHtml } from './html.js';

/** The Agents section groups the building blocks + executions. */
export type AgentsSection = 'agents' | 'tools' | 'nodes' | 'runs' | 'packs' | 'scheduled';

/**
 * In-page tab strip for the Agents section, mirroring the Settings shell's
 * `.tab-strip`. Rendered on each section landing page (not on deep detail
 * pages) so switching between Agents / Tools / Nodes / Runs / Packs /
 * Scheduled is a server-rendered click with no global subnav bar.
 */
export function sectionTabs(active: AgentsSection): SafeHtml {
  const tab = (id: AgentsSection, href: string, label: string): SafeHtml => html`
    <a href="${href}" class="${active === id ? 'is-active' : ''}">${label}</a>
  `;
  return html`
    <nav class="tab-strip" aria-label="Agents section">
      ${tab('agents', '/agents', 'Agents')}
      ${tab('tools', '/tools', 'Tools')}
      ${tab('nodes', '/nodes', 'Nodes')}
      ${tab('runs', '/runs', 'Runs')}
      ${tab('packs', '/packs', 'Packs')}
      ${tab('scheduled', '/scheduled', 'Scheduled')}
    </nav>
  `;
}
