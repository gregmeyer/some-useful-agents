import { html, type SafeHtml } from './html.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Package version read once at module load. Matches what's shipping
 * so the footer honestly reflects the running build.
 */
let cachedVersion: string | null = null;
function readVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const pkg = require('../../package.json') as { version?: string };
    cachedVersion = pkg.version ?? 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

export function footer(): SafeHtml {
  const version = readVersion();
  return html`
    <footer class="app-footer">
      <div class="app-footer__inner">
        <span class="app-footer__brand">sua <span class="mono dim">v${version}</span></span>
        <nav class="app-footer__nav">
          <a href="/help">Help &amp; tutorial</a>
          <a href="https://github.com/gregmeyer/some-useful-agents" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://github.com/gregmeyer/some-useful-agents/tree/main/docs" target="_blank" rel="noreferrer">Docs</a>
        </nav>
      </div>
    </footer>
  `;
}
