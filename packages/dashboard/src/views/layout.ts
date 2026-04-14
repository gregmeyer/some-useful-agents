import { html, unsafeHtml, type SafeHtml } from './html.js';
import { DASHBOARD_CSS } from './css.js';
import { DASHBOARD_JS } from './js.js';

export interface LayoutOptions {
  title: string;
  /** Highlight in the nav (one of: agents, runs). */
  activeNav?: 'agents' | 'runs';
  /** Flash banner shown at the top of the body (errors from prior actions). */
  flash?: { kind: 'error' | 'info'; message: string };
}

export function layout(opts: LayoutOptions, body: SafeHtml): SafeHtml {
  const flash = opts.flash
    ? html`<div class="flash flash-${opts.flash.kind}">${opts.flash.message}</div>`
    : unsafeHtml('');

  return html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} · sua dashboard</title>
<style>${unsafeHtml(DASHBOARD_CSS)}</style>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">sua</a>
  <nav>
    <a href="/agents" class="${opts.activeNav === 'agents' ? 'active' : ''}">Agents</a>
    <a href="/runs" class="${opts.activeNav === 'runs' ? 'active' : ''}">Runs</a>
  </nav>
</header>
<main>
  ${flash}
  ${body}
</main>
<script>${unsafeHtml(DASHBOARD_JS)}</script>
</body>
</html>`;
}
