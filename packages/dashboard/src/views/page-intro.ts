/**
 * Compact, dismissible "what is this page" intro.
 *
 * Renders one line of context under a page title with an optional docs link
 * and a "Got it" button. Dismissal persists per-key in localStorage (wired by
 * PAGE_INTRO_JS), so daily users dismiss once and never see it again. Without
 * JS the intro simply stays visible — progressive enhancement, not required.
 *
 * Keep the copy to a single sentence: DESIGN.md says typography and whitespace
 * do the work, so this is a quiet hint, not a banner.
 */

import { html, type SafeHtml } from './html.js';

export interface PageIntroOptions {
  /** Stable key for localStorage dismissal, e.g. 'pulse', 'home', 'integrations'. */
  key: string;
  /** One-line explanation of what the page is for. */
  text: string;
  /** Optional link to the matching guide. */
  learnMore?: { href: string; label?: string };
}

export function pageIntro(opts: PageIntroOptions): SafeHtml {
  const link = opts.learnMore
    ? html`<a class="page-intro__link" href="${opts.learnMore.href}" target="_blank" rel="noopener">${opts.learnMore.label ?? 'Learn more'} →</a>`
    : html``;
  return html`
    <div class="page-intro" data-intro-key="${opts.key}">
      <span class="page-intro__text">${opts.text}</span>
      ${link}
      <button type="button" class="page-intro__dismiss" data-intro-dismiss aria-label="Dismiss this hint">Got it</button>
    </div>
  `;
}
