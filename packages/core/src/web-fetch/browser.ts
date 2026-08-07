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
