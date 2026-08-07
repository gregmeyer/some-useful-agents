/**
 * web-fetch: free, local web retrieval optimized for LLM consumption.
 *
 * Progressive escalation: (1) HTTP via native fetch → (2) Readability+Turndown
 * extraction to clean Markdown → (3) optional headless-browser render for
 * JS-dependent pages. Returns a predictable `WebFetchResult` and NEVER throws —
 * every failure is a plain-English `error` a small model can reason about.
 *
 * The core function is independent of the tool/LLM protocol; builtin-tools.ts
 * wraps it as the `web-fetch` builtin.
 */
import { httpFetch, WebFetchError } from './fetch.js';
import { extractContent } from './extract.js';
import { renderWithBrowser } from './browser.js';
import type { WebFetchOptions, WebFetchResult } from './types.js';

export * from './types.js';
export { WebFetchError } from './fetch.js';

/** Below this many chars of extracted text, `auto` escalates to the browser. */
const MIN_USEFUL_CHARS = 200;
const DEFAULT_MAX_CHARS = 30000;
const DEFAULT_TIMEOUT_SEC = 20;

/** Map a tagged retrieval error to a human sentence + status for the result. */
function mapError(err: unknown): { error: string; status: number | null } {
  if (!(err instanceof WebFetchError)) {
    return { error: 'The page could not be retrieved.', status: null };
  }
  switch (err.kind) {
    case 'invalid_url': return { error: 'The URL is not valid.', status: null };
    case 'blocked': return { error: 'Blocked for safety: the URL points to a private or disallowed address.', status: null };
    case 'dns': return { error: "The site's domain could not be resolved.", status: null };
    case 'content_type': return { error: 'The URL is not a readable web page (unsupported content type).', status: err.status };
    case 'timeout': return { error: 'The request timed out.', status: null };
    case 'too_many_redirects': return { error: 'The page redirected too many times.', status: null };
    case 'network': return { error: 'The page could not be retrieved (network error).', status: null };
    case 'empty': return { error: 'The page had no readable content.', status: err.status };
    case 'http_status': {
      const s = err.status;
      if (s === 403) return { error: 'The server denied access to this page.', status: s };
      if (s === 404) return { error: 'The page was not found.', status: s };
      if (s === 401) return { error: 'The page requires authentication.', status: s };
      if (s === 429) return { error: 'The server is rate-limiting requests; try again later.', status: s };
      if (s && s >= 500) return { error: 'The server returned an error.', status: s };
      return { error: `The server returned HTTP ${s}.`, status: s };
    }
    default: return { error: 'The page could not be retrieved.', status: null };
  }
}

const base = (url: string): WebFetchResult => ({
  url, title: null, content: null, method: 'http', status: null, truncated: false, error: null,
});

export async function webFetch(url: string, opts: WebFetchOptions = {}): Promise<WebFetchResult> {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const timeoutSec = opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  const browser = opts.browser ?? 'auto';

  // Level 1 + 2: HTTP + extraction (skipped when browser:'always').
  let httpResult: WebFetchResult | null = null;
  let httpErr: { error: string; status: number | null } | null = null;
  if (browser !== 'always') {
    try {
      const raw = await httpFetch(url, { timeoutSec });
      const ex = extractContent(raw.html, { maxChars });
      const hasContent = ex.content.trim().length > 0;
      httpResult = {
        url: raw.finalUrl,
        title: ex.title,
        content: hasContent ? ex.content : null,
        method: 'http',
        status: raw.status,
        truncated: ex.truncated,
        error: hasContent ? null : 'No readable content could be extracted from the page.',
      };
    } catch (err) {
      httpErr = mapError(err);
    }
  }

  const usableHttp = httpResult && httpResult.content && httpResult.content.trim().length >= MIN_USEFUL_CHARS;

  // Level 3: escalate to the browser when asked, or on thin/failed HTTP under
  // 'auto'. ('never' can't satisfy either clause, so it's excluded here.)
  const wantBrowser = browser === 'always' || (browser === 'auto' && !usableHttp);
  if (wantBrowser) {
    const rendered = await renderWithBrowser(url, { timeoutSec: timeoutSec + 10 });
    if (rendered.available) {
      const ex = extractContent(rendered.html, { maxChars });
      const hasContent = ex.content.trim().length > 0;
      return {
        url: rendered.finalUrl,
        title: ex.title,
        content: hasContent ? ex.content : null,
        method: 'browser',
        status: rendered.status,
        truncated: ex.truncated,
        error: hasContent ? null : 'No readable content could be extracted from the page (browser render).',
      };
    }
    // Browser unavailable — keep the HTTP result if we got one; else surface the error.
    if (httpResult) return httpResult;
    return { ...base(url), error: httpErr?.error ?? rendered.reason, status: httpErr?.status ?? null };
  }

  if (httpResult) return httpResult;
  return { ...base(url), error: httpErr?.error ?? 'The page could not be retrieved.', status: httpErr?.status ?? null };
}
