/**
 * Home's "Today's reads" (lib/home-reads.ts): in the rail, above your
 * notebooks. A line per scheduled agent that produced something in the last
 * day; the name opens that run.
 */
import { html, type SafeHtml } from './html.js';
import { formatAge } from './components.js';
import type { HomeRead } from '../lib/home-reads.js';

export function renderHomeReads(reads: readonly HomeRead[]): SafeHtml {
  if (!reads.length) return html``;
  return html`
    <section class="home-reads" aria-labelledby="home-reads-title">
      <div class="nbs__head">
        <h2 class="nbs__title" id="home-reads-title">Today's reads</h2>
        <a class="nbs__all" href="/pulse">Pulse →</a>
      </div>
      <ul class="home-reads__list">${reads.map((r) => html`
        <li class="home-reads__item">
          <span class="home-reads__head"><a class="home-reads__name" href="/runs/${encodeURIComponent(r.runId)}">${r.name}</a><span class="home-reads__when">${formatAge(r.at)}</span></span>
          <span class="home-reads__line">${r.line}</span>
        </li>`) as unknown as SafeHtml[]}</ul>
    </section>`;
}
