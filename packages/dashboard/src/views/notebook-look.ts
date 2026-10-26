/**
 * How a notebook looks, as pictures to pick from (the Edit page), the way
 * Settings → Appearance shows brands: each look is a small drawing of its
 * page, made from the page itself (its rows, their widths, and a mark for
 * each part: a portrait, numbered points, quotes, a grid of options), with
 * a line on what it's for. Picking one puts it in your changes and opens
 * the preview; nothing changes until you save.
 */
import { NOTEBOOK_LAYOUT_PRESETS, type NotebookLayout, type ViewComponent } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

/** What each part looks like, drawn small. */
function glyph(c: ViewComponent | undefined): SafeHtml {
  const lines = (n: number, cls = '') => html`${Array.from({ length: n }, (_, i) => html`<i class="lk-line ${cls}" style="width:${String(92 - ((i * 23) % 40))}%"></i>`) as unknown as SafeHtml[]}`;
  switch (c?.component) {
    case 'ProfileCard': return html`<span class="lk-g lk-g--profile${c.variant === 'cover' ? ' is-cover' : ''}"><i class="lk-face"></i><span>${lines(c.variant === 'cover' ? 3 : 2)}</span></span>`;
    case 'Agenda': return html`<span class="lk-g lk-g--agenda">${[1, 2, 3].map((n) => html`<span class="lk-pt"><b>${String(n)}</b>${lines(1)}</span>`) as unknown as SafeHtml[]}</span>`;
    case 'QuoteList': return html`<span class="lk-g lk-g--quotes"><b class="lk-mark">“</b><span>${lines(3)}</span></span>`;
    case 'OptionGrid': return html`<span class="lk-g lk-g--grid">${Array.from({ length: 6 }, () => html`<i class="lk-box"></i>`) as unknown as SafeHtml[]}</span>`;
    case 'Table': return html`<span class="lk-g lk-g--table">${lines(4, 'is-row')}</span>`;
    case 'Scatter': return html`<span class="lk-g lk-g--map">${[[20, 30], [45, 60], [70, 25], [60, 70], [30, 75]].map(([x, y]) => html`<i class="lk-dot" style="left:${String(x)}%;top:${String(y)}%"></i>`) as unknown as SafeHtml[]}</span>`;
    case 'Funnel': return html`<span class="lk-g lk-g--funnel">${[100, 70, 40].map((w) => html`<i class="lk-bar" style="width:${String(w)}%"></i>`) as unknown as SafeHtml[]}</span>`;
    case 'Timeline': return html`<span class="lk-g lk-g--time">${lines(3)}</span>`;
    case 'Callout': return html`<span class="lk-g lk-g--callout">${lines(2)}</span>`;
    case 'StatStrip': return html`<span class="lk-g lk-g--stats">${Array.from({ length: 4 }, () => html`<i class="lk-box"></i>`) as unknown as SafeHtml[]}</span>`;
    case 'FactSheet': case 'KeyValue': return html`<span class="lk-g lk-g--facts">${lines(3, 'is-ruled')}</span>`;
    case 'Steps': case 'Checklist': return html`<span class="lk-g lk-g--checks">${lines(3, 'is-check')}</span>`;
    case 'ChipList': return html`<span class="lk-g lk-g--chips">${Array.from({ length: 3 }, () => html`<i class="lk-chip"></i>`) as unknown as SafeHtml[]}</span>`;
    default: return html`<span class="lk-g">${lines(2)}</span>`;
  }
}

/**
 * A page drawn small: the header, then its rows (a row of columns keeps its
 * widths), each part marked by what it shows; folded parts are a line.
 * Every part is drawn, whether or not the notebook has its data yet. Pure.
 */
export function lookThumb(components: readonly ViewComponent[]): SafeHtml {
  const byId = new Map(components.map((c) => [c.id, c]));
  const kids = (c: ViewComponent | undefined): string[] => (Array.isArray(c?.children) ? c.children as string[] : typeof c?.child === 'string' ? [c.child] : []);
  const part = (id: string): SafeHtml => {
    const c = byId.get(id);
    if (!c) return html``;
    if (c.component === 'Disclosure') return html`<span class="lk-fold">▸ <i class="lk-line" style="width:50%"></i></span>`;
    if (c.component === 'Panel') {
      const inner = byId.get(String(c.child));
      return html`<span class="lk-part lk-part--${typeof c.treatment === 'string' ? c.treatment : 'plain'}"><i class="lk-title"></i>${inner?.component === 'Column' ? kids(inner).map((k) => glyph(byId.get(k))) as unknown as SafeHtml[] : glyph(inner)}</span>`;
    }
    if (c.component === 'Column') return html`<span class="lk-stack">${kids(c).map(part) as unknown as SafeHtml[]}</span>`;
    return html`<span class="lk-part">${glyph(c)}</span>`;
  };
  const rows = kids(byId.get('root')).map((id) => byId.get(id)).filter((c): c is ViewComponent => !!c && c.component !== 'NotebookHeader').slice(0, 5);
  return html`<span class="lk-thumb" aria-hidden="true">
    <span class="lk-head"><i class="lk-icon"></i><i class="lk-line" style="width:45%"></i></span>
    ${rows.map((r) => {
      if (r.component !== 'Columns') return html`<span class="lk-row">${part(r.id)}</span>`;
      const ks = kids(r);
      const w = ks.map((_, i) => Number((r.widths as number[] | undefined)?.[i] ?? 1));
      return html`<span class="lk-row" style="grid-template-columns:${w.map((n) => `${String(n)}fr`).join(' ')}">${ks.map(part) as unknown as SafeHtml[]}</span>`;
    }) as unknown as SafeHtml[]}
  </span>`;
}

