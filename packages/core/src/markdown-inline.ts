/**
 * Inline Markdown (code spans, [links](url), **bold**, *em* / _em_) for one
 * run of text, escaped first: the only tags it makes are a, strong, em and
 * code. Shared by the Markdown renderer and template placeholders
 * (substitutePlaceholders). Correctness only: callers run sanitizeHtml after,
 * which re-checks every href. No imports, so the sanitizer can use it.
 */

/** Escape text content for HTML body context. */
export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a value destined for a double-quoted attribute. */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

/** Apply link/bold/italic to a NON-code text segment that is already escaped. */
function renderEmphasisAndLinks(escaped: string, newTab: boolean): string {
  // Each link's attributes are set aside while emphasis runs, so an href (or target="_blank") with _ or * in it stays whole.
  const hrefs: string[] = [];
  let text = escaped.replace(/\u0000/g, '');
  // Links [text](url). The url is attribute-escaped; sanitizeHtml re-validates
  // the href (isSafeUrl) downstream, so this is correctness only.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    hrefs.push(`href="${escapeAttr(url)}"${newTab ? ' target="_blank" rel="noopener"' : ''}`);
    return `<a \u0000${hrefs.length - 1}\u0000>${label}</a>`;
  });
  // Bold first so ** isn't half-consumed by the single-* rule.
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_\w])_([^_\s][^_]*?)_/g, '$1<em>$2</em>');
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => hrefs[Number(i)]);
}

/**
 * Render inline markup within a single block of text. Inline code spans are
 * isolated first (split, not placeholder) so markers inside them are never
 * reinterpreted and there are no sentinel collisions.
 */
export function renderInlineMarkdown(input: string, opts: { newTab?: boolean } = {}): string {
  // Split keeps the delimiters: odd indices are `code` spans.
  const parts = input.split(/(`[^`]+`)/g);
  return parts
    .map((seg) => {
      if (seg.length >= 2 && seg.startsWith('`') && seg.endsWith('`')) {
        return `<code>${escapeText(seg.slice(1, -1))}</code>`;
      }
      return renderEmphasisAndLinks(escapeText(seg), !!opts.newTab);
    })
    .join('');
}
