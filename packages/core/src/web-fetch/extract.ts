/**
 * Level 2: turn raw HTML into clean, LLM-friendly Markdown.
 *
 * Readability isolates the main article (dropping nav/scripts/styles/cookie
 * banners/boilerplate); Turndown converts that to Markdown preserving headings,
 * lists, links, and table cell text. Falls back to collapsed plaintext when
 * Readability finds no article. Output is capped at `maxChars`.
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export interface Extracted {
  title: string | null;
  content: string;
  truncated: boolean;
}

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  // Drop anything that isn't content even if Readability let it through.
  td.remove(['script', 'style', 'noscript', 'iframe', 'form']);
  return td;
}

/** Collapse excess blank lines / trailing whitespace from converted Markdown. */
function tidy(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cap(text: string, maxChars: number): { content: string; truncated: boolean } {
  if (text.length <= maxChars) return { content: text, truncated: false };
  // Prefer cutting on a newline near the limit for readability.
  const slice = text.slice(0, maxChars);
  const nl = slice.lastIndexOf('\n');
  const cut = nl > maxChars * 0.6 ? slice.slice(0, nl) : slice;
  return { content: `${cut.trimEnd()}\n\n…[truncated]`, truncated: true };
}

/**
 * Extract main content from HTML as Markdown. Never throws — returns an empty
 * `content` string when nothing usable is found (the orchestrator decides
 * whether to escalate to the browser).
 */
export function extractContent(html: string, opts: { maxChars: number }): Extracted {
  let title: string | null = null;
  let bodyHtml = '';

  try {
    const { document } = parseHTML(html);
    title = document.querySelector('title')?.textContent?.trim() || null;

    // Readability mutates the document, so parse it on the live doc.
    try {
      const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
      if (article) {
        if (article.title && article.title.trim()) title = article.title.trim();
        if (article.content && article.content.trim()) bodyHtml = article.content;
      }
    } catch { /* fall through to plaintext */ }

    // Fallback: no article — take the raw body text.
    if (!bodyHtml) {
      const bodyText = document.body?.textContent ?? '';
      const collapsed = bodyText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      const { content, truncated } = cap(collapsed, opts.maxChars);
      return { title, content, truncated };
    }
  } catch {
    return { title, content: '', truncated: false };
  }

  let md = '';
  try {
    md = tidy(makeTurndown().turndown(bodyHtml));
  } catch {
    md = '';
  }
  const { content, truncated } = cap(md, opts.maxChars);
  return { title, content, truncated };
}
