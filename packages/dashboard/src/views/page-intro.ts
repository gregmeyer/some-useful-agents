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

import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface PageIntroOptions {
  /** Stable key for localStorage dismissal, e.g. 'pulse', 'home', 'integrations'. */
  key: string;
  /** One-line explanation of what the page is for. */
  text: string;
  /** Optional link to the matching guide. */
  learnMore?: { href: string; label?: string };
  /**
   * Optional next steps, rendered as buttons after the text.
   *
   * The home page needed these: it is the only page a newcomer is guaranteed
   * to see, and it had no route to `/start` or the tutorial anywhere in its
   * body — the nearest door was three clicks away via Help. Putting them in
   * the intro means they disappear once dismissed, which is the right
   * lifetime for onboarding.
   */
  actions?: Array<{ href: string; label: string; primary?: boolean }>;
}

export function pageIntro(opts: PageIntroOptions): SafeHtml {
  // Only send the reader away from the app for an off-site link. This used to
  // force target=_blank unconditionally, which was right for the one caller
  // (a GitHub docs URL) and wrong for an in-product link like /help.
  const external = /^https?:/i.test(opts.learnMore?.href ?? '');
  const link = opts.learnMore
    ? html`<a class="page-intro__link" href="${opts.learnMore.href}"${external ? unsafeHtml(' target="_blank" rel="noopener"') : html``}>${opts.learnMore.label ?? 'Learn more'} →</a>`
    : html``;
  const actions = (opts.actions ?? []).map((a) => html`
    <a class="btn btn--sm ${a.primary ? 'btn--primary' : 'btn--ghost'}" href="${a.href}">${a.label}</a>
  `);
  return html`
    <div class="page-intro" data-intro-key="${opts.key}">
      <span class="page-intro__text">${opts.text}</span>
      ${link}
      ${actions.length > 0
        ? html`<span class="page-intro__actions">${actions as unknown as SafeHtml[]}</span>`
        : html``}
      <button type="button" class="page-intro__dismiss" data-intro-dismiss aria-label="Dismiss this hint">Got it</button>
    </div>
  `;
}
