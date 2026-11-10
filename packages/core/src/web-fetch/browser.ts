/**
 * Level 3 (optional): render a JS-dependent page with headless Chromium.
 *
 * Playwright is an OPTIONAL dependency, imported lazily so the default install
 * stays light and packages that never scrape don't pull a browser. If it (or
 * its Chromium binary) isn't present, this returns `{ available: false }` and
 * the orchestrator degrades to the HTTP result — it never throws for a missing
 * browser. The rendered HTML is handed back to the same extraction pipeline.
 */
import { assertSafeUrl } from '../builtin-tools.js';

export type BrowserRender =
  | { available: true; html: string; status: number; finalUrl: string }
  | { available: false; reason: string };

const DEFAULT_TIMEOUT_SEC = 30;

export async function renderWithBrowser(
  url: string,
  opts: { timeoutSec?: number } = {},
): Promise<BrowserRender> {
  // SSRF guard on the entry URL (same as the HTTP path).
  try {
    await assertSafeUrl(url);
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }

  // Lazy, optional import — missing package must not crash the tool.
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return {
      available: false,
      reason: 'Browser fallback unavailable: install it with `npm i playwright && npx playwright install chromium`.',
    };
  }

  const timeoutMs = (opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  let browser: import('playwright').Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (compatible; sua-web-fetch)' });
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    const html = await page.content();
    return {
      available: true,
      html,
      status: response?.status() ?? 200,
      finalUrl: page.url(),
    };
  } catch (err) {
    // Chromium missing, nav timeout, crash — treat as "unavailable" so the
    // caller keeps whatever the HTTP path produced.
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await browser?.close(); } catch { /* best-effort */ }
  }
}

export type BrowserShot =
  | { available: true; png: Buffer; title: string; finalUrl: string; status: number; width: number; height: number; views: Buffer[] }
  | { available: false; reason: string };

/** The tallest full-page shot kept (px); a longer page is cut at this height. */
export const SHOT_MAX_HEIGHT = 8000;
/** What a model is shown of a page: JPEG views from the top, each this tall at most, this many at most. */
export const SHOT_VIEW_HEIGHT = 1400;
export const SHOT_MAX_VIEWS = 3;

/**
 * A picture of a page as a browser shows it: the window (`fullPage` false)
 * or the whole page, cut at SHOT_MAX_HEIGHT. Every request the page makes is
 * checked (assertSafeUrl), not only the first, so a redirect or a script
 * can't reach a private address. Never throws; a missing browser says how to
 * install it.
 */
export async function screenshotWithBrowser(
  url: string,
  opts: { timeoutSec?: number; fullPage?: boolean; width?: number } = {},
): Promise<BrowserShot> {
  try {
    await assertSafeUrl(url);
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return {
      available: false,
      reason: 'Screenshots need a browser: install it with `npm i playwright && npx playwright install chromium`.',
    };
  }
  const width = Math.min(1920, Math.max(320, Math.round(opts.width ?? 1280)));
  const timeoutMs = (opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  let browser: import('playwright').Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height: 900 }, userAgent: 'Mozilla/5.0 (compatible; sua-web-screenshot)' });
    await page.route('**/*', async (route) => {
      const u = route.request().url();
      if (/^(data|blob):/i.test(u)) return route.continue();
      try { await assertSafeUrl(u); } catch { return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    const title = await page.title();
    const full = opts.fullPage === true;
    const pageHeight = full ? Number(await page.evaluate('document.documentElement.scrollHeight')) : 900;
    const height = Math.min(SHOT_MAX_HEIGHT, Math.max(1, pageHeight));
    const png = await page.screenshot(full ? { clip: { x: 0, y: 0, width, height }, fullPage: true } : {});
    // For a model to look at: the page from the top in views it can read (a tall
    // picture would be shrunk until its text is too small), as smaller JPEGs.
    const views: Buffer[] = [];
    for (let y = 0; y < height && views.length < SHOT_MAX_VIEWS; y += SHOT_VIEW_HEIGHT) {
      views.push(await page.screenshot({ type: 'jpeg', quality: 70, fullPage: full, clip: { x: 0, y, width, height: Math.min(SHOT_VIEW_HEIGHT, height - y) } }));
    }
    return { available: true, png, title, finalUrl: page.url(), status: response?.status() ?? 200, width, height, views };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await browser?.close(); } catch { /* best-effort */ }
  }
}

