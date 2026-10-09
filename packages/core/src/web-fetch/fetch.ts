/**
 * Level 1: plain HTTP retrieval via native fetch (Node 22 / undici).
 *
 * Hardened beyond the `http-get` builtin: redirects are followed MANUALLY so
 * every hop is re-validated with `assertSafeUrl` (closing the redirect-SSRF
 * gap), the body is read with a hard byte cap so a pathological page can't
 * exhaust memory, only text-ish content types are accepted, and a browser-like
 * User-Agent is sent. Failures throw a tagged `WebFetchError` the orchestrator
 * maps to a structured result.
 */
import { assertSafeUrl } from '../builtin-tools.js';
import type { RawPage } from './types.js';

const DEFAULT_TIMEOUT_SEC = 20;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type WebFetchErrorKind =
  | 'invalid_url' | 'blocked' | 'dns' | 'http_status'
  | 'content_type' | 'timeout' | 'too_many_redirects' | 'network' | 'empty';

export class WebFetchError extends Error {
  kind: WebFetchErrorKind;
  status: number | null;
  constructor(kind: WebFetchErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'WebFetchError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Map a tagged retrieval error to a human sentence + status for a tool result.
 * Shared by web-fetch and web-scrape so both report failures identically.
 */
export function describeWebError(err: unknown): { error: string; status: number | null } {
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

/** Map assertSafeUrl's thrown messages onto our tagged errors. */
async function guard(url: string): Promise<void> {
  try {
    await assertSafeUrl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/^Invalid URL/.test(msg)) throw new WebFetchError('invalid_url', msg);
    if (/Blocked URL scheme/.test(msg)) throw new WebFetchError('blocked', msg);
    if (/DNS lookup failed/.test(msg)) throw new WebFetchError('dns', msg);
    throw new WebFetchError('blocked', msg); // private/reserved IP
  }
}

/** True for content types we can extract text from. */
function isTextual(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.includes('text/html') ||
    ct.includes('application/xhtml') ||
    ct.includes('text/plain') ||
    ct.startsWith('text/') ||
    ct.includes('xml')
  );
}

/** Read a response body up to `maxBytes`, decoding as UTF-8. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
        if (total >= maxBytes) break; // stop early — cap reached
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  return new TextDecoder('utf-8').decode(concat(chunks, Math.min(total, maxBytes)));
}

function concat(chunks: Uint8Array[], limit: number): Uint8Array {
  const out = new Uint8Array(limit);
  let offset = 0;
  for (const c of chunks) {
    if (offset >= limit) break;
    const take = Math.min(c.length, limit - offset);
    out.set(c.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

/**
 * Fetch `url` over HTTP with manual, SSRF-re-validated redirects and a byte
 * cap. Returns the raw HTML (for extraction). Throws `WebFetchError` on any
 * failure.
 */
export async function httpFetch(
  url: string,
  opts: { timeoutSec?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<RawPage> {
  const timeoutMs = (opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      await guard(current); // re-validate every hop (initial + each redirect)
      let res: Response;
      try {
        res = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
        });
      } catch (err) {
        if (controller.signal.aborted) throw new WebFetchError('timeout', `Request timed out after ${timeoutMs / 1000}s.`);
        throw new WebFetchError('network', err instanceof Error ? err.message : String(err));
      }

      // Redirect: resolve Location against the current URL and loop.
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }

      if (res.status >= 400) {
        throw new WebFetchError('http_status', `HTTP ${res.status} ${res.statusText || ''}`.trim(), res.status);
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType && !isTextual(contentType)) {
        throw new WebFetchError('content_type', `Unsupported content type "${contentType.split(';')[0]}".`, res.status);
      }

      const html = await readCapped(res, maxBytes);
      return { finalUrl: current, status: res.status, html };
    }
    throw new WebFetchError('too_many_redirects', `Exceeded ${maxRedirects} redirects.`);
  } finally {
    clearTimeout(timer);
  }
}

/** Image types a notebook keeps: never SVG (it can carry script). */
const IMAGE_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

export interface FetchedImage { bytes: Uint8Array; contentType: string; finalUrl: string }

/**
 * Fetch one image with the same guards as pages (every redirect hop checked
 * against private and reserved addresses, a timeout), plus: JPEG, PNG, GIF or
 * WebP only, the bytes must match the type, and an image over `maxBytes` is
 * refused rather than cut off.
 */
export async function fetchImage(url: string, opts: { timeoutSec?: number; maxBytes?: number } = {}): Promise<FetchedImage> {
  const timeoutMs = (opts.timeoutSec ?? 15) * 1000;
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await guard(current);
      let res: Response;
      try {
        // Ask only for formats it keeps: image CDNs serve AVIF to anyone who lists it, and AVIF isn't kept.
        res = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.9,image/*;q=0.5' } });
      } catch (err) {
        if (controller.signal.aborted) throw new WebFetchError('timeout', `Request timed out after ${timeoutMs / 1000}s.`);
        throw new WebFetchError('network', err instanceof Error ? err.message : String(err));
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      if (res.status >= 400) throw new WebFetchError('http_status', `HTTP ${res.status}`, res.status);
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const check = IMAGE_TYPES[contentType];
      if (!check) throw new WebFetchError('content_type', `Not a photo sua keeps ("${contentType || 'unknown'}").`, res.status);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new WebFetchError('content_type', 'The image is too large.', res.status);
      const bytes = await readBytes(res, maxBytes);
      if (!bytes) throw new WebFetchError('content_type', 'The image is too large.', res.status);
      if (bytes.length < 12 || !check(bytes)) throw new WebFetchError('content_type', `The file isn't really ${contentType}.`, res.status);
      return { bytes, contentType, finalUrl: current };
    }
    throw new WebFetchError('too_many_redirects', `Exceeded ${MAX_REDIRECTS} redirects.`);
  } finally {
    clearTimeout(timer);
  }
}

/** The whole body, or undefined when it's over the cap. */
async function readBytes(res: Response, maxBytes: number): Promise<Uint8Array | undefined> {
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); return b.length > maxBytes ? undefined : b; }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > maxBytes) return undefined;
        chunks.push(value);
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  return concat(chunks, total);
}

/**
 * The page's own preview photo (og:image / twitter:image) and title, for a
 * listing that didn't come with a photo. Read from the first part of the page.
 */
export async function pagePreview(url: string): Promise<{ image?: string; title?: string }> {
  const page = await httpFetch(url, { timeoutSec: 15, maxBytes: 512 * 1024 });
  const meta = (name: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
    const tag = re.exec(page.html)?.[0];
    return tag ? /content=["']([^"']+)["']/i.exec(tag)?.[1] : undefined;
  };
  const raw = meta('og:image') ?? meta('og:image:url') ?? meta('twitter:image');
  let image: string | undefined;
  try { image = raw ? new URL(raw.replace(/&amp;/g, '&'), page.finalUrl).toString() : undefined; } catch { image = undefined; }
  const title = meta('og:title') ?? /<title[^>]*>([^<]{1,300})<\/title>/i.exec(page.html)?.[1];
  return { ...(image && /^https?:/i.test(image) ? { image } : {}), ...(title ? { title: title.replace(/&amp;/g, '&').trim() } : {}) };
}
