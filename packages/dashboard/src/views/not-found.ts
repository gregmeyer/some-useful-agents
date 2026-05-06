/**
 * Styled 404 page. Replaces the bare `<p>Not found</p>` responses that
 * had accumulated across routes. Wraps the standard layout (with topbar,
 * theme toggle, etc.) so a missed URL still feels like part of the
 * dashboard rather than a raw HTML scrap.
 */

import { html, render } from './html.js';
import { layout } from './layout.js';

export interface RenderNotFoundInput {
  /** The path the user tried to reach (HTML-escaped before render). */
  path?: string;
  /**
   * Short context string shown above the suggestions. Lets specific
   * routes tailor the message ("No dashboard with id…", "Agent not
   * found", etc.) while still using the same chrome.
   */
  message?: string;
}

const SUGGESTIONS: Array<{ href: string; label: string; hint: string }> = [
  { href: '/agents', label: 'Agents', hint: 'Browse and run agents' },
  { href: '/pulse', label: 'Pulse', hint: 'Live signal tiles' },
  { href: '/packs', label: 'Packs', hint: 'Install curated dashboards' },
  { href: '/runs', label: 'Runs', hint: 'Recent executions' },
];

export function renderNotFoundPage(input: RenderNotFoundInput = {}): string {
  const path = input.path ?? '';
  const message = input.message ?? 'The page you tried to reach doesn’t exist.';

  const body = html`
    <div style="max-width: 560px; margin: var(--space-6) auto; padding: var(--space-4);">
      <div style="font-size: 4rem; font-weight: var(--weight-bold); line-height: 1; margin-bottom: var(--space-3); color: var(--color-text-muted);">404</div>
      <h1 style="margin: 0 0 var(--space-3) 0; font-size: var(--font-size-lg);">${message}</h1>
      ${path ? html`<p class="dim" style="margin: 0 0 var(--space-4) 0; font-family: var(--font-mono); font-size: var(--font-size-sm); word-break: break-all;">${path}</p>` : html``}

      <div style="display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-5);">
        ${SUGGESTIONS.map((s) => html`
          <a href="${s.href}" class="card" style="display: flex; align-items: baseline; gap: var(--space-3); padding: var(--space-3); text-decoration: none; color: inherit;">
            <span style="font-weight: var(--weight-semibold);">${s.label}</span>
            <span class="dim" style="font-size: var(--font-size-sm);">${s.hint}</span>
          </a>
        `) as unknown as import('./html.js').SafeHtml[]}
      </div>
    </div>
  `;

  return render(layout({ title: 'Not found' }, body));
}