export type BrowserFile =
  | { available: true; data: Buffer }
  | { available: false; reason: string };

/** A page given as HTML (not an address), opened in headless Chromium with every request it makes checked. */
async function withHtmlPage<T>(
  html: string,
  opts: { timeoutSec?: number; width?: number; height?: number; scale?: number; missing: string },
  use: (page: import('playwright').Page) => Promise<T>,
): Promise<{ available: true; value: T } | { available: false; reason: string }> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { available: false, reason: `${opts.missing}: install it with \`npm i playwright && npx playwright install chromium\`.` };
  }
  const timeoutMs = (opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  let browser: import('playwright').Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: Math.min(2400, Math.max(320, Math.round(opts.width ?? 1280))), height: Math.min(4000, Math.max(200, Math.round(opts.height ?? 900))) },
      deviceScaleFactor: Math.min(3, Math.max(1, opts.scale ?? 1)),
    });
    // The page is ours, but what it links (fonts, pictures) is checked like any page's: nothing private is fetched.
    await page.route('**/*', async (route) => {
      const u = route.request().url();
      if (/^(data|blob|about):/i.test(u)) return route.continue();
      try { await assertSafeUrl(u); } catch { return route.abort('blockedbyclient'); }
      return route.continue();
    });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: timeoutMs });
    // Web fonts decide where lines break: wait for them, so the file looks as the page does.
    try { await page.evaluate('document.fonts.ready'); } catch { /* no font API: as it is */ }
    return { available: true, value: await use(page) };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await browser?.close(); } catch { /* best-effort */ }
  }
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));

/**
 * A page of HTML as a PDF file, as it prints (its `@media print` rules, its
 * colours kept), with nothing a browser's print dialog adds: no address, no
 * print time. `footer` (a title, a date) is set small at the bottom left of
 * every page, with "page of pages" at the right. Never throws; a missing
 * browser says how to install it.
 */
export async function htmlToPdf(
  html: string,
  opts: { footer?: string; paper?: 'Letter' | 'A4'; timeoutSec?: number } = {},
): Promise<BrowserFile> {
  const foot = `<div style="box-sizing:border-box;width:100%;padding:0 14mm;display:flex;justify-content:space-between;gap:8mm;font:8px/1.2 -apple-system,'Helvetica Neue',Arial,sans-serif;color:#8a8580;"><span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escHtml(opts.footer ?? '')}</span><span style="white-space:nowrap;"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
  const out = await withHtmlPage(html, { timeoutSec: opts.timeoutSec, missing: 'A PDF needs a browser' }, (page) => page.pdf({
    format: opts.paper ?? 'Letter', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>', footerTemplate: foot,
    margin: { top: '15mm', bottom: '17mm', left: '14mm', right: '14mm' },
  }));
  return out.available ? { available: true, data: Buffer.from(out.value) } : out;
}

/**
 * A page of HTML as a PNG picture: the element `selector` matches (the whole
 * page without one), at `width` CSS pixels and `scale` device pixels each
 * (2 by default, so text stays sharp when it's shared). Never throws.
 */
export async function htmlToPng(
  html: string,
  opts: { width?: number; scale?: number; selector?: string; timeoutSec?: number } = {},
): Promise<BrowserFile> {
  const out = await withHtmlPage(html, { timeoutSec: opts.timeoutSec, width: opts.width ?? 1200, scale: opts.scale ?? 2, missing: 'A picture needs a browser' }, async (page) => {
    const el = opts.selector ? await page.$(opts.selector) : null;
    return el ? el.screenshot({ type: 'png' }) : page.screenshot({ type: 'png', fullPage: true });
  });
  return out.available ? { available: true, data: Buffer.from(out.value) } : out;
}
