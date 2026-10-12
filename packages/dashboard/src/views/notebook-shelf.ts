/**
 * Home's notebooks shelf (views/home-page.ts): a card per active notebook
 * with its picture, the best option so far, how far along it is, and a mark
 * when sua is waiting on you there; then + New notebook. Canvas artboard 24.
 */
import { html, type SafeHtml } from './html.js';
import { coverArt } from './notebooks.js';
import type { ShelfCard } from '../lib/notebook-card.js';

const COVER_KIND: Record<string, string> = { listing: 'listing photo', representative: 'example photo', illustration: 'illustration' };

function card(c: ShelfCard): SafeHtml {
  const { nb } = c;
  const met = c.criteria.filter(Boolean).length;
  const facts = [
    c.done ?? '',
    c.options ? `${String(c.options)} option${c.options === 1 ? '' : 's'}, ${String(c.active)} in the running` : `${String(c.entries)} entr${c.entries === 1 ? 'y' : 'ies'}`,
  ].filter(Boolean).join(' · ');
  return html`
    <a class="nbs-card" href="/notebooks/${encodeURIComponent(nb.id)}">
      <span class="nbs-card__cover">
        ${c.cover
          ? html`<img src="${c.cover}" alt="" loading="lazy" class="${c.coverKind === 'illustration' ? 'is-drawn' : ''}">`
          : coverArt(nb)}
        ${c.waiting ? html`<span class="nbs-card__waiting">sua asked you</span>` : html``}
        ${c.cover && c.coverKind ? html`<span class="nbs-card__kind">${COVER_KIND[c.coverKind] ?? ''}</span>` : html``}
      </span>
      <span class="nbs-card__body">
        <span class="nbs-card__title">${nb.title}</span>
        ${c.best
          ? html`<span class="nbs-card__lead"><span class="nbs-card__price">${c.best}</span>${c.bestName ? html`<span class="nbs-card__leadname">${c.bestName}</span>` : html``}</span>`
          : html`<span class="nbs-card__lead nbs-card__lead--none">${nb.statement || 'No options yet'}</span>`}
        <span class="nbs-card__facts">
          ${c.criteria.length ? html`<span class="nbs-dots" aria-label="${`${String(met)} of ${String(c.criteria.length)} done`}">${c.criteria.map((m) => html`<span class="nbs-dot${m ? ' is-met' : ''}"></span>`) as unknown as SafeHtml[]}</span>` : html``}
          <span>${facts}</span>
        </span>
      </span>
    </a>`;
}

export function renderNotebookShelf(shelf: { cards: ShelfCard[]; total: number }): SafeHtml {
  return html`
    <section class="nbs" aria-labelledby="nbs-title">
      <div class="nbs__head">
        <h2 class="nbs__title" id="nbs-title">Your notebooks</h2>
        ${shelf.total ? html`<a class="nbs__all" href="/notebooks">All notebooks${shelf.total > shelf.cards.length ? ` (${String(shelf.total)})` : ''} →</a>` : html``}
      </div>
      <div class="nbs__row">
        ${shelf.cards.map(card) as unknown as SafeHtml[]}
        <a class="nbs-new${shelf.cards.length ? '' : ' nbs-new--alone'}" href="/notebooks/new">
          <span class="nbs-new__plus" aria-hidden="true">+</span>
          <span class="nbs-new__title">New notebook</span>
          <span class="nbs-new__hint">A goal you keep: a car to buy, a job to find, a trip to plan. sua searches and keeps track.</span>
        </a>
      </div>
    </section>`;
}
