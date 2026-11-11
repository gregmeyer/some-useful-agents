/**
 * Home's Next up (lib/home-next.ts): the first item set as the lead, the
 * rest as plain rows, each with the one button that does it and "Not now".
 * Housekeeping is the same rows, folded.
 */
import { html, type SafeHtml } from './html.js';
import type { HomeNext, NextItem } from '../lib/home-next.js';

/** The one button: run it, fill Ask sua, open the conversation in the panel, or open a page. */
function act(item: NextItem, primary: boolean): SafeHtml {
  const cls = `btn btn--sm${primary ? ' btn--primary' : ''}`;
  const a = item.action;
  if (a.post) return html`<form method="POST" action="${a.post}" class="home-next__run" data-try-run><button type="submit" class="${cls}">${a.label}</button></form>`;
  if (a.fill) return html`<button type="button" class="${cls}" data-ask-fill="${a.fill}" title="Puts “${a.fill}” in Ask sua for you to finish">${a.label}</button>`;
  if (a.thread) return html`<a class="${cls}" href="/inbox/${encodeURIComponent(a.thread)}" data-panel-thread-id="${a.thread}">${a.label}</a>`;
  return html`<a class="${cls}" href="${a.href ?? '#'}">${a.label}</a>`;
}

function notNow(item: NextItem): SafeHtml {
  return html`<form method="POST" action="/home/next/dismiss" class="home-next__later" data-next-dismiss><input type="hidden" name="id" value="${item.id}"><button type="submit" class="home-next__later-btn" title="Hide this for a week" aria-label="Not now: ${item.title}">Not now</button></form>`;
}

function lead(item: NextItem): SafeHtml {
  return html`
    <article class="home-next__lead" data-next-item="${item.id}" data-next-kind="${item.kind}">
      <h3 class="home-next__lead-title">${item.title}</h3>
      <p class="home-next__why">${item.why}</p>
      <div class="home-next__acts">${act(item, true)}${item.open ? html`<a class="btn btn--sm btn--ghost" href="${item.open.href}">${item.open.label}</a>` : html``}${notNow(item)}</div>
    </article>`;
}

function row(item: NextItem): SafeHtml {
  return html`
    <li class="home-next__row" data-next-item="${item.id}" data-next-kind="${item.kind}">
      <div class="home-next__text"><span class="home-next__title">${item.title}</span><span class="home-next__why">${item.why}</span></div>
      <div class="home-next__acts">${act(item, false)}${notNow(item)}</div>
    </li>`;
}

/** Next up's body, for the page and its refresh (GET /home/next). Empty when there's nothing to offer. */
export function renderNextBody(n: HomeNext): SafeHtml {
  if (!n.next.length) return html``;
  const [first, ...rest] = n.next;
  return html`${lead(first)}${rest.length ? html`<ul class="home-next__rows">${rest.map(row) as unknown as SafeHtml[]}</ul>` : html``}`;
}

export function renderNextUp(n: HomeNext): SafeHtml {
  return html`
    <section class="home-next" aria-labelledby="home-next-title" data-home-next${n.next.length ? '' : ' hidden'}>
      <h2 class="home-today__title" id="home-next-title">Next up</h2>
      <div data-home-next-body>${renderNextBody(n)}</div>
    </section>`;
}

/** Housekeeping's body: the clean-up rows. */
export function renderTidyBody(n: HomeNext): SafeHtml {
  return n.tidy.length ? html`<ul class="home-next__rows">${n.tidy.map(row) as unknown as SafeHtml[]}</ul>` : html``;
}

export function tidySummary(n: HomeNext): string {
  return `${String(n.tidy.length)} thing${n.tidy.length === 1 ? '' : 's'} to tidy`;
}

export function renderHousekeeping(n: HomeNext): SafeHtml {
  return html`
    <details class="home-tidy" data-home-tidy${n.tidy.length ? '' : ' hidden'}>
      <summary class="home-tidy__summary"><span class="home-today__title">Housekeeping</span> <span class="home-tidy__count" data-home-tidy-count>${tidySummary(n)}</span></summary>
      <div data-home-tidy-body>${renderTidyBody(n)}</div>
    </details>`;
}
