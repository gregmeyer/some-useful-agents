/**
 * Home (`/`): a page, not the inbox split (that's /inbox). The shared page header (breadcrumb,
 * title with how things stand, autonomy and Adjust Home), then two columns: Today on the left;
 * your notebooks and Try next (agents to run, questions for sua) on the right. A Today row opens
 * in the sua panel (home-page.js.ts); an ask pill starts a conversation there.
 */
import type { AutonomyMode } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageIntro } from './page-intro.js';
import { renderCrumbs } from './page-header.js';
import { renderAutonomyControl } from './inbox-page.js';
import { renderToday, renderHomeAdjust } from './home-surface.js';
import { renderAskPills } from './ask-pills.js';
import { formatAge } from './components.js';
import type { HomeSurface } from '../lib/home-surface.js';
import type { HomeSuggestions, SuggestedAsk } from '../lib/home-suggestions.js';

/** "2 need you" / "Nothing needs you": the line beside the title. */
export function homeStatus(today: HomeSurface | undefined): { text: string; needs: number } {
  const needs = today?.compiled.regions.find((r) => r.id === 'needs-you');
  const n = (needs?.entries.length ?? 0) + (needs?.more ?? 0);
  return { needs: n, text: n ? `${String(n)} need${n === 1 ? 's' : ''} you` : 'Nothing needs you' };
}

/** Today on its own, for Home's refresh (GET /home/today). Quiet, it offers the ask pills. */
export function renderHomeToday(today: HomeSurface | undefined, asks: readonly SuggestedAsk[] = []): SafeHtml {
  return today
    ? renderToday(today, false, asks.length ? renderAskPills(asks) : undefined)
    : html`<p class="panel-home__empty">Today couldn't be read just now. <a href="/inbox">Open the inbox</a>.</p>`;
}

/** Try next: agents you can run in one click, then questions to ask sua. */
function renderTryNext(s: HomeSuggestions, withAsks: boolean): SafeHtml {
  return html`
    <section class="home-try" aria-labelledby="home-try-title">
      <h2 class="home-rail__title" id="home-try-title">Try next</h2>
      ${s.agents.length ? html`<ul class="home-try__agents">${s.agents.map((a) => html`
        <li class="home-try__agent">
          <a class="home-try__main" href="/agents/${encodeURIComponent(a.id)}">
            <span class="home-try__name">${a.name}</span>
            ${a.description ? html`<span class="home-try__desc">${a.description}</span>` : html``}
            <span class="home-try__when">${a.lastRunAt ? `last ran ${formatAge(a.lastRunAt)}` : 'not run yet'}</span>
          </a>
          <form method="POST" action="/agents/${encodeURIComponent(a.id)}/run" class="home-try__run"><button type="submit" class="btn btn--sm">Run</button></form>
        </li>`) as unknown as SafeHtml[]}</ul>`
        : html`<p class="home-try__none">No agents to suggest yet. <a href="/agents/new">Build an agent</a> or ask sua for one.</p>`}
      ${withAsks && s.asks.length ? html`<h3 class="home-try__label">Ask sua</h3>${renderAskPills(s.asks)}` : html``}
    </section>`;
}

export function renderHomePage(opts: {
  autonomyMode: AutonomyMode;
  today?: HomeSurface;
  /** The notebooks shelf (views/notebook-shelf.ts). */
  shelf?: SafeHtml;
  suggestions?: HomeSuggestions;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}): string {
  const status = homeStatus(opts.today);
  const suggestions = opts.suggestions ?? { agents: [], asks: [] };
  return render(layout({ title: 'Home', activeNav: 'inbox', flash: opts.flash }, html`
    <div class="home" data-home>
      <header class="page-header">
        ${renderCrumbs([{ label: 'Home' }])}
        <h1>Home</h1>
        <span class="page-header__meta home-status${status.needs ? ' is-needs' : ''}" data-home-status>${status.text}</span>
        <div class="page-header__cta">
          ${renderAutonomyControl(opts.autonomyMode, { compact: true })}
          ${opts.today ? renderHomeAdjust(opts.today) : html``}
          <a class="btn btn--sm btn--ghost" href="/inbox">Full inbox</a>
        </div>
        ${opts.today ? html`<p class="page-header__description">${opts.today.goal}</p>` : html``}
      </header>
      ${pageIntro({
        key: 'home',
        text: 'Your agents run on this machine. Home shows what needs you; ask sua anything in the bar above.',
        learnMore: { href: '/help', label: 'What is sua?' },
        actions: [{ href: '/start', label: 'Start here', primary: true }],
      })}
      <div class="home-grid">
        <section class="home-today" aria-labelledby="home-today-title">
          <div class="home-today__head">
            <h2 class="home-today__title" id="home-today-title">Today</h2>
            <a class="home-today__all" href="/inbox">All conversations →</a>
          </div>
          <div data-home-today>${renderHomeToday(opts.today, suggestions.asks)}</div>
          <div class="home-today__toast" data-surface-toast hidden></div>
        </section>
        <aside class="home-rail" aria-label="Notebooks and things to try">
          ${opts.shelf ?? html``}
          ${/* Quiet, the questions are in Today's All clear instead. */ ''}
          ${renderTryNext(suggestions, status.needs > 0)}
        </aside>
      </div>
    </div>
  `));
}
