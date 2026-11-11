/**
 * Home (`/`): a page, not the inbox split (that's /inbox). The shared page header (breadcrumb,
 * title with how things stand, autonomy and Adjust Home), then two columns. On the left: what
 * needs you (Today, only when something does), Next up (a few specific things to do next, from
 * your notebooks, agents and conversations), Ask sua, and Housekeeping folded at the foot. On
 * the right: today's reads (what your scheduled agents produced) and your notebooks. A row opens in the sua panel (home-page.js.ts).
 */
import type { AutonomyMode } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageIntro } from './page-intro.js';
import { renderCrumbs } from './page-header.js';
import { renderAutonomyControl } from './inbox-page.js';
import { renderToday, renderHomeAdjust } from './home-surface.js';
import type { HomeSurface } from '../lib/home-surface.js';
import { renderHousekeeping, renderNextUp } from './home-next.js';
import type { AskStarters, HomeSuggestions } from '../lib/home-suggestions.js';
import type { HomeNext } from '../lib/home-next.js';
import { renderHomeReads } from './home-reads.js';
import type { HomeRead } from '../lib/home-reads.js';

/** "2 need you" / "Nothing needs you": the line beside the title. */
export function homeStatus(today: HomeSurface | undefined): { text: string; needs: number } {
  const needs = today?.compiled.regions.find((r) => r.id === 'needs-you');
  const n = (needs?.entries.length ?? 0) + (needs?.more ?? 0);
  return { needs: n, text: n ? `${String(n)} need${n === 1 ? 's' : ''} you` : 'Nothing needs you' };
}

/** Nothing needs you and nothing is happening: Today is only its "All good" line. */
export function todayIsQuiet(today: HomeSurface | undefined): boolean {
  return !!today && today.compiled.regions.filter((r) => r.entries.length > 0).every((r) => r.id === 'all-good');
}

/**
 * Today on its own, for Home's refresh (GET /home/today). On a quiet day it's
 * the one "All good" line: the header already says nothing needs you, and
 * Next up is what the page leads with.
 */
export function renderHomeToday(today: HomeSurface | undefined): SafeHtml {
  return today
    ? renderToday(today, false, todayIsQuiet(today) ? undefined : html``, todayIsQuiet(today))
    : html`<p class="panel-home__empty">Today couldn't be read just now. <a href="/inbox">Open the inbox</a>.</p>`;
}

/**
 * Ask sua, under Next up: a one-line box to run, build, fix or look something
 * up, and ways to start a notebook (your templates, the kinds you make). A
 * starter fills the box for you to finish (inbox-modal.js.ts [data-ask-fill]);
 * sending opens the answer in the panel, like the bar at the top.
 */
function renderAskCard(starters: readonly AskStarters[], offered: ReadonlySet<string> = new Set()): SafeHtml {
  const row = starters.find((r) => r.verb === 'Start');
  // A template Next up already offers isn't offered again right under it.
  const start = row ? { ...row, pills: row.pills.filter((p) => !offered.has(p.text)).slice(0, 3) } : undefined;
  return html`
    <section class="home-ask-card" aria-labelledby="home-ask-card-title">
      <h2 class="home-today__title" id="home-ask-card-title">Ask sua</h2>
      <form class="home-ask-card__form" method="POST" action="/inbox/new" data-home-ask>
        <textarea class="home-ask-card__input" name="body" rows="1" data-home-ask-input data-no-draft
          placeholder="Run, build, fix, or look something up…" aria-label="Ask sua" title="Enter sends · Shift+Enter for a new line"></textarea>
        <button type="submit" class="btn btn--primary btn--sm" data-home-ask-send>Send ↵</button>
      </form>
      ${start?.pills.length ? html`<div class="home-ask-card__starters" data-ask-starters hidden>
        <div class="home-ask-card__row">
          <span class="home-ask-card__verb">Start</span>
          <div class="ask-pills" role="group" aria-label="Start a notebook">${start.pills.map((p) => (p.href
            ? html`<a class="ask-pill" href="${p.href}" title="New notebook: ${p.text}…">${p.label}</a>`
            : html`<button type="button" class="ask-pill" data-ask-fill="${p.text}" title="${p.text}">${p.label}</button>`)) as unknown as SafeHtml[]}</div>
        </div>
      </div>` : html``}
    </section>`;
}

export function renderHomePage(opts: {
  autonomyMode: AutonomyMode;
  today?: HomeSurface;
  /** The notebooks shelf (views/notebook-shelf.ts). */
  shelf?: SafeHtml;
  suggestions?: HomeSuggestions;
  /** Next up and Housekeeping (lib/home-next.ts). */
  next?: HomeNext;
  /** What scheduled agents produced today (lib/home-reads.ts). */
  reads?: readonly HomeRead[];
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}): string {
  const status = homeStatus(opts.today);
  const suggestions = opts.suggestions ?? { starters: [] };
  const next = opts.next ?? { next: [], tidy: [] };
  const quiet = todayIsQuiet(opts.today);
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
        <div class="home-main" data-ask-scope>
          <section class="home-today${quiet ? ' is-quiet' : ''}" aria-labelledby="home-today-title" data-home-today-section>
            <div class="home-today__head">
              <h2 class="home-today__title" id="home-today-title">Today</h2>
              <a class="home-today__all" href="/inbox">All conversations →</a>
            </div>
            <div data-home-today>${renderHomeToday(opts.today)}</div>
            <div class="home-today__toast" data-surface-toast hidden></div>
          </section>
          ${renderNextUp(next)}
          ${renderAskCard(suggestions.starters ?? [], new Set(next.next.map((x) => x.action.fill ?? '')))}
          ${renderHousekeeping(next)}
        </div>
        <aside class="home-rail" aria-label="Today's reads and your notebooks">
          ${renderHomeReads(opts.reads ?? [])}
          ${opts.shelf ?? html``}
        </aside>
      </div>
    </div>
  `));
}
