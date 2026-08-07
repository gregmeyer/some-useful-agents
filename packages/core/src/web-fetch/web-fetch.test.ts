/**
 * web-fetch matrix. Network is mocked via globalThis.fetch; the browser module
 * is mocked so no real Chromium launches. assertSafeUrl does a real DNS lookup
 * for example.com hosts (public) — the same approach the http-get tests use;
 * private/loopback cases use literal IPs so no DNS is needed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webFetch } from './index.js';
import * as browser from './browser.js';

// Mock the browser module so 'auto'/'always' escalation is deterministic and
// never launches Chromium. Default: unavailable (so HTTP-only paths are tested).
vi.mock('./browser.js', () => ({
  renderWithBrowser: vi.fn(async () => ({ available: false, reason: 'mocked-unavailable' })),
}));
const mockedRender = vi.mocked(browser.renderWithBrowser);

const HTML = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

const ARTICLE = HTML('Example Domain', `
  <nav>Home About Contact</nav>
  <article>
    <h1>Main Heading</h1>
    <p>This is the first substantial paragraph of the article with enough words to count as real readable content for extraction.</p>
    <ul><li>Point one</li><li>Point two</li></ul>
  </article>
  <footer>copyright boilerplate</footer>`);

let originalFetch: typeof fetch;

function mockFetchOnce(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) =>
    handler(String(url), init)) as unknown as typeof fetch;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockedRender.mockResolvedValue({ available: false, reason: 'mocked-unavailable' });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('webFetch — HTTP + extraction', () => {
  it('extracts title and main content from static HTML (drops nav/footer)', async () => {
    mockFetchOnce(() => new Response(ARTICLE, { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await webFetch('https://example.com/', { browser: 'never' });
    expect(r.method).toBe('http');
    expect(r.status).toBe(200);
    expect(r.title).toBe('Example Domain');
    expect(r.content).toContain('Main Heading');
    expect(r.content).toContain('first substantial paragraph');
    expect(r.content).toContain('Point one');
    expect(r.content).not.toContain('copyright boilerplate'); // footer dropped
    expect(r.error).toBeNull();
    expect(r.truncated).toBe(false);
  });

  it('follows redirects manually and returns the final page', async () => {
    let hop = 0;
    mockFetchOnce((url) => {
      hop++;
      if (url === 'https://example.com/start') {
        return new Response(null, { status: 301, headers: { location: 'https://example.com/final' } });
      }
      return new Response(ARTICLE, { status: 200, headers: { 'content-type': 'text/html' } });
    });
    const r = await webFetch('https://example.com/start', { browser: 'never' });
    expect(hop).toBe(2);
    expect(r.url).toBe('https://example.com/final');
    expect(r.status).toBe(200);
    expect(r.title).toBe('Example Domain');
  });

  it('truncates content to max_chars', async () => {
    const big = HTML('Big', `<article><p>${'word '.repeat(5000)}</p></article>`);
    mockFetchOnce(() => new Response(big, { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await webFetch('https://example.com/', { maxChars: 500, browser: 'never' });
    expect(r.truncated).toBe(true);
    expect(r.content!.length).toBeLessThan(700);
    expect(r.content).toContain('[truncated]');
  });

  it('reports little/no useful content as a structured error (browser:never)', async () => {
    mockFetchOnce(() => new Response(HTML('Empty', ''), { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await webFetch('https://example.com/', { browser: 'never' });
    expect(r.content).toBeNull();
    expect(r.error).toMatch(/no readable content/i);
  });
});

describe('webFetch — failures (never throws)', () => {
  it('404 → not found', async () => {
    mockFetchOnce(() => new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }));
    const r = await webFetch('https://example.com/missing', { browser: 'never' });
    expect(r.status).toBe(404);
    expect(r.content).toBeNull();
    expect(r.error).toMatch(/not found/i);
  });

  it('403 → access denied', async () => {
    mockFetchOnce(() => new Response('denied', { status: 403, headers: { 'content-type': 'text/html' } }));
    const r = await webFetch('https://example.com/secret', { browser: 'never' });
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/denied access/i);
  });

  it('unsupported content type → structured error', async () => {
    mockFetchOnce(() => new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const r = await webFetch('https://example.com/file.pdf', { browser: 'never' });
    expect(r.error).toMatch(/unsupported content type/i);
  });

  it('timeout → timed out', async () => {
    // Reject only when the tool aborts via its timeout signal.
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
      });
    }) as unknown as typeof fetch;
    const r = await webFetch('https://example.com/slow', { timeoutSec: 0.01, browser: 'never' });
    expect(r.error).toMatch(/timed out/i);
  });

  it('malformed URL → invalid', async () => {
    const r = await webFetch('not a url', { browser: 'never' });
    expect(r.error).toMatch(/not valid/i);
    expect(r.status).toBeNull();
  });

  it('localhost / private IP → SSRF blocked (no fetch)', async () => {
    let called = false;
    mockFetchOnce(() => { called = true; return new Response('x'); });
    const r = await webFetch('http://127.0.0.1/', { browser: 'never' });
    expect(called).toBe(false);
    expect(r.content).toBeNull();
    expect(r.error).toMatch(/private or disallowed/i);
  });
});

describe('webFetch — browser fallback', () => {
  it("escalates to the browser and reports method:'browser' when HTTP is thin", async () => {
    mockFetchOnce(() => new Response(HTML('Empty', ''), { status: 200, headers: { 'content-type': 'text/html' } }));
    mockedRender.mockResolvedValueOnce({
      available: true,
      status: 200,
      finalUrl: 'https://spa.example.com/',
      html: HTML('SPA', '<article><h1>Rendered</h1><p>Content that only appears after JavaScript runs, now visible.</p></article>'),
    });
    const r = await webFetch('https://spa.example.com/', { browser: 'auto' });
    expect(mockedRender).toHaveBeenCalledOnce();
    expect(r.method).toBe('browser');
    expect(r.content).toContain('Rendered');
    expect(r.title).toBe('SPA');
  });

  it('falls back to the HTTP result when the browser is unavailable', async () => {
    mockFetchOnce(() => new Response(ARTICLE, { status: 200, headers: { 'content-type': 'text/html' } }));
    // HTTP content is good, so 'auto' shouldn't even escalate — assert method http.
    const r = await webFetch('https://example.com/', { browser: 'auto' });
    expect(r.method).toBe('http');
    expect(r.content).toContain('Main Heading');
  });
});
