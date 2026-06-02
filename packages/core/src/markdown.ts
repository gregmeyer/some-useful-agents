/**
 * Tiny zero-dependency Markdown renderer for inbox/chat message bodies.
 *
 * Scope is deliberately small — the subset agents and operators actually use in
 * conversation: headings, bold/italic, inline + fenced code, links, ordered and
 * unordered lists, blockquotes, horizontal rules, and paragraphs with soft line
 * breaks. It is NOT a CommonMark implementation and does not try to be.
 *
 * SECURITY: this renderer's only job is correctness, NOT safety. The trust
 * boundary is `sanitizeHtml()` (html-sanitizer.ts), which the safe entry point
 * `renderMarkdownSafe()` always applies afterwards. Never feed raw
 * `renderMarkdown()` output to the DOM — go through `renderMarkdownSafe()` (or
 * the dashboard's `mdBody()` helper) so the sanitize step can't be forgotten.
 */

import { sanitizeHtml } from './html-sanitizer.js';

/** Escape text content for HTML body context. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a value destined for a double-quoted attribute. */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

/** Apply link/bold/italic to a NON-code text segment that is already escaped. */
function renderEmphasisAndLinks(escaped: string): string {
  let text = escaped;
  // Links [text](url). The url is attribute-escaped; sanitizeHtml re-validates
  // the href (isSafeUrl) downstream, so this is correctness only.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    return `<a href="${escapeAttr(url)}">${label}</a>`;
  });
  // Bold first so ** isn't half-consumed by the single-* rule.
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_\w])_([^_\s][^_]*?)_/g, '$1<em>$2</em>');
  return text;
}

/**
 * Render inline markup within a single block of text. Inline code spans are
 * isolated first (split, not placeholder) so markers inside them are never
 * reinterpreted and there are no sentinel collisions.
 */
function renderInline(input: string): string {
  // Split keeps the delimiters: odd indices are `code` spans.
  const parts = input.split(/(`[^`]+`)/g);
  return parts
    .map((seg) => {
      if (seg.length >= 2 && seg.startsWith('`') && seg.endsWith('`')) {
        return `<code>${escapeText(seg.slice(1, -1))}</code>`;
      }
      return renderEmphasisAndLinks(escapeText(seg));
    })
    .join('');
}

const HR_RE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL_RE = /^ {0,3}[-*+]\s+(.*)$/;
const OL_RE = /^ {0,3}\d+[.)]\s+(.*)$/;
const BLOCKQUOTE_RE = /^ {0,3}>\s?(.*)$/;

/**
 * Render a Markdown string to an HTML string. NOT sanitized — callers must use
 * `renderMarkdownSafe()` instead unless they sanitize themselves.
 */
export function renderMarkdown(src: string): string {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushParagraph = (): void => {
    if (!para.length) return;
    out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flushParagraph();
      const marker = fence[1][0];
      const closeRe = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{3,}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (if present)
      out.push(`<pre><code>${escapeText(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Blank line ends a paragraph.
    if (/^\s*$/.test(line)) {
      flushParagraph();
      i++;
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      flushParagraph();
      out.push('<hr>');
      i++;
      continue;
    }

    // Heading.
    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote (consecutive `>` lines).
    if (BLOCKQUOTE_RE.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        quoted.push(lines[i].match(BLOCKQUOTE_RE)![1]);
        i++;
      }
      out.push(`<blockquote>${quoted.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }

    // Lists (consecutive items of the same kind).
    const isUl = UL_RE.test(line);
    const isOl = OL_RE.test(line);
    if (isUl || isOl) {
      flushParagraph();
      const tag = isUl ? 'ul' : 'ol';
      const re = isUl ? UL_RE : OL_RE;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].match(re)![1])}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Otherwise: accumulate into the current paragraph.
    para.push(line.trim());
    i++;
  }
  flushParagraph();

  return out.join('\n');
}

/**
 * Safe entry point: render Markdown, then run the result through the
 * project-wide HTML sanitizer (the trust boundary — strips scripts/handlers,
 * drops unsafe URLs, keeps only allowlisted tags). Use this everywhere.
 */
export function renderMarkdownSafe(src: string): string {
  return sanitizeHtml(renderMarkdown(src));
}
