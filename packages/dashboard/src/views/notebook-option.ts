/**
 * One option's page: its picture, name and price, where it stands (rank,
 * stage, ruled out and why) with the same controls the notebook's cards have,
 * then its widgets (lib/notebook-option.ts): every fact with its source, the
 * price over time, its checks and its history.
 */
import { sameAddress, type Notebook, type NotebookEntry } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { formatAge } from './components.js';
import { renderSurfaceHost } from '../lib/a2ui-surface.js';
import { notebookOptionMessages, type NotebookOptionData } from '../lib/notebook-option.js';
import { optionStage, priceChangeChip, bodyWithLinks } from './notebooks.js';

/**
 * Talk to sua about this item: the notebook's talk box, aimed at one option.
 * It goes into the notebook's conversation (opening in the sua drawer); the
 * message names the option and sua gets it in focus. Hidden while the drawer
 * is open, as on the notebook's page.
 */
function itemTalk(nb: Notebook, entryId: string, nav?: NotebookOptionData['nav']): SafeHtml {
  const id = encodeURIComponent(nb.id);
  return html`
    <section class="nb-side__card nb-talk" aria-labelledby="nbo-talk-title">
      <h2 class="nb-side__title" id="nbo-talk-title">Talk to sua about this item</h2>
      <form method="POST" action="/notebooks/${id}/ask" class="nb-talk__form" data-ask-fix>
        <input type="hidden" name="option" value="${entryId}">
        <input type="hidden" name="next" value="${nav?.next?.id ?? ''}" data-nbo-talk-next>
        <input type="hidden" name="prev" value="${nav?.prev?.id ?? ''}" data-nbo-talk-prev>
        <label class="nb-talk__next" for="nbo-talk">Ask about it, or correct it: sua knows which one you mean.</label>
        <textarea id="nbo-talk" name="text" required rows="3" class="form-field" placeholder="e.g. is it still available? Or: the price is actually $… Or: next" data-enter-sends aria-describedby="nbo-talk-keys"></textarea>
        <div class="nb-talk__send">
          <span class="nb-talk__keys" id="nbo-talk-keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <button type="submit" class="btn btn--primary btn--sm">Ask sua</button>
        </div>
      </form>
      ${nb.conversationId ? html`<button type="button" class="btn btn--sm btn--ghost nb-talk__continue" data-nb-continue="${nb.conversationId}">Continue the conversation</button>` : html``}
    </section>`;
}

/**
 * Previous / Next among those in the running, best first (← / → keys too).
 * The order goes along as data; assets/option-nav.js narrows it to the
 * filters chosen on the notebook's grid.
 */
function optionNav(e: NotebookEntry, nav: NotebookOptionData['nav']): SafeHtml {
  if (!nav || nav.order.length < 2) return html``;
  const link = (which: 'prev' | 'next', o?: NonNullable<typeof nav>['next']) => html`
    <a class="btn btn--sm btn--ghost nbo-nav__step" rel="${which}" data-nbo-${which} href="${o?.page ?? '#'}" ${o ? html`title="${which === 'prev' ? 'Previous' : 'Next'}: ${o.name}"` : html`hidden`}>${which === 'prev' ? '← ' : ''}<span class="nbo-nav__name" data-nbo-name>${o ? `#${String(o.rank)} ${o.name}` : ''}</span>${which === 'next' ? ' →' : ''}</a>`;
  const rank = nav.order.findIndex((o) => o.id === e.id) + 1;
  // JSON inside <script>: "<" can't close it.
  const json = JSON.stringify({ id: e.id, order: nav.order, filters: nav.filters, filterKey: nav.filterKey }).replace(/</g, '\\u003c');
  return html`
    <nav class="nbo-nav" data-nbo-nav aria-label="Other options">
      ${link('prev', nav.prev)}
      <span class="nbo-nav__pos" data-nbo-pos>${String(rank)} of ${String(nav.order.length)}</span>
      ${link('next', nav.next)}
      <script type="application/json" data-nbo-order>${unsafeHtml(json)}</script>
    </nav>
    <script type="module" src="/assets/option-nav.js"></script>`;
}

function standing(nb: Notebook, e: NotebookEntry, d: NotebookOptionData['option']): SafeHtml {
  if (e.ruledOut) return html``;
  const rankF = nb.fields.find((f) => f.role === 'score') ?? nb.fields.find((f) => f.role === 'price');
  if (d.rank === undefined) return html``;
  const best = d.rank === 1 && d.active > 1;
  return html`<span class="nbo-rank${best ? ' nbo-rank--best' : ''}">${best ? `best ${(rankF?.label ?? 'price').toLowerCase()}` : `#${String(d.rank)} of ${String(d.active)}`}</span>`;
}

/**
 * Merge with…: another option that's the same one (a listing found twice,
 * a company two agents named differently) becomes part of this one. The
 * likely ones (same address, same name or organization) are listed first.
 */
