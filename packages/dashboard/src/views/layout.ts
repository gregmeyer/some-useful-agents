import { html, unsafeHtml, type SafeHtml } from './html.js';
import { DASHBOARD_JS } from './js.js';
import { TEMPLATE_PALETTE_JS } from './template-palette.js.js';
import { SUGGEST_IMPROVEMENTS_JS } from './suggest-improvements.js.js';
import { PULSE_LAYOUT_JS } from './pulse-layout.js.js';
import { HOME_LAYOUT_JS } from './home-layout.js.js';
import { BUILD_FROM_GOAL_JS } from './build-from-goal.js.js';
import { OUTPUT_WIDGET_ACTIONS_JS } from './output-widget-actions.js.js';
import { RUN_DETAIL_FILTER_JS } from './run-detail-filter.js.js';
import { PULSE_CONFIGURE_JS } from './pulse-configure.js.js';
import { PULSE_REFRESH_JS } from './pulse-refresh.js.js';
import { footer } from './footer.js';

export interface LayoutOptions {
  title: string;
  /** Highlight in the nav (one of: agents, tools, runs, pulse, settings, help). */
  activeNav?: 'agents' | 'tools' | 'runs' | 'pulse' | 'settings' | 'help';
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
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x2699;</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/dashboard.css">
<script>
(function(){var t=localStorage.getItem('sua-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');})();
</script>
</head>
<body class="app">
<script>(function(){var w=localStorage.getItem('sua-widget-theme');if(w&&w!=='default'&&w!=='light')document.body.setAttribute('data-widget-theme',w);})();</script>
<header class="topbar">
  <a class="topbar__brand" href="/">sua</a>
  <nav class="topbar__nav">
    <a href="/agents" class="${opts.activeNav === 'agents' ? 'is-active' : ''}">Agents</a>
    <a href="/tools" class="${opts.activeNav === 'tools' ? 'is-active' : ''}">Tools</a>
    <a href="/runs" class="${opts.activeNav === 'runs' ? 'is-active' : ''}">Runs</a>
    <a href="/pulse" class="${opts.activeNav === 'pulse' ? 'is-active' : ''}">Pulse</a>
    <a href="/settings" class="${opts.activeNav === 'settings' ? 'is-active' : ''}">Settings</a>
    <a href="/help" class="${opts.activeNav === 'help' ? 'is-active' : ''}">Help</a>
  </nav>
  <button class="topbar__theme-toggle" onclick="(function(){var h=document.documentElement;var c=h.getAttribute('data-theme');var n=c==='light'?null:'light';if(n)h.setAttribute('data-theme',n);else h.removeAttribute('data-theme');localStorage.setItem('sua-theme',n||'dark');})();" aria-label="Toggle theme">
    <span class="topbar__theme-icon"></span>
  </button>
</header>
<main class="${mainClass}">
  ${flash}
  ${body}
</main>
${footer()}
<script>${unsafeHtml(DASHBOARD_JS + TEMPLATE_PALETTE_JS + SUGGEST_IMPROVEMENTS_JS + PULSE_LAYOUT_JS + HOME_LAYOUT_JS + BUILD_FROM_GOAL_JS + OUTPUT_WIDGET_ACTIONS_JS + RUN_DETAIL_FILTER_JS + PULSE_CONFIGURE_JS + PULSE_REFRESH_JS)}</script>
</body>
</html>`;
}
