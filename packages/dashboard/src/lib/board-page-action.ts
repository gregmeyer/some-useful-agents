/**
 * sua's "Compose the page" card (`board-page`) from a board's conversation
 * (ADR-0070): what the person asked for the page, in their words (ASK), on
 * the board they're on (BOARD). The card says what will happen; applying it
 * has the board-page agent draw the page against the board as it is now,
 * saved as a new version (Undo last save puts the layout before it back).
 */
import type { InboxActionMeta, InboxActionStatus } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { boardsOf, decideBoardPage } from './board-page.js';
import { boardHref } from './board-arrange.js';

type Ctx = ReturnType<typeof getContext>;

/** The card's preview: the board it changes and what was asked, stamped with the board's version. */
export function previewBoardPage(ctx: Ctx, action: InboxActionMeta): InboxActionMeta {
  const board = boardsOf(ctx).loadOrDerive(action.inputs.BOARD ?? '');
  if (!board) return action;
  const ask = (action.inputs.ASK ?? '').trim();
  return {
    ...action,
    base: { version: board.derived ? 0 : board.version, yaml: '' },
    surfaceChanges: [{ what: 'page', before: board.layoutMeta ? `composed${board.layoutMeta.preset ? ` (${board.layoutMeta.preset})` : ''}` : 'a grid of tiles', after: `composed as asked: “${ask.slice(0, 120)}”` }],
    inputs: { ...action.inputs, BOARD_NAME: board.name },
  };
}

export async function executeBoardPage(ctx: Ctx, meta: InboxActionMeta): Promise<{ status: InboxActionStatus; summary?: string; refusalReason?: string }> {
  const boardId = meta.inputs.BOARD ?? '';
  const board = boardsOf(ctx).loadOrDerive(boardId);
  if (!board) return { status: 'failed', refusalReason: 'That board is gone.' };
  const version = board.derived ? 0 : board.version;
  if (meta.base && meta.base.version !== version) {
    return { status: 'failed', refusalReason: 'The board changed since this was proposed. Ask again to get a page against what it shows now.' };
  }
  const ask = (meta.inputs.ASK ?? '').trim();
  if (!ask) return { status: 'failed', refusalReason: 'There was nothing asked for the page.' };
  const link = `[${board.name}](${boardHref(boardId)})`;
  const out = await decideBoardPage(ctx, boardId, { request: ask });
  if (out === 'drawn') return { status: 'completed', summary: `Composed ${link}'s page as you asked. Undo last save on the board puts the layout before it back.` };
  if (out === 'kept') return { status: 'completed', summary: `${link} keeps its grid of tiles: that's what reads best for what you asked.` };
  if (out === 'skipped') return { status: 'failed', refusalReason: 'sua is already working on that board\'s page, or it changed meanwhile.' };
  return { status: 'failed', refusalReason: 'sua couldn\'t draw a page that checks out; the board is as it was.' };
}