function mergeForm(nb: Notebook, e: NotebookEntry, others: readonly NotebookEntry[]): SafeHtml {
  if (!others.length) return html``;
  const linkF = nb.fields.find((f) => f.role === 'link');
  const orgF = nb.fields.find((f) => f.role === 'org');
  const addr = (x: NotebookEntry) => { const v = linkF ? x.data?.[linkF.key] : undefined; return typeof v === 'string' ? sameAddress(v) : undefined; };
  const org = (x: NotebookEntry) => { const v = orgF ? x.data?.[orgF.key] : undefined; return typeof v === 'string' ? v.trim().toLowerCase() : undefined; };
  // The title's lead, up to its first comma, colon, dash or bracket ("2010 RAV4", "Pigment").
  const name = (x: NotebookEntry) => (x.title.split(/\s*(?:,|:|\(|\s[-–—]\s)/)[0] ?? '').trim().toLowerCase();
  const likely = (x: NotebookEntry) => (!!addr(e) && addr(x) === addr(e)) || (!!org(e) && org(x) === org(e)) || name(x) === name(e);
  const sorted = [...others].sort((a, b) => Number(likely(b)) - Number(likely(a)) || Number(!!a.ruledOut) - Number(!!b.ruledOut) || a.title.localeCompare(b.title));
  return html`<details class="nbo-merge">
    <summary class="btn btn--sm btn--ghost">Merge with…</summary>
    <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/entries/${e.id}/merge" class="nbo-merge__form">
      <label class="nbo-merge__label" for="nbo-merge-copy">The same one as this, found again? Its facts fill in what this one is missing, its checks and history come along, and it goes.</label>
      <select id="nbo-merge-copy" name="copy" class="form-field" required>
        <option value="">Pick the copy…</option>
        ${sorted.map((x) => html`<option value="${x.id}">${likely(x) ? '★ ' : ''}${x.title.slice(0, 90)}${x.ruledOut ? ' (ruled out)' : ''}</option>`) as unknown as SafeHtml[]}
      </select>
      <button type="submit" class="btn btn--sm btn--primary">Merge into this one</button>
    </form>
  </details>`;
}

export function renderNotebookOptionPage(args: { nb: Notebook; entry: NotebookEntry; data: NotebookOptionData; others?: readonly NotebookEntry[]; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  const { nb, entry: e, data } = args;
  const o = data.option.view;
  const nbHref = `/notebooks/${encodeURIComponent(nb.id)}`;
  const listing = nb.fields.find((f) => f.role === 'link');
  const messages = notebookOptionMessages(nb, data);
  const by = e.by === 'you' ? 'you' : e.by.replace(/^(agent|run):/, '');
  const seenAgain = o.lastSeenAt.slice(0, 16) !== o.firstSeenAt.slice(0, 16);
  return render(layout({ title: `${o.name} · ${nb.title}`, activeNav: 'inbox', flash: args.flash, wide: true }, html`
    <div class="nbo-top">
      <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a> › <a href="${nbHref}">${nb.title}</a></p>
      ${optionNav(e, data.nav)}
    </div>
    <section class="nbo-hero${e.ruledOut ? ' nbo-hero--out' : ''}" aria-labelledby="nbo-title" data-nb-option="${e.id}" data-nb-option-notebook="${nb.id}">
      <div class="nbo-hero__pic">
        ${o.image
          ? html`<img src="${o.image}" alt="" class="${o.imageKind === 'illustration' ? 'is-drawn' : ''}">${o.imageKind && o.imageKind !== 'listing' ? html`<span class="nbo-hero__pickind">${o.imageKind === 'illustration' ? 'illustration' : 'example photo'}</span>` : html``}`
          : html`<span class="nbo-hero__nopic">No photo yet</span>`}
      </div>
      <div class="nbo-hero__main">
        <div class="nbo-hero__titlerow">
          <h1 class="nbo-hero__title" id="nbo-title">${o.name}</h1>
          ${standing(nb, e, data.option)}
        </div>
        ${o.title !== o.name ? html`<p class="nbo-hero__full">${o.title}</p>` : html``}
        ${data.option.priceNow ? html`<div class="nbo-hero__price">${data.option.priceNow}${o.priceChange ? html` ${priceChangeChip(nb, o.priceChange)}` : html``}</div>` : html``}
        ${optionStage(nb, e, { back: 'option' })}
        <div class="nbo-hero__links">
          ${o.link ? (o.linkIsList
            ? html`<a class="btn btn--sm btn--ghost" href="${o.link}" target="_blank" rel="noopener noreferrer" title="Where it was found: a search page that lists many, not this one's own">Search page ↗</a>`
            : html`<a class="btn btn--sm" href="${o.link}" target="_blank" rel="noopener noreferrer">${listing?.label ?? 'Listing'} ↗</a>`) : html``}
          <a class="btn btn--sm btn--ghost" href="${nbHref}">← Back to the notebook</a>
          ${mergeForm(nb, e, args.others ?? [])}
        </div>
        <p class="nbo-hero__meta">${e.by === 'you' ? 'added by you' : `found by ${by}`} ${formatAge(o.firstSeenAt)}${seenAgain ? ` · seen again ${formatAge(o.lastSeenAt)}` : ''}${o.notSeenLately && !e.ruledOut ? ` · not in the last ${String(o.missedSearches)} searches` : ''}</p>
      </div>
    </section>
    <div class="nb-body nbo-layout">
      <div class="nb-body__main">
        ${e.body && e.body.trim() !== e.title.trim() ? html`<p class="nbo-body">${bodyWithLinks(e.body)}</p>` : html``}
        <div class="nbo-widgets">${messages ? renderSurfaceHost(`option-${nb.id}-${e.id}`, messages, { label: `${o.name}: details` }) : html``}</div>
      </div>
      <aside class="nb-body__side">${itemTalk(nb, e.id, data.nav)}</aside>
    </div>
  `));
}
