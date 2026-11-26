import { html, unsafeHtml, type SafeHtml } from './html.js';
import { renderInboxModalShell } from './inbox-modal.js';
import { footer } from './footer.js';

export interface LayoutOptions {
  /** No "sua ›" ask bar: the page has its own place to ask (Home's question box). */
  askBar?: boolean;
  title: string;
  /**
   * Highlight in the nav. Scheduled lives under the Agents sub-nav
   * now (see section-tabs.ts), so pages on /scheduled should pass
   * `activeNav: 'agents'` to highlight Agents in the top bar.
   */
  activeNav?: 'home' | 'notebooks' | 'experiments' | 'agents' | 'tools' | 'nodes' | 'runs' | 'packs' | 'pulse' | 'inbox' | 'settings' | 'help';
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
<link rel="stylesheet" href="/assets/theme.css">
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

<header class="topbar">
  ${/* The brand is Home, and Home is the inbox: one link, not two. */ ''}
  <a class="topbar__brand ${opts.activeNav === 'home' || opts.activeNav === 'inbox' ? 'is-active' : ''}" href="/" title="Home: your inbox" ${opts.activeNav === 'home' || opts.activeNav === 'inbox' ? html`aria-current="page"` : html``}>sua</a>
  ${topbarNav(opts.activeNav)}
  <div class="topbar__right">
    <a class="topbar__needs" data-inbox-toast href="/inbox" aria-live="polite" hidden>
      <span class="topbar__needs-count" data-inbox-count></span><span data-inbox-label>need you</span>
    </a>
    <button type="button" class="topbar__ask" data-panel-toggle aria-pressed="false" title="Ask sua (Cmd/Ctrl+K)">
      Ask sua <kbd class="topbar__ask-key" data-panel-key>⌘K</kbd>
    </button>
    <button class="topbar__theme-toggle" onclick="(function(){var h=document.documentElement;var c=h.getAttribute('data-theme');var n=c==='light'?null:'light';if(n)h.setAttribute('data-theme',n);else h.removeAttribute('data-theme');localStorage.setItem('sua-theme',n||'dark');})();" aria-label="Toggle theme">
      <span class="topbar__theme-icon"></span>
    </button>
  </div>
</header>
${opts.askBar === false ? html`` : html`<div class="app-ask">
  <form class="home-ask home-ask--bar" method="POST" action="/inbox/new" data-home-ask>
    <span class="home-ask__prompt" aria-hidden="true">sua&nbsp;›</span>
    <textarea class="home-ask__input" name="body" rows="1"
      placeholder="Ask a question, or ask sua to run, build or fix something…"
      data-home-ask-input aria-label="Ask sua"></textarea>
    <button type="submit" class="btn btn--primary btn--sm home-ask__send" data-home-ask-send>Send ↵</button>
  </form>
</div>`}
${/* Home has its own question box (and ⌘K everywhere): one place to ask on a page. */ ''}
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

/**
 * The top bar's links: Answers (what you asked sua to find out) and Settings,
 * then More for the rest (Agents, Experiments, Pulse, Help). The brand is
 * Home. More shows as current on any page under it.
 */
export function topbarNav(active: string | undefined): SafeHtml {
  const agents = active === 'agents' || active === 'tools' || active === 'nodes' || active === 'runs' || active === 'packs';
  const more: Array<{ href: string; label: string; hint: string; on: boolean }> = [
    { href: '/agents', label: 'Agents', hint: 'The agents that do the work: their runs, tools and schedules', on: agents },
    { href: '/experiments', label: 'Experiments', hint: 'Compare versions of an agent or an answer side by side', on: active === 'experiments' },
    { href: '/pulse', label: 'Pulse', hint: 'Every agent run, as it happens', on: active === 'pulse' },
    { href: '/help', label: 'Help', hint: 'What sua is and how it works', on: active === 'help' },
  ];
  const moreOn = more.some((m) => m.on);
  return html`<nav class="topbar__nav">
    <a href="/notebooks" class="${active === 'notebooks' ? 'is-active' : ''}">Answers</a>
    <a href="/settings" class="${active === 'settings' ? 'is-active' : ''}">Settings</a>
    <details class="topbar__more" data-topbar-more>
      <summary class="${moreOn ? 'is-active' : ''}">More${moreOn ? html`<span class="topbar__more-now"> · ${more.find((m) => m.on)!.label}</span>` : html``}</summary>
      <div class="topbar__more-panel">
        ${more.map((m) => html`<a href="${m.href}" class="${m.on ? 'is-active' : ''}" ${m.on ? html`aria-current="page"` : html``}><span class="topbar__more-label">${m.label}</span><span class="topbar__more-hint">${m.hint}</span></a>`) as unknown as SafeHtml[]}
      </div>
    </details>
  </nav>`;
}
