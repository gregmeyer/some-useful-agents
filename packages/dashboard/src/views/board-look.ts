/**
 * How a board looks (ADR-0070), as pictures to pick from under the board's
 * toolbar, like a notebook's Edit page: the grid of tiles, the front page,
 * "Let sua pick", and the page sua composed for it when that's what it
 * shows. Picking one saves a new version of the board (Undo last save puts
 * the layout before it back).
 */
import { BOARD_LAYOUT_PRESETS, type Board, type ViewComponent } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { lookThumb } from './notebook-look.js';

const LOOK_FOR: Record<string, string> = {
  grid: 'Tiles in sections, each in its own frame: a board to glance over and run things from.',
  'front-page': 'A masthead, the lead story, stories beside a rail of numbers: a board you read every morning.',
};

export interface BoardLookChoice {
  board: Pick<Board, 'layoutMeta'> & { doc: { components: ViewComponent[] } };
  composed: boolean;
  /** Whether sua is working on the page now. */
  working: boolean;
}

/** "How it looks": the look it has, the ready-made ones and "let sua pick", each a picture to click. */
export function boardLooks(boardId: string, choice: BoardLookChoice): SafeHtml {
  const id = encodeURIComponent(boardId);
  const meta = choice.board.layoutMeta;
  const nowPreset = !choice.composed ? 'grid' : meta?.preset;
  const card = (look: string, name: string, desc: string, thumb: SafeHtml, isNow: boolean) => html`<li class="look-card${isNow ? ' is-active' : ''}">
      <form method="POST" action="/boards/${id}/look">
        <input type="hidden" name="look" value="${look}">
        <button type="submit" class="look-card__use"${unsafeHtml(isNow || choice.working ? ' disabled' : '')}${unsafeHtml(isNow ? ' aria-current="true"' : '')} aria-label="${isNow ? `${name}, how it looks` : look === 'pick' ? name : `Look like: ${name}`}">
          ${thumb}
          <span class="look-card__name">${name}${isNow ? html`<span class="look-card__badge">Now</span>` : html``}</span>
          <span class="look-card__desc">${desc}</span>
        </button>
      </form>
    </li>`;
  const own = choice.composed && !nowPreset;
  return html`<details class="board-looks">
    <summary class="board-looks__summary">How it looks${own ? html` <span class="dim">· composed for this board</span>` : nowPreset === 'front-page' ? html` <span class="dim">· front page</span>` : html``}</summary>
    <section class="board-looks__body" aria-label="How it looks">
      ${choice.working ? html`<p class="dim" role="status"><span class="working__spin" aria-hidden="true"></span>sua is working on the page.</p>` : html``}
      <p class="look-section__lede">Pick one; it's saved as a new version of the board (Undo last save puts the layout before it back). To change one part ("put the weather first"), ask sua.</p>
      <ul class="look-gallery board-looks__gallery">
        ${own ? card('own', 'Made for this board', `${meta?.about ? `${meta.about.charAt(0).toUpperCase()}${meta.about.slice(1)}.` : 'sua composed it from what the board is for and what its agents found.'}${meta?.layoutBy === 'you' ? ' As you asked.' : ''}`, lookThumb(choice.board.doc.components), true) : html``}
        ${BOARD_LAYOUT_PRESETS.map((p) => card(p.id, p.label, LOOK_FOR[p.id] ?? p.when, p.id === 'grid' ? gridThumb() : frontPageThumb(), nowPreset === p.id)) as unknown as SafeHtml[]}
        ${card('pick', 'Let sua pick', 'sua reads what the board is for and what its agents found, and composes a page that fits.', html`<span class="lk-thumb lk-thumb--pick" aria-hidden="true"><b>✦</b></span>`, false)}
      </ul>
    </section>
  </details>`;
}

/** The grid, drawn small: a section of four tiles. */
function gridThumb(): SafeHtml {
  return lookThumb([
    { id: 'root', component: 'Column', children: ['s1'] },
    { id: 's1', component: 'Section', title: 'Tiles', child: 'g1' },
    { id: 'g1', component: 'Grid', children: [] },
  ]);
}

/** The front page, drawn small: a masthead, a lede, a 2:1 story and rail, a band. */
function frontPageThumb(): SafeHtml {
  return lookThumb([
    { id: 'root', component: 'Column', children: ['masthead', 'lede', 'top', 'band'] },
    { id: 'masthead', component: 'Panel', title: 'Masthead', child: 'm_t', treatment: 'feature', hero: true },
    { id: 'm_t', component: 'Text', text: 'today' },
    { id: 'lede', component: 'Panel', title: 'Lede', child: 'l_c', treatment: 'lede' },
    { id: 'l_c', component: 'Callout', text: 'the lead story' },
    { id: 'top', component: 'Columns', children: ['story', 'rail'], widths: [2, 1] },
    { id: 'story', component: 'Column', children: ['f1', 'f2'] },
    { id: 'f1', component: 'Panel', title: 'Story', child: 'f1_t', treatment: 'feature' },
    { id: 'f1_t', component: 'AgentTile', agentId: 'a', chrome: 'bare' },
    { id: 'f2', component: 'Panel', title: 'Story', child: 'f2_t', treatment: 'feature' },
    { id: 'f2_t', component: 'AgentTile', agentId: 'b', chrome: 'bare' },
    { id: 'rail', component: 'Column', children: ['a1'] },
    { id: 'a1', component: 'Panel', title: 'Numbers', child: 'a1_l', treatment: 'aside' },
    { id: 'a1_l', component: 'Lead', value: '1', label: 'n' },
    { id: 'band', component: 'Panel', title: 'By the numbers', child: 'b_s', treatment: 'band' },
    { id: 'b_s', component: 'StatStrip', items: [] },
  ]);
}
