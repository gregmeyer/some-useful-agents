import { html, unsafeHtml, type SafeHtml } from './html.js';
import { renderInboxModalShell } from './inbox-modal.js';
import { footer } from './footer.js';

export interface LayoutOptions {
  title: string;
  /**
   * Highlight in the nav. Scheduled lives under the Agents sub-nav
   * now (see section-tabs.ts), so pages on /scheduled should pass
   * `activeNav: 'agents'` to highlight Agents in the top bar.
   */
  activeNav?: 'home' | 'agents' | 'tools' | 'nodes' | 'runs' | 'packs' | 'pulse' | 'inbox' | 'settings' | 'help';
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
// Buffer CSP img-src violations that fire DURING body parse (before the
// main script bundle at the end of body has registered its listener).
// csp-img-report.js.ts drains this buffer on load. Without this, the
// inline "Allow host" card never renders on the first page load —
// violations fire on initial img-src fetch attempts, well before the
// bundle script tag is reached.
(function(){window.__suaCspBuffer = [];window.addEventListener('securitypolicyviolation', function(e){if(e&&e.violatedDirective==='img-src')window.__suaCspBuffer.push({blockedURI:e.blockedURI,target:e.target,t:Date.now()});});})();
</script>
</head>
<body class="app" data-active-nav="${opts.activeNav ?? ''}">
<script>(function(){var w=localStorage.getItem('sua-widget-theme');if(w&&w!=='default'&&w!=='light')document.body.setAttribute('data-widget-theme',w);})();</script>
<header class="topbar">
  <a class="topbar__brand ${opts.activeNav === 'home' ? 'is-active' : ''}" href="/">sua</a>
  <nav class="topbar__nav">
    <a href="/inbox" class="${opts.activeNav === 'inbox' ? 'is-active' : ''}">Inbox</a>
    <a href="/agents" class="${opts.activeNav === 'agents' || opts.activeNav === 'tools' || opts.activeNav === 'nodes' || opts.activeNav === 'runs' || opts.activeNav === 'packs' ? 'is-active' : ''}">Agents</a>
    <a href="/pulse" class="${opts.activeNav === 'pulse' ? 'is-active' : ''}">Pulse</a>
    <a href="/settings" class="${opts.activeNav === 'settings' ? 'is-active' : ''}">Settings</a>
    <a href="/help" class="${opts.activeNav === 'help' ? 'is-active' : ''}">Help</a>
  </nav>
  <div class="topbar__right">
    <a class="topbar__needs" data-inbox-toast href="/inbox" aria-live="polite" hidden>
      <span class="topbar__needs-dot" aria-hidden="true"></span>
      <span data-inbox-count></span><span data-inbox-label>&nbsp;need your reply</span>
      <span class="topbar__needs-arrow" aria-hidden="true">→</span>
    </a>
    <button class="topbar__theme-toggle" onclick="(function(){var h=document.documentElement;var c=h.getAttribute('data-theme');var n=c==='light'?null:'light';if(n)h.setAttribute('data-theme',n);else h.removeAttribute('data-theme');localStorage.setItem('sua-theme',n||'dark');})();" aria-label="Toggle theme">
      <span class="topbar__theme-icon"></span>
    </button>
  </div>
</header>
<div class="app-ask ${opts.activeNav === 'home' ? 'app-ask--home' : ''}">
  <form class="home-ask home-ask--bar" method="POST" action="/inbox/new" data-home-ask>
    <span class="home-ask__prompt" aria-hidden="true">sua&nbsp;›</span>
    <textarea class="home-ask__input" name="body" rows="1"
      placeholder="Ask sua to run, build, fix, or look something up…"
      data-home-ask-input aria-label="Ask sua"></textarea>
    <button type="submit" class="btn btn--primary btn--sm home-ask__send" data-home-ask-send>Send ↵</button>
  </form>
</div>
<main class="${mainClass}">
  ${flash}
  ${body}
</main>
${footer()}
${renderInboxModalShell()}
<script src="/assets/dashboard.js" defer></script>
</body>
</html>`;
}
