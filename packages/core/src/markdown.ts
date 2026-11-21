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

import { escapeText, renderInlineMarkdown } from './markdown-inline.js';

const renderInline = (s: string): string => renderInlineMarkdown(s);

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

/**
 * Reduce Markdown to clean, single-line plain text — for list previews and
 * other one-line snippets where rendered markup would be noise. Unwraps links
 * to their label, drops emphasis/code/heading/list/quote markers, and collapses
 * all whitespace (including newlines) to single spaces. NOT for HTML output —
 * use `renderMarkdownSafe` there. Correctness only; the caller's `html\`\``
 * template escapes the result on interpolation.
 */
export function markdownToText(src: string): string {
  if (!src) return '';
  let s = src;
  // Inline + fenced code: keep the contents, drop the backticks.
  s = s.replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1'); // fenced
  s = s.replace(/`([^`]+)`/g, '$1');                  // inline
  // Links + images: keep the visible label, drop the target.
  s = s.replace(/!?\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1');
  // Bold / italic / underscore emphasis markers (run twice for ** then *).
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2');
  s = s.replace(/(\*|_)(.*?)\1/g, '$2');
  // Line-leading block markers: headings, list bullets, ordered numbers,
  // blockquotes. Applied per line before whitespace collapse.
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');         // headings
  s = s.replace(/^[ \t]*>[ \t]?/gm, '');              // blockquote
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, '');          // unordered list
  s = s.replace(/^[ \t]*\d+[.)][ \t]+/gm, '');        // ordered list
  s = s.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, ''); // hr lines
  // Collapse all whitespace/newlines to single spaces.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
