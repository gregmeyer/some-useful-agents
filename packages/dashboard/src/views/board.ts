import { BOARD_ROW_PX, type Board, type BoardItem } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { renderTile } from './pulse-renderers.js';
import { tileWrap } from './pulse.js';
import { computeTileGroups } from '../lib/pulse-groups.js';
import type { PulseTile } from './pulse-types.js';

/** Escape-first markdown for notes: bold, italic, code, line breaks; no HTML from data. */
function noteHtml(text: string): string {
  const esc = text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  return esc
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
}

function placeStyle(it: BoardItem): string {
  return `grid-column: ${it.x + 1} / span ${it.w}; grid-row: ${it.y + 1} / span ${it.h};`;
}

/**
 * A board: placed items on a 12-column CSS grid (rows of BOARD_ROW_PX), drawn
 * entirely on the server so it renders without JS. For Pulse, agents not
 * placed yet sit in the Unplaced tray below, grouped by recent use.
 */
export function renderBoard(args: {
  board: Board & { derived?: boolean };
  /** Tiles by agent id (and system tile id), for the agent/system items and the tray. */
  tiles: Map<string, PulseTile>;
  /** Pulse only: tiles not placed on the board. */
  unplaced?: PulseTile[];
  systemTileIds?: string[];
  /** Where the tile forms (remove, hide) come back to. Defaults to /boards/<id>. */
  returnTo?: string;
}): SafeHtml {
  const { board, tiles } = args;
  const isPulse = args.unplaced !== undefined;
  const returnTo = args.returnTo ?? `/boards/${encodeURIComponent(board.id)}`;
  const wrapFor = (itemId?: string, palette?: string) => (tile: PulseTile, content: SafeHtml) =>
    tileWrap(tile, content, { kind: 'board', boardId: board.id, isPulse, returnTo, ...(itemId ? { itemId } : {}), ...(palette ? { palette } : {}) });
  const missing = (label: string) => html`<div class="card dim board-missing"><span class="mono">${label}</span> isn't installed. Remove it from the board or install it.</div>`;
  const items = board.items.map((it) => {
    let body: SafeHtml;
    if (it.kind === 'heading') body = html`<h2 class="board-heading">${it.text}</h2>`;
    else if (it.kind === 'note') body = html`<div class="board-note">${unsafeHtml(noteHtml(it.text))}</div>`;
    else {
      const key = it.kind === 'agent' ? it.agentId : it.tileId;
      const tile = tiles.get(key);
      body = tile ? renderTile(tile, wrapFor(it.id, it.palette)) : missing(key);
    }
    return html`<div class="board-item board-item--${it.kind}${it.kind === 'agent' && it.fit === 'scroll' ? ' board-item--scroll' : ''}" data-board-item="${it.id}" style="${placeStyle(it)}">${body}</div>`;
  });
  const tray = args.unplaced && args.unplaced.length
    ? computeTileGroups(
        // Groups take agent tiles plus the ids of the system tiles to head the tray.
        args.unplaced.filter((t) => !(args.systemTileIds ?? []).includes(t.agent.id)),
        (args.systemTileIds ?? []).filter((id) => args.unplaced!.some((t) => t.agent.id === id)),
      ).map((g) => html`
        <section class="board-tray__group" data-tray-group="${g.id}">
          <div class="pulse-container__header"><span class="pulse-container__label">${g.label}</span><span class="pulse-container__count">${String(g.tiles.length)}</span></div>
          <div class="board-tray__grid">${g.tiles.map((id) => tiles.get(id)).filter((t): t is PulseTile => !!t).map((t) => renderTile(t, wrapFor())) as unknown as SafeHtml[]}</div>
        </section>`)
    : [];
  return html`
    <div class="board" data-board-id="${board.id}" data-board-version="${String(board.version)}">
      ${board.items.length
        ? html`<div class="board-grid" style="--board-row: ${String(BOARD_ROW_PX)}px;">${items as unknown as SafeHtml[]}</div>`
        : args.unplaced ? html`<p class="dim board-empty">Nothing placed on this board yet. Everything is in the tray below.</p>` : html`<p class="dim board-empty">This board is empty.</p>`}
      ${tray.length ? html`
        <section class="board-tray" aria-label="Not placed yet">
          <h2 class="board-tray__title">Unplaced <span class="dim">· not on the board yet, by recent use</span></h2>
          ${tray as unknown as SafeHtml[]}
        </section>` : html``}
    </div>`;
}
