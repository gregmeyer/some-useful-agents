/**
 * Home (`/`): a page, not the inbox split (that's /inbox). A slim header with
 * how things stand and a ⋯ menu (autonomy, Adjust Home, the full inbox), then
 * Today full width. A row opens in the sua panel (home-page.js.ts), so the
 * top bar's composer is the one place to ask sua.
 *
 * Plan: ~/.claude/plans/compressed-whistling-valley.md; the notebooks shelf
 * (PR 3) sits between the intro and Today.
 */
import type { AutonomyMode } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageIntro } from './page-intro.js';
import { renderAutonomyControl } from './inbox-page.js';
import { renderToday, renderHomeAdjustPanel } from './home-surface.js';
import type { HomeSurface } from '../lib/home-surface.js';

/** "2 need you" / "Nothing needs you": the line beside the title. */
export function homeStatus(today: HomeSurface | undefined): { text: string; needs: number } {
  const needs = today?.compiled.regions.find((r) => r.id === 'needs-you');
  const n = (needs?.entries.length ?? 0) + (needs?.more ?? 0);
  return { needs: n, text: n ? `${String(n)} need${n === 1 ? 's' : ''} you` : 'Nothing needs you' };
}

/** Today on its own, for Home's refresh (GET /home/today). */
export function renderHomeToday(today: HomeSurface | undefined): SafeHtml {
  return today
    ? renderToday(today, false)
    : html`<p class="panel-home__empty">Today couldn't be read just now. <a href="/inbox">Open the inbox</a>.</p>`;
}

export function renderHomePage(opts: {
  autonomyMode: AutonomyMode;
  today?: HomeSurface;
  /** The notebooks shelf (views/notebook-shelf.ts). */
  shelf?: SafeHtml;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}): string {
  const status = homeStatus(opts.today);
  return render(layout({ title: 'Home', activeNav: 'inbox', flash: opts.flash }, html`
    <div class="home" data-home>
      <header class="home-top">
        <div class="home-top__text">
          <div class="home-top__titlerow">
            <h1 class="home-top__title">Home</h1>
            <span class="home-top__status${status.needs ? ' is-needs' : ''}" data-home-status>${status.text}</span>
          </div>
          ${opts.today ? html`<p class="home-top__goal">${opts.today.goal}</p>` : html``}
        </div>
        <div class="home-top__actions">
          <details class="home-menu">
            <summary class="btn btn--sm btn--ghost home-menu__btn" aria-label="Home settings">⋯</summary>
            <div class="home-menu__panel">
              <section class="home-menu__section">
                <h2 class="home-menu__label">How much sua does on its own</h2>
                ${renderAutonomyControl(opts.autonomyMode)}
              </section>
              ${opts.today ? html`<section class="home-menu__section">
                <h2 class="home-menu__label">Adjust Home</h2>
                ${renderHomeAdjustPanel(opts.today)}
              </section>` : html``}
              <a class="home-menu__link" href="/inbox">Open the full inbox →</a>
            </div>
          </details>
        </div>
      </header>
      ${pageIntro({
        key: 'home',
        text: 'Your agents run on this machine. Home shows what needs you; ask sua anything in the bar above.',
        learnMore: { href: '/help', label: 'What is sua?' },
        actions: [{ href: '/start', label: 'Start here', primary: true }],
      })}
      ${opts.shelf ?? html``}
      <section class="home-today" aria-labelledby="home-today-title">
        <div class="home-today__head">
          <h2 class="home-today__title" id="home-today-title">Today</h2>
          <a class="home-today__all" href="/inbox">All conversations →</a>
        </div>
        <div data-home-today>${renderHomeToday(opts.today)}</div>
        <div class="home-today__toast" data-surface-toast hidden></div>
      </section>
    </div>
  `));
}
