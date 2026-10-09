/**
 * One option's page: its picture, name and price, where it stands (rank,
 * stage, ruled out and why) with the same controls the notebook's cards have,
 * then its widgets (lib/notebook-option.ts): every fact with its source, the
 * price over time, its checks and its history.
 */
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
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
function itemTalk(nb: Notebook, entryId: string): SafeHtml {
  const id = encodeURIComponent(nb.id);
  return html`
    <section class="nb-side__card nb-talk" aria-labelledby="nbo-talk-title">
      <h2 class="nb-side__title" id="nbo-talk-title">Talk to sua about this item</h2>
      <form method="POST" action="/notebooks/${id}/ask" class="nb-talk__form" data-ask-fix>
        <input type="hidden" name="option" value="${entryId}">
        <label class="nb-talk__next" for="nbo-talk">Ask about it, or correct it: sua knows which one you mean.</label>
        <textarea id="nbo-talk" name="text" required rows="3" class="form-field" placeholder="e.g. is it still available? Or: the price is actually $…" data-enter-sends aria-describedby="nbo-talk-keys"></textarea>
        <div class="nb-talk__send">
          <span class="nb-talk__keys" id="nbo-talk-keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <button type="submit" class="btn btn--primary btn--sm">Ask sua</button>
        </div>
      </form>
      ${nb.conversationId ? html`<button type="button" class="btn btn--sm btn--ghost nb-talk__continue" data-nb-continue="${nb.conversationId}">Continue the conversation</button>` : html``}
    </section>`;
}

function standing(nb: Notebook, e: NotebookEntry, d: NotebookOptionData['option']): SafeHtml {
  if (e.ruledOut) return html``;
  const rankF = nb.fields.find((f) => f.role === 'score') ?? nb.fields.find((f) => f.role === 'price');
  if (d.rank === undefined) return html``;
  const best = d.rank === 1 && d.active > 1;
  return html`<span class="nbo-rank${best ? ' nbo-rank--best' : ''}">${best ? `best ${(rankF?.label ?? 'price').toLowerCase()}` : `#${String(d.rank)} of ${String(d.active)}`}</span>`;
}

export function renderNotebookOptionPage(args: { nb: Notebook; entry: NotebookEntry; data: NotebookOptionData; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  const { nb, entry: e, data } = args;
  const o = data.option.view;
  const nbHref = `/notebooks/${encodeURIComponent(nb.id)}`;
  const listing = nb.fields.find((f) => f.role === 'link');
  const messages = notebookOptionMessages(nb, data);
  const by = e.by === 'you' ? 'you' : e.by.replace(/^(agent|run):/, '');
  const seenAgain = o.lastSeenAt.slice(0, 16) !== o.firstSeenAt.slice(0, 16);
  return render(layout({ title: `${o.name} · ${nb.title}`, activeNav: 'inbox', flash: args.flash, wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a> › <a href="${nbHref}">${nb.title}</a></p>
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
          ${o.link ? html`<a class="btn btn--sm" href="${o.link}" target="_blank" rel="noopener noreferrer">${listing?.label ?? 'Listing'} ↗</a>` : html``}
          <a class="btn btn--sm btn--ghost" href="${nbHref}">← Back to the notebook</a>
        </div>
        <p class="nbo-hero__meta">${e.by === 'you' ? 'added by you' : `found by ${by}`} ${formatAge(o.firstSeenAt)}${seenAgain ? ` · seen again ${formatAge(o.lastSeenAt)}` : ''}${o.notSeenLately && !e.ruledOut ? ` · not in the last ${String(o.missedSearches)} searches` : ''}</p>
      </div>
    </section>
    <div class="nb-body nbo-layout">
      <div class="nb-body__main">
        ${e.body && e.body.trim() !== e.title.trim() ? html`<p class="nbo-body">${bodyWithLinks(e.body)}</p>` : html``}
        <div class="nbo-widgets">${messages ? renderSurfaceHost(`option-${nb.id}-${e.id}`, messages, { label: `${o.name}: details` }) : html``}</div>
      </div>
      <aside class="nb-body__side">${itemTalk(nb, e.id)}</aside>
    </div>
  `));
}
