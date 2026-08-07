/**
 * web-scrape: the structured/raw counterpart to web-fetch.
 *
 * Where web-fetch returns readable prose, web-scrape returns the machine layer:
 * JSON-LD (`<script type="application/ld+json">` — schema.org Product/Offer/
 * Article/…), page metadata (`<title>`, `og:*`, `<meta>`), and optionally the
 * raw or browser-rendered HTML. Reuses the entire web-fetch HTTP + browser +
 * SSRF stack; adds only the extraction step. Never throws.
 */
import { parseHTML } from 'linkedom';
import { httpFetch, describeWebError } from './fetch.js';
import { renderWithBrowser } from './browser.js';
import type { WebScrapeOptions, WebScrapeResult } from './types.js';

export * from './types.js';

const DEFAULT_MAX_HTML_CHARS = 50000;
const DEFAULT_TIMEOUT_SEC = 20;
/** Defensive caps so a pathological page can't produce a huge result. */
const MAX_JSONLD_BLOCKS = 25;
const MAX_JSONLD_CHARS = 200_000;
const MAX_META_ENTRIES = 80;

interface Extracted {
  json_ld: unknown[];
  meta: Record<string, string>;
  html: string | null;
  truncated: boolean;
}

/**
 * Pull JSON-LD, metadata, and (optionally) capped HTML out of a page. Never
 * throws — a parse failure just yields empty structures.
 */
export function extractStructured(
  html: string,
  opts: { includeHtml?: boolean; maxHtmlChars?: number } = {},
): Extracted {
  const maxHtmlChars = opts.maxHtmlChars ?? DEFAULT_MAX_HTML_CHARS;
  const json_ld: unknown[] = [];
  const meta: Record<string, string> = {};

  try {
    const { document } = parseHTML(html);

    // JSON-LD blocks.
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')) as Array<{ textContent: string | null }>;
    for (const el of scripts) {
      if (json_ld.length >= MAX_JSONLD_BLOCKS) break;
      const raw = (el.textContent ?? '').trim();
      if (!raw || raw.length > MAX_JSONLD_CHARS) continue;
      try {
        const parsed = JSON.parse(raw);
        // Flatten a top-level array of objects; keep @graph objects as-is.
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (json_ld.length >= MAX_JSONLD_BLOCKS) break;
            json_ld.push(item);
          }
        } else {
          json_ld.push(parsed);
        }
      } catch { /* skip unparseable block */ }
    }

    // Metadata: <title> + name/property meta tags.
    const title = document.querySelector('title')?.textContent?.trim();
    if (title) meta.title = title;
    const metas = Array.from(document.querySelectorAll('meta')) as Array<{ getAttribute(name: string): string | null }>;
    for (const el of metas) {
      if (Object.keys(meta).length >= MAX_META_ENTRIES) break;
      const key = el.getAttribute('property') || el.getAttribute('name');
      const content = el.getAttribute('content');
      if (key && content && !(key in meta)) meta[key] = content;
    }
  } catch { /* malformed HTML — return whatever we have */ }

  let outHtml: string | null = null;
  let truncated = false;
  if (opts.includeHtml) {
    if (html.length > maxHtmlChars) {
      outHtml = html.slice(0, maxHtmlChars);
      truncated = true;
    } else {
      outHtml = html;
    }
  }

  return { json_ld, meta, html: outHtml, truncated };
}

const base = (url: string): WebScrapeResult => ({
  url, status: null, method: 'http', json_ld: [], meta: {}, html: null, truncated: false, error: null,
});

export async function webScrape(url: string, opts: WebScrapeOptions = {}): Promise<WebScrapeResult> {
  const render = opts.render ?? 'auto';
  const includeHtml = opts.includeHtml ?? false;
  const maxHtmlChars = opts.maxHtmlChars ?? DEFAULT_MAX_HTML_CHARS;
  const timeoutSec = opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC;

  // Level 1: HTTP (skipped when render:'always').
  let httpResult: WebScrapeResult | null = null;
  let httpErr: { error: string; status: number | null } | null = null;
  if (render !== 'always') {
    try {
      const raw = await httpFetch(url, { timeoutSec });
      const ex = extractStructured(raw.html, { includeHtml, maxHtmlChars });
      httpResult = {
        url: raw.finalUrl,
        status: raw.status,
        method: 'http',
        json_ld: ex.json_ld,
        meta: ex.meta,
        html: ex.html,
        truncated: ex.truncated,
        error: null,
      };
    } catch (err) {
      httpErr = describeWebError(err);
    }
  }

  // Level 2: render when forced, or (auto) when HTTP gave no JSON-LD or failed —
  // SPAs commonly inject JSON-LD via JavaScript.
  const wantBrowser = render === 'always' || (render === 'auto' && (!httpResult || httpResult.json_ld.length === 0));
  if (wantBrowser) {
    const rendered = await renderWithBrowser(url, { timeoutSec: timeoutSec + 10 });
    if (rendered.available) {
      const ex = extractStructured(rendered.html, { includeHtml, maxHtmlChars });
      return {
        url: rendered.finalUrl,
        status: rendered.status,
        method: 'browser',
        json_ld: ex.json_ld,
        meta: ex.meta,
        html: ex.html,
        truncated: ex.truncated,
        error: null,
      };
    }
    // Browser unavailable — keep the HTTP result if we got one; else the error.
    if (httpResult) return httpResult;
    return { ...base(url), error: httpErr?.error ?? rendered.reason, status: httpErr?.status ?? null };
  }

  if (httpResult) return httpResult;
  return { ...base(url), error: httpErr?.error ?? 'The page could not be retrieved.', status: httpErr?.status ?? null };
}
