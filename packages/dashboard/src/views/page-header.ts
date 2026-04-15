import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface PageHeaderBack {
  /** Where the back link goes (relative URL on this dashboard). */
  href: string;
  /** Display label, e.g. "Back to runs" or "Back to demo-digest". */
  label: string;
}

export interface PageHeaderOptions {
  title: string;
  /** Badges rendered next to the title (status, source, type, etc.). */
  meta?: SafeHtml[];
  /** Primary call-to-action anchored to the right of the header row. */
  cta?: SafeHtml;
  /** Optional full-width description below the title row. */
  description?: string;
  /** Contextual back link rendered above the title. */
  back?: PageHeaderBack;
}

/**
 * Consistent header for every detail screen. The primary CTA is
 * right-aligned so the user's eye always finds the main action in the
 * same place regardless of screen. An optional contextual back link
 * sits above the title — derived from the request's Referer header by
 * the caller, so it labels the actual page the user came from.
 */
export function pageHeader(opts: PageHeaderOptions): SafeHtml {
  const backBlock = opts.back
    ? html`<a class="page-header__back" href="${opts.back.href}">\u2190 ${opts.back.label}</a>`
    : unsafeHtml('');
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
      ${backBlock}
      <h1>${opts.title}</h1>
      ${metaBlock}
      ${ctaBlock}
      ${descBlock}
    </header>
  `;
}

/**
 * Pattern-match a Referer URL to a labeled back-link, optionally
 * overridden by an explicit `from` query param.
 *
 * `fromParam` is a lightweight way to carry context across multiple
 * hops (e.g. tutorial → agent detail → run-now → run detail). The
 * Referer header only remembers the immediate predecessor; a
 * `?from=tutorial` param, propagated through POST redirects, carries
 * the originating page through N hops.
 *
 * Accepted `fromParam` values:
 *   - 'tutorial' → Back to tutorial
 *   - 'runs'     → Back to runs
 *   - 'agents'   → Back to agents
 * Unknown values fall back to Referer-based detection.
 *
 * Usage:
 *   const back = deriveBack(req.headers.referer, expectedHost, req.query.from);
 *   pageHeader({ title, back, ... });
 */
export function deriveBack(
  referer: string | undefined,
  expectedHost: string | undefined,
  fromParam?: unknown,
): PageHeaderBack | undefined {
  // Explicit overrides take precedence over Referer. They're set by
  // callers who know they originated from a specific place.
  if (typeof fromParam === 'string') {
    if (fromParam === 'tutorial') return { href: '/help/tutorial', label: 'Back to tutorial' };
    if (fromParam === 'runs') return { href: '/runs', label: 'Back to runs' };
    if (fromParam === 'agents') return { href: '/agents', label: 'Back to agents' };
  }

  if (!referer || !expectedHost) return undefined;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return undefined;
  }
  if (url.host !== expectedHost) return undefined;

  const path = url.pathname;
  if (path === '/' || path === '/agents') return { href: '/agents', label: 'Back to agents' };
  if (path === '/runs') return { href: '/runs' + (url.search || ''), label: 'Back to runs' };
  if (path.startsWith('/runs/')) return { href: path, label: 'Back to that run' };
  if (path === '/help') return { href: '/help', label: 'Back to help' };
  if (path === '/help/tutorial') return { href: '/help/tutorial', label: 'Back to tutorial' };
  if (path.startsWith('/settings')) return { href: path, label: 'Back to settings' };
  // /agents/<id> — best-effort label using the path slug.
  const agentMatch = path.match(/^\/agents\/([a-z0-9][a-z0-9-]*)$/);
  if (agentMatch) return { href: path, label: `Back to ${agentMatch[1]}` };
  // /agents/<id>/add-node etc. — generic.
  if (path.startsWith('/agents/')) return { href: path, label: 'Back' };
  return undefined;
}