/** What each ready-made look is for, in plain words. */
const LOOK_FOR: Record<string, string> = {
  shortlist: 'For choosing one among many: ranks them, maps them by price, narrows them to a pick.',
  dossier: 'For getting ready to meet someone: who they are, what they said, what to talk about.',
  answer: 'For a question: the answer and how sure, the findings it rests on with their sources, what\'s still open.',
};

export interface LookChoice {
  /** The look it has (saved). */
  now?: NotebookLayout;
  /** The look in your changes, when you changed it (null: the shortlist). */
  changed?: NotebookLayout | null;
  /** Whether sua is working on a change now. */
  working: boolean;
  /** How many saved changes to the look there are to undo. */
  undos: number;
}

/** "How it looks": the look it has, the ready-made ones and "let sua pick", each a picture to click. */
export function notebookLooks(notebookId: string, choice: LookChoice): SafeHtml {
  const id = encodeURIComponent(notebookId);
  const shown = choice.changed === undefined ? choice.now : choice.changed ?? undefined;
  const same = (a: NotebookLayout | undefined, b: NotebookLayout | undefined) => JSON.stringify(a?.components ?? null) === JSON.stringify(b?.components ?? null);
  const presetOf = (l: NotebookLayout | undefined) => (l ? NOTEBOOK_LAYOUT_PRESETS.find((p) => p.id !== 'shortlist' && same(p.layout, l)) : NOTEBOOK_LAYOUT_PRESETS[0]);
  const card = (look: string, name: string, desc: string, thumb: SafeHtml, layout: NotebookLayout | undefined | 'pick') => {
    const isShown = layout !== 'pick' && same(layout, shown);
    const isNow = layout !== 'pick' && same(layout, choice.now);
    const badge = isShown ? (choice.changed !== undefined && !isNow ? 'In your changes' : 'Now') : isNow ? 'Saved' : '';
    return html`<li class="look-card${isShown ? ' is-active' : ''}">
      <form method="POST" action="/notebooks/${id}/edit/look">
        <input type="hidden" name="look" value="${look}">
        <button type="submit" class="look-card__use"${unsafeHtml(isShown || choice.working ? ' disabled' : '')}${unsafeHtml(isShown ? ' aria-current="true"' : '')} aria-label="${isShown ? `${name}, how it looks` : look === 'pick' ? name : `Look like: ${name}`}">
          ${thumb}
          <span class="look-card__name">${name}${badge ? html`<span class="look-card__badge">${badge}</span>` : html``}</span>
          <span class="look-card__desc">${desc}</span>
        </button>
      </form>
    </li>`;
  };
  // Its own (drawn for it), and the one in your changes when that's drawn too: first, as themselves.
  const own = [choice.now, choice.changed ?? undefined].filter((l, i, all): l is NotebookLayout => !!l && !presetOf(l) && all.findIndex((x) => same(x, l)) === i);
  return html`<section class="nbe-looks" aria-labelledby="nbe-looks-title">
    <h2 class="sr-only" id="nbe-looks-title">How it looks</h2>
    ${choice.working ? html`<p class="nbe-looks__working" role="status"><span class="working__spin" aria-hidden="true"></span>sua is working on a change. The preview opens when it's done.</p>` : html``}
    <p class="look-section__lede">Pick one to see it in the preview; nothing changes until you save. To change one part ("put who they are at the top"), say it in Talk.</p>
    <ul class="look-gallery nbe-looks__gallery">
      ${own.map((l) => card(same(l, choice.now) ? 'now' : 'changed', 'Made for this notebook', l.about ? `${l.about.charAt(0).toUpperCase()}${l.about.slice(1)}.` : 'sua drew it for what this notebook is for.', lookThumb(l.components), l)) as unknown as SafeHtml[]}
      ${NOTEBOOK_LAYOUT_PRESETS.map((p) => card(p.id, p.label, LOOK_FOR[p.id] ?? p.when, lookThumb(p.layout.components), p.id === 'shortlist' ? undefined : p.layout)) as unknown as SafeHtml[]}
      ${card('pick', 'Let sua pick', 'sua reads what it\'s for, what it notes and its steps, and draws a page that fits.', html`<span class="lk-thumb lk-thumb--pick" aria-hidden="true"><b>✦</b></span>`, 'pick')}
    </ul>
    ${choice.undos ? html`<form method="POST" action="/notebooks/${id}/layout" class="nbe-looks__undo"><input type="hidden" name="undo" value="1"><button type="submit" class="btn btn--sm btn--ghost">Undo the last saved change to how it looks</button></form>` : html``}
  </section>`;
}
