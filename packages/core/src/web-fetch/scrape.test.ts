/**
 * web-scrape matrix. Network mocked via globalThis.fetch; the browser module is
 * mocked so no Chromium launches. assertSafeUrl does a real DNS lookup for
 * example.com (public); private/loopback cases use literal IPs (no DNS).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webScrape, extractStructured } from './scrape.js';
import * as browser from './browser.js';

vi.mock('./browser.js', () => ({
  renderWithBrowser: vi.fn(async () => ({ available: false, reason: 'mocked-unavailable' })),
}));
const mockedRender = vi.mocked(browser.renderWithBrowser);

const productJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Trail Shoe 3000',
  offers: { '@type': 'Offer', price: '129.99', priceCurrency: 'USD' },
};

const PAGE = (opts: { jsonLd?: unknown; extraScript?: string; meta?: boolean } = {}) => {
  const ld = opts.jsonLd !== undefined
    ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>` : '';
  const extra = opts.extraScript ? `<script type="application/ld+json">${opts.extraScript}</script>` : '';
  const meta = opts.meta
    ? '<meta property="og:title" content="OG Title"><meta name="description" content="A description">' : '';
  return `<!doctype html><html><head><title>Shoe Page</title>${meta}${ld}${extra}</head><body><h1>Hi</h1></body></html>`;
};

let originalFetch: typeof fetch;
function mockFetch(handler: (url: string) => Response) {
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => handler(String(url))) as unknown as typeof fetch;
}
const html200 = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockedRender.mockResolvedValue({ available: false, reason: 'mocked-unavailable' });
});
afterEach(() => { globalThis.fetch = originalFetch; vi.clearAllMocks(); });

describe('extractStructured', () => {
  it('parses JSON-LD, flattens arrays, skips unparseable, keeps @graph', () => {
    const html = PAGE({ jsonLd: [productJsonLd, { '@type': 'BreadcrumbList' }], extraScript: '{ not json' });
    const ex = extractStructured(html);
    expect(ex.json_ld).toHaveLength(2); // array flattened; bad block skipped
    expect((ex.json_ld[0] as { name: string }).name).toBe('Trail Shoe 3000');
  });

  it('extracts title + og/meta tags', () => {
    const ex = extractStructured(PAGE({ meta: true }));
    expect(ex.meta.title).toBe('Shoe Page');
    expect(ex.meta['og:title']).toBe('OG Title');
    expect(ex.meta.description).toBe('A description');
  });

  it('omits html unless includeHtml, and caps it', () => {
    expect(extractStructured(PAGE(), {}).html).toBeNull();
    const big = `<html><body>${'x'.repeat(5000)}</body></html>`;
    const ex = extractStructured(big, { includeHtml: true, maxHtmlChars: 500 });
    expect(ex.truncated).toBe(true);
    expect(ex.html!.length).toBe(500);
  });
});

describe('webScrape', () => {
  it('returns JSON-LD + meta from a static page (HTTP)', async () => {
    mockFetch(() => html200(PAGE({ jsonLd: productJsonLd, meta: true })));
    const r = await webScrape('https://example.com/product', { render: 'never' });
    expect(r.method).toBe('http');
    expect(r.status).toBe(200);
    expect(r.json_ld).toHaveLength(1);
    expect((r.json_ld[0] as { offers: { price: string } }).offers.price).toBe('129.99');
    expect(r.meta['og:title']).toBe('OG Title');
    expect(r.html).toBeNull();
    expect(r.error).toBeNull();
  });

  it('include_html returns the raw HTML', async () => {
    mockFetch(() => html200(PAGE({ jsonLd: productJsonLd })));
    const r = await webScrape('https://example.com/p', { render: 'never', includeHtml: true });
    expect(r.html).toContain('<title>Shoe Page</title>');
  });

  it('a page with no JSON-LD is still a success (not an error)', async () => {
    mockFetch(() => html200(PAGE({ meta: true })));
    const r = await webScrape('https://example.com/plain', { render: 'never' });
    expect(r.error).toBeNull();
    expect(r.json_ld).toHaveLength(0);
    expect(r.meta.title).toBe('Shoe Page');
  });

  it("escalates to the browser under 'auto' when HTTP has no JSON-LD", async () => {
    mockFetch(() => html200(PAGE({ meta: true }))); // no JSON-LD over HTTP
    mockedRender.mockResolvedValueOnce({
      available: true, status: 200, finalUrl: 'https://spa.example.com/',
      html: PAGE({ jsonLd: productJsonLd }),
    });
    const r = await webScrape('https://spa.example.com/', { render: 'auto' });
    expect(mockedRender).toHaveBeenCalledOnce();
    expect(r.method).toBe('browser');
    expect(r.json_ld).toHaveLength(1);
  });

  it("'never' does not launch the browser even without JSON-LD", async () => {
    mockFetch(() => html200(PAGE({ meta: true })));
    const r = await webScrape('https://example.com/', { render: 'never' });
    expect(mockedRender).not.toHaveBeenCalled();
    expect(r.method).toBe('http');
  });

  it('falls back to the HTTP result when the browser is unavailable', async () => {
    mockFetch(() => html200(PAGE({ meta: true }))); // no JSON-LD → auto tries browser
    const r = await webScrape('https://example.com/', { render: 'auto' });
    expect(mockedRender).toHaveBeenCalled();
    expect(r.method).toBe('http'); // browser unavailable → keep HTTP result
    expect(r.meta.title).toBe('Shoe Page');
  });

  it('404 → structured error, never throws', async () => {
    mockFetch(() => new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }));
    const r = await webScrape('https://example.com/missing', { render: 'never' });
    expect(r.status).toBe(404);
    expect(r.error).toMatch(/not found/i);
    expect(r.json_ld).toEqual([]);
  });

  it('malformed URL → invalid', async () => {
    const r = await webScrape('not a url', { render: 'never' });
    expect(r.error).toMatch(/not valid/i);
  });

  it('localhost / private IP → SSRF blocked (no fetch)', async () => {
    let called = false;
    mockFetch(() => { called = true; return html200(PAGE()); });
    const r = await webScrape('http://127.0.0.1/', { render: 'never' });
    expect(called).toBe(false);
    expect(r.error).toMatch(/private or disallowed/i);
  });
});
