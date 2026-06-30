/**
 * "What is this page" help as an ⓘ trigger + lightbox modal.
 *
 * Renders a small ⓘ button (placed next to a page/board heading) plus a hidden
 * centered lightbox holding one line of context and an optional docs link. On
 * first visit the lightbox auto-opens; "Got it" / backdrop / Escape dismiss it
 * and persist per-key in localStorage (wired by PAGE_INTRO_JS), so daily users
 * see it once. After that the ⓘ reopens it on demand. Without JS nothing pops —
 * progressive enhancement; the page is fully usable, the hint is just help.
 *
 * Keep the copy to a sentence or two: DESIGN.md says typography and whitespace
 * do the work, so this is a quiet aside, not a banner.
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
    <button type="button" class="page-intro__trigger" data-intro-open="${opts.key}" aria-label="About this page" title="About this page">ⓘ</button>
    <div class="modal-backdrop page-intro-modal" data-intro-key="${opts.key}" role="dialog" aria-modal="true" aria-label="About this page">
      <div class="modal page-intro-modal__panel">
        <p class="page-intro-modal__eyebrow section-label">About this page</p>
        <p class="page-intro-modal__text">${opts.text}</p>
        <div class="modal__actions">
          ${link}
          <button type="button" class="btn btn--sm btn--primary" data-intro-dismiss>Got it</button>
        </div>
      </div>
    </div>
  `;
}
