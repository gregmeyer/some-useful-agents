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
import { formatAge } from './components.js';
import type { HomeSurface } from '../lib/home-surface.js';
import type { AskStarters, HomeSuggestions, SuggestedAgent } from '../lib/home-suggestions.js';

/** "2 need you" / "Nothing needs you": the line beside the title. */
export function homeStatus(today: HomeSurface | undefined): { text: string; needs: number } {
  const needs = today?.compiled.regions.find((r) => r.id === 'needs-you');
  const n = (needs?.entries.length ?? 0) + (needs?.more ?? 0);
  return { needs: n, text: n ? `${String(n)} need${n === 1 ? 's' : ''} you` : 'Nothing needs you' };
}

/** Today on its own, for Home's refresh (GET /home/today). (Questions for sua are in the Ask sua card under it.) */
export function renderHomeToday(today: HomeSurface | undefined): SafeHtml {
  return today
    ? renderToday(today, false, html``)
    : html`<p class="panel-home__empty">Today couldn't be read just now. <a href="/inbox">Open the inbox</a>.</p>`;
}

/** Try next: agents you can run in one click, then questions to ask sua. */
/** Why Try next suggests it, with when it last ran. */
function tryWhy(a: SuggestedAgent): string {
  const when = a.lastRunAt ? `last ran ${formatAge(a.lastRunAt)}` : 'not run yet';
  if (a.why === 'go-to') return `Your go-to · ${when}`;
  if (a.why === 'recent') return `You used it this week · ${when}`;
  if (a.why === 'tutorial') return 'A tutorial example · not run yet';
  return 'New to you · not run yet';
}

function renderTryNext(s: HomeSuggestions): SafeHtml {
  return html`
    <section class="home-try" aria-labelledby="home-try-title">
      <h2 class="home-rail__title" id="home-try-title">Try next</h2>
      ${s.agents.length ? html`<ul class="home-try__agents">${s.agents.map((a) => html`
        <li class="home-try__agent">
          <div class="home-try__head">
            <a class="home-try__name" href="/agents/${encodeURIComponent(a.id)}">${a.name}</a>
            <form method="POST" action="/home/try/${encodeURIComponent(a.id)}" class="home-try__run" data-try-run><button type="submit" class="btn btn--sm" aria-label="Run ${a.name}" title="Runs it in a conversation with sua, which tells you what it found">Run</button></form>
          </div>
          ${a.description ? html`<p class="home-try__desc">${a.description}</p>` : html``}
          ${a.runsWith.length
            ? html`<dl class="home-try__with" aria-label="Run uses">${a.runsWith.map((i) => html`<div><dt>${i.label}</dt><dd>${i.value}</dd></div>`) as unknown as SafeHtml[]}</dl>`
            : html`<p class="home-try__none-in">Takes no inputs: Run shows what it does.</p>`}
          <div class="home-try__foot">
            <span class="home-try__when">${tryWhy(a)}</span>
            <button type="button" class="home-try__own" data-ask-send="${a.ownAsk.text}">${a.ownAsk.label} →</button>
          </div>
        </li>`) as unknown as SafeHtml[]}</ul>`
        : html`<p class="home-try__none">No agents to suggest yet. <a href="/agents/new">Build an agent</a> or ask sua for one.</p>`}
    </section>`;
}

/**
 * Ask sua, under Today: a box to run, build, fix or look something up, and
 * starters by verb so it's never empty. A starter fills the box for you to
 * finish (inbox-modal.js.ts [data-ask-fill]); sending opens the answer in
 * the panel, like the bar at the top (the same form contract).
 */
function renderAskCard(starters: readonly AskStarters[]): SafeHtml {
  return html`
    <section class="home-ask-card" aria-labelledby="home-ask-card-title">
      <div class="home-ask-card__head">
        <h2 class="home-today__title" id="home-ask-card-title">Ask sua</h2>
        <span class="home-ask-card__lede">Run, build, fix, or look something up.</span>
      </div>
      <form class="home-ask-card__form" method="POST" action="/inbox/new" data-home-ask>
        <textarea class="home-ask-card__input" name="body" rows="3" data-home-ask-input data-no-draft
          placeholder="e.g. Run Research a topic on local-first databases" aria-label="Ask sua"></textarea>
        <div class="home-ask-card__send">
          <span class="home-ask-card__keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <button type="submit" class="btn btn--primary btn--sm" data-home-ask-send>Send ↵</button>
        </div>
      </form>
      ${starters.length ? html`<div class="home-ask-card__starters" data-ask-starters hidden>${starters.map((row) => html`
        <div class="home-ask-card__row">
          <span class="home-ask-card__verb">${row.verb}</span>
          <div class="ask-pills" role="group" aria-label="${row.verb}">${row.pills.map((p) => html`<button type="button" class="ask-pill" data-ask-fill="${p.text}" title="${p.text}">${p.label}</button>`) as unknown as SafeHtml[]}</div>
        </div>`) as unknown as SafeHtml[]}
      </div>` : html``}
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
        <div class="home-main">
          <section class="home-today" aria-labelledby="home-today-title">
            <div class="home-today__head">
              <h2 class="home-today__title" id="home-today-title">Today</h2>
              <a class="home-today__all" href="/inbox">All conversations →</a>
            </div>
            <div data-home-today>${renderHomeToday(opts.today)}</div>
            <div class="home-today__toast" data-surface-toast hidden></div>
          </section>
          ${renderAskCard(suggestions.starters ?? [])}
        </div>
        <aside class="home-rail" aria-label="Notebooks and things to try">
          ${opts.shelf ?? html``}
          ${renderTryNext(suggestions)}
        </aside>
      </div>
    </div>
  `));
}
