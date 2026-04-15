import { html, unsafeHtml, type SafeHtml } from './html.js';
import { DASHBOARD_JS } from './js.js';
import { footer } from './footer.js';

export interface LayoutOptions {
  title: string;
  /** Highlight in the nav (one of: agents, runs, settings, help). */
  activeNav?: 'agents' | 'runs' | 'settings' | 'help';
  /** Flash banner shown at the top of the body (errors from prior actions). */
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  /** Widen the main column (for screens with 2-col layouts). */
  wide?: boolean;
}

export function layout(opts: LayoutOptions, body: SafeHtml): SafeHtml {
  const flashClass =
    opts.flash?.kind === 'error' ? 'flash--error'
    : opts.flash?.kind === 'ok' ? 'flash--ok'
    : 'flash--info';
  const flash = opts.flash
    ? html`<div class="flash ${flashClass}">${opts.flash.message}</div>`
    : unsafeHtml('');
  const mainClass = opts.wide ? 'main--wide' : '';

  return html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} · sua dashboard</title>
<link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body class="app">
<header class="topbar">
  <a class="topbar__brand" href="/">sua</a>
  <nav class="topbar__nav">
    <a href="/agents" class="${opts.activeNav === 'agents' ? 'is-active' : ''}">Agents</a>
    <a href="/runs" class="${opts.activeNav === 'runs' ? 'is-active' : ''}">Runs</a>
    <a href="/settings" class="${opts.activeNav === 'settings' ? 'is-active' : ''}">Settings</a>
    <a href="/help" class="${opts.activeNav === 'help' ? 'is-active' : ''}">Help</a>
  </nav>
</header>
<main class="${mainClass}">
  ${flash}
  ${body}
</main>
${footer()}
<script>${unsafeHtml(DASHBOARD_JS)}</script>
</body>
</html>`;
}
