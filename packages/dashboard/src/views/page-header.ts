import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface PageHeaderOptions {
  title: string;
  /** Badges rendered next to the title (status, source, type, etc.). */
  meta?: SafeHtml[];
  /** Primary call-to-action anchored to the right of the header row. */
  cta?: SafeHtml;
  /** Optional full-width description below the title row. */
  description?: string;
}

/**
 * Consistent header for every detail screen. The primary CTA is
 * right-aligned so the user's eye always finds the main action in the
 * same place regardless of screen.
 */
export function pageHeader(opts: PageHeaderOptions): SafeHtml {
  const metaBlock = opts.meta && opts.meta.length > 0
    ? html`<div class="page-header__meta">${opts.meta as unknown as SafeHtml[]}</div>`
    : unsafeHtml('');
  const ctaBlock = opts.cta
    ? html`<div class="page-header__cta">${opts.cta}</div>`
    : unsafeHtml('');
  const descBlock = opts.description
    ? html`<p class="page-header__description">${opts.description}</p>`
    : unsafeHtml('');

  return html`
    <header class="page-header">
      <h1>${opts.title}</h1>
      ${metaBlock}
      ${ctaBlock}
      ${descBlock}
    </header>
  `;
}
