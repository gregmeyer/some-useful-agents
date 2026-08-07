/**
 * Shared types for the web-fetch tool. Kept separate from the retrieval logic
 * so the tool-protocol layer (builtin-tools.ts) and tests import shapes without
 * pulling in the HTTP/DOM/browser machinery.
 */

/** How the content was retrieved. */
export type WebFetchMethod = 'http' | 'browser';

/** `auto` escalates to the browser only when HTTP+extraction yields too little. */
export type BrowserMode = 'auto' | 'never' | 'always';

export interface WebFetchOptions {
  /** Cap on returned `content` characters. Default 30000. */
  maxChars?: number;
  /** Per-attempt network timeout in seconds. Default 20. */
  timeoutSec?: number;
  /** Browser-fallback policy. Default 'auto'. */
  browser?: BrowserMode;
}

/**
 * The predictable result an LLM (or a downstream node) consumes. `content` is
 * clean Markdown/plaintext, never raw HTML. On failure, `content`/`title` are
 * null and `error` is a plain-English explanation — the function never throws.
 */
export interface WebFetchResult {
  url: string;
  title: string | null;
  content: string | null;
  method: WebFetchMethod;
  status: number | null;
  truncated: boolean;
  error: string | null;
}

/** Raw HTML payload from a retrieval level, fed into the extraction pipeline. */
export interface RawPage {
  finalUrl: string;
  status: number;
  html: string;
}

export interface WebScrapeOptions {
  /** Browser render policy. Default 'auto' (render if HTTP yields no JSON-LD). */
  render?: BrowserMode;
  /** Include the raw/rendered HTML in the result (capped). Default false. */
  includeHtml?: boolean;
  /** Cap on returned `html` characters when includeHtml is set. Default 50000. */
  maxHtmlChars?: number;
  /** Per-attempt network timeout in seconds. Default 20. */
  timeoutSec?: number;
}

/**
 * Structured/raw view of a page for machine consumption (vs web-fetch's readable
 * prose). Never thrown — failures set `error` with `json_ld: []`.
 */
export interface WebScrapeResult {
  url: string;
  status: number | null;
  method: WebFetchMethod;
  /** Parsed JSON-LD objects (schema.org: Product, Offer, Article, …). */
  json_ld: unknown[];
  /** `<title>` + og/meta tags as a flat map. */
  meta: Record<string, string>;
  /** Raw/rendered HTML when `includeHtml` was set, else null. */
  html: string | null;
  /** True if `html` was cut to `maxHtmlChars`. */
  truncated: boolean;
  error: string | null;
}
