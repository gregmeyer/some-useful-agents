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
  | { available: true; png: Buffer; title: string; finalUrl: string; status: number; width: number; height: number }
  | { available: false; reason: string };

/** The tallest full-page shot kept (px); a longer page is cut at this height. */
export const SHOT_MAX_HEIGHT = 8000;

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
    return { available: true, png, title, finalUrl: page.url(), status: response?.status() ?? 200, width, height };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try { await browser?.close(); } catch { /* best-effort */ }
  }
}
