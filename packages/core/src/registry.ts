/**
 * Helpers for fetching agent YAML over HTTPS for `sua agent install`.
 *
 *  - `normalizeAgentUrl`  rewrites human-friendly GitHub `/blob/` and gist URLs
 *    into raw-text URLs the fetcher can stream.
 *  - `fetchYaml`         fetches with a hard size cap and a request timeout.
 *
 * Networking is intentionally minimal: built-in `fetch`, no extra deps.
 * Callers MUST pass the URL through `assertSafeUrl` (from core) before
 * calling `fetchYaml` — this module does not perform SSRF checks.
 */

export const DEFAULT_MAX_BYTES = 256 * 1024;       // 256 KB
export const DEFAULT_TIMEOUT_MS = 10_000;          // 10 s

export interface FetchYamlOptions {
  /** Optional Authorization header value, e.g. "Bearer ghp_..." or just a token. */
  authHeader?: string;
  /** Hard cap on response size in bytes. Default 256 KB. */
  maxBytes?: number;
  /** Abort the fetch after this many ms. Default 10_000. */
  timeoutMs?: number;
  /** Test seam — substitute the global fetch implementation. */
  fetchImpl?: typeof fetch;
}

/**
 * Map a human-paste URL (GitHub repo file, gist, plain HTTPS) to a raw-text URL.
 * Pure function. Throws on unsupported / malformed URLs.
 */
export function normalizeAgentUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol} (expected http/https)`);
  }

  // GitHub blob URL: https://github.com/<owner>/<repo>/blob/<branch>/<path...>
  if (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    // [owner, repo, 'blob', branch, ...path]
    if (segments.length >= 5 && segments[2] === 'blob') {
      const [owner, repo, , branch, ...path] = segments;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.join('/')}`;
    }
    // GitHub raw via /raw/<branch>/<path> also exists; pass through to raw host.
    if (segments.length >= 5 && segments[2] === 'raw') {
      const [owner, repo, , branch, ...path] = segments;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.join('/')}`;
    }
    throw new Error(
      `GitHub URL must point at a file (use the /blob/<branch>/<path> form): ${rawUrl}`,
    );
  }

  // Gist: https://gist.github.com/<user>/<id>           → /<user>/<id>/raw
  // Gist: https://gist.github.com/<user>/<id>/raw       → keep
  // Gist: https://gist.githubusercontent.com/...        → keep
  if (parsed.hostname === 'gist.github.com') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 2) {
      // Already ends in /raw or /raw/<rev>/<file>: keep as-is.
      if (segments.includes('raw')) return parsed.toString();
      const [user, id] = segments;
      return `https://gist.githubusercontent.com/${user}/${id}/raw`;
    }
    throw new Error(`Gist URL is missing user/id segments: ${rawUrl}`);
  }

  // Plain HTTPS / raw URLs pass through unchanged.
  return parsed.toString();
}

export interface FetchYamlResult {
  text: string;
  /** The URL actually fetched (after normalization). */
  url: string;
  /** Bytes read off the wire. */
  bytes: number;
}

/**
 * Fetch a YAML document with a hard size cap and a timeout. Throws on
 * non-2xx, oversize, or timeout. Does not validate content — the caller
 * pipes `text` into `parseAgent`.
 *
 * The function reads the response stream incrementally and aborts as soon
 * as the byte budget is exceeded; we don't allocate a multi-megabyte
 * buffer just to reject it.
 */
export async function fetchYaml(
  url: string,
  options: FetchYamlOptions = {},
): Promise<FetchYamlResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { Accept: 'text/yaml, text/plain, */*' };
  if (options.authHeader) headers.Authorization = options.authHeader;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const e = err as Error;
    if (e.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new Error(`Fetch failed: ${e.message}`);
  }

  if (!response.ok) {
    clearTimeout(timer);
    throw new Error(`Fetch failed: ${response.status} ${response.statusText} for ${url}`);
  }

  // Cheap pre-check: if Content-Length is present and over budget, bail before reading.
  const cl = response.headers.get('content-length');
  if (cl) {
    const declared = Number(cl);
    if (Number.isFinite(declared) && declared > maxBytes) {
      clearTimeout(timer);
      throw new Error(
        `Response size ${declared} exceeds ${maxBytes} byte cap for ${url}`,
      );
    }
  }

  // Stream-read so we don't buffer huge bodies before checking size.
  const body = response.body;
  if (!body) {
    clearTimeout(timer);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
      throw new Error(`Response size exceeds ${maxBytes} byte cap for ${url}`);
    }
    return { text, url, bytes: Buffer.byteLength(text, 'utf-8') };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* best-effort */ }
        throw new Error(`Response exceeds ${maxBytes} byte cap for ${url}`);
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }

  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buf.toString('utf-8'), url, bytes: total };
}
