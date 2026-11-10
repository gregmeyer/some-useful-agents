/**
 * Redraw a notebook's TL;DR picture: the picture as it is now, how it's
 * drawn, a box to say how you'd like it ("for LinkedIn", "more editorial"),
 * starters that ask with one press, and Undo / Back to the standard picture.
 * While sua chooses, a working panel; the page reloads itself when it's done.
 */
import { TLDR_SIZES, type Notebook, type TldrSpec } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { working } from './working.js';
import type { TldrRedrawState } from '../lib/notebook-tldr-redraw.js';

/** Things to ask for with one press: the button's words, and what it asks. */
export const TLDR_STARTERS = [
  { label: 'For LinkedIn', ask: 'Make it suitable for sharing on LinkedIn' },
  { label: 'More editorial', ask: 'Make it more editorial' },
  { label: 'Lead with the photo', ask: 'Lead with the photo: make the picture the main thing' },
  { label: 'Be more creative', ask: 'Be more creative' },
  { label: 'Just the numbers', ask: 'Simpler: just the numbers and the bars' },
] as const;

/** How a spec is drawn, in a line ("Landscape 1200×627 · editorial · words beside the bars"). */
export function tldrSpecWords(spec: TldrSpec | undefined): string {
  if (!spec) return 'The standard picture: as tall as it needs, plain, everything in one column.';
  const size = TLDR_SIZES[spec.size];
  const lay = { stack: 'one column', split: 'words beside the bars or points', hero: 'one thing very large', cover: 'the picture across the top', lineup: 'the top options as pictures side by side', spotlight: 'the picture down one side' }[spec.layout];
  return `${size.name}${size.height ? ` ${String(size.width)}×${String(size.height)}` : ''} · ${spec.tone} · ${lay}${spec.headline ? ' · with a headline' : ''}`;
}

export function renderTldrRedraw(args: { nb: Notebook; state?: TldrRedrawState; undos: number; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  const { nb, state } = args;
  const id = encodeURIComponent(nb.id);
  const spec = nb.tldr;
  const busy = state?.status === 'working';
  // A new address each time it's drawn differently, so the browser doesn't show the one before.
  const v = encodeURIComponent(spec?.at ?? 'standard');
  const form = (path: string, label: string, cls = 'btn btn--sm') => html`<form method="POST" action="/notebooks/${id}/tldr/${path}"><button type="submit" class="${cls}" ${busy ? unsafeHtml('disabled') : unsafeHtml('')}>${label}</button></form>`;
  return render(layout({ title: `TL;DR picture · ${nb.title}`, activeNav: 'notebooks', flash: args.flash, wide: true }, html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Notebooks', href: '/notebooks' }, { label: nb.title, href: `/notebooks/${id}` }, { label: 'TL;DR picture' }],
      title: 'The TL;DR picture',
      description: 'One picture that sums the notebook up, to share. Say how you want it drawn; its names, numbers and bars always come from the notebook.',
    })}
    <div class="nbt"${busy ? unsafeHtml(` data-nbt-working="/notebooks/${id}/tldr/state"`) : unsafeHtml('')}>
      <figure class="nbt__pic">
        <img src="/notebooks/${id}/tldr.png?v=${v}" alt="The TL;DR picture of ${nb.title}" data-nbt-img="/notebooks/${id}/tldr.html">
      </figure>
      <div class="nbt__side">
        <section class="nbt__now" aria-labelledby="nbt-now-h">
          <h2 class="nbt__h" id="nbt-now-h">How it's drawn</h2>
          <p class="nbt__spec">${tldrSpecWords(spec)}</p>
          ${spec?.about ? html`<p class="nbt__about">${spec.about}</p>` : html``}
          ${spec?.ask ? html`<p class="nbt__asked">You asked: “${spec.ask}”</p>` : html``}
        </section>
        ${busy ? working({ size: 'panel', title: 'sua is redrawing the picture', said: state.ask, text: 'Choosing its size, tone and layout, and what to lead with. Usually under a minute. You can leave this page: the picture changes when it\'s done.', since: state.since }) : html``}
        ${state?.status === 'failed' ? html`<p class="flash flash--error" role="alert">${state.error ?? 'sua couldn\'t redraw it.'} The picture is as it was.</p>` : html``}
        <section class="nbt__ask" aria-labelledby="nbt-ask-h">
          <h2 class="nbt__h" id="nbt-ask-h">Redraw it</h2>
          <form method="POST" action="/notebooks/${id}/tldr/redraw" class="nbt__form">
            <label class="sr-only" for="nbt-ask">How should it be drawn?</label>
            <textarea id="nbt-ask" name="ask" rows="2" maxlength="300" required class="form-field" placeholder="e.g. make it suitable for sharing on LinkedIn" ${busy ? unsafeHtml('disabled') : unsafeHtml('')}></textarea>
            <button type="submit" class="btn btn--primary btn--sm" ${busy ? unsafeHtml('disabled') : unsafeHtml('')}>Redraw</button>
          </form>
          <form method="POST" action="/notebooks/${id}/tldr/redraw" class="nbt__starters" aria-label="Or start with">
            ${TLDR_STARTERS.map((x) => html`<button type="submit" name="ask" value="${x.ask}" class="nbd-chip nbd-chip--add" title="${x.ask}" ${busy ? unsafeHtml('disabled') : unsafeHtml('')}>${x.label}</button>`) as unknown as SafeHtml[]}
          </form>
          <p class="nbt__hint">sua chooses from a set of sizes, tones and layouts and may write a headline. It never changes a number.</p>
        </section>
        <section class="nbt__acts" aria-label="This picture">
          <a class="btn btn--sm" href="/notebooks/${id}/tldr.png?download=1&amp;v=${v}" download>Download PNG</a>
          <a class="btn btn--sm btn--ghost" href="/notebooks/${id}/tldr.png?v=${v}" target="_blank" rel="noopener">Open ↗</a>
          ${args.undos ? form('undo', 'Undo') : html``}
          ${spec ? form('reset', 'Back to the standard picture', 'btn btn--sm btn--ghost') : html``}
        </section>
      </div>
    </div>
    ${unsafeHtml(`<script>(function(){
      var img=document.querySelector('[data-nbt-img]');
      // No browser on this machine to make the PNG: show the card as a page instead.
      if(img)img.addEventListener('error',function(){var f=document.createElement('iframe');f.className='nbt__frame';f.title=img.alt;f.src=img.getAttribute('data-nbt-img');img.replaceWith(f);});
      var w=document.querySelector('[data-nbt-working]');
      if(!w)return;var url=w.getAttribute('data-nbt-working');
      var t=setInterval(function(){fetch(url,{credentials:'same-origin',headers:{Accept:'application/json'}}).then(function(r){return r.json();}).then(function(j){if(j.status!=='working'){clearInterval(t);location.reload();}}).catch(function(){});},2000);
    })();</script>`)}
  `));
}
