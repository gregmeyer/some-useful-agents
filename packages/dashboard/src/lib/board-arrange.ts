/**
 * Arranging a board from a conversation: sua proposes board ops (the same
 * vocabulary as ✎ Arrange's board-place tool) as an `arrange-board` card.
 * This reads them, says in plain words what goes, moves or arrives, and
 * applies them through board-place, so the change is a new board version
 * the person can undo, refused if the board changed since the card.
 */
import {
  BoardsStore, applyBoardOps, boardOpSchema, boardDocAgentIds, getBuiltinTool,
  type BoardOp,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;
type Doc = NonNullable<ReturnType<BoardsStore['loadDocOrDerive']>>['doc'];

export const boardsOf = (ctx: Ctx) => new BoardsStore(ctx.runStore.databaseHandle());

/** Where a board lives: Pulse at /pulse, the rest under /dashboards. */
export const boardHref = (id: string) => (id === 'pulse' ? '/pulse' : `/dashboards/${encodeURIComponent(id)}`);

/** OPS as sua sends it: a JSON array of board ops (or one op). */
export function parseBoardOps(raw: string): { ops?: BoardOp[]; error?: string } {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { error: 'OPS is not JSON.' }; }
  const list = Array.isArray(v) ? v : [v];
  if (list.length === 0) return { error: 'OPS is empty.' };
  if (list.length > 40) return { error: 'At most 40 board ops at a time.' };
  const ops: BoardOp[] = [];
  for (const [i, o] of list.entries()) {
    const p = boardOpSchema.safeParse(o);
    if (!p.success) return { error: `Board op ${String(i + 1)} isn't valid: ${p.error.issues[0]?.message ?? 'unknown shape'}.` };
    ops.push(p.data);
  }
  return { ops };
}

/** A readable name for a node on the board. */
function labeler(boards: BoardsStore, doc: Doc): (id: string) => string {
  const byId = new Map(doc.components.map((c) => [String(c.id), c as Record<string, unknown>]));
  return (id: string) => {
    const c = byId.get(id);
    if (!c) return id;
    if (c.component === 'AgentTile' && typeof c.agentId === 'string') return `the ${boards.tileTitle(c.agentId) ?? c.agentId} tile`;
    if (c.component === 'SystemTile' && typeof c.tileId === 'string') return `the ${c.tileId} tile`;
    const title = typeof c.title === 'string' ? c.title : typeof c.text === 'string' ? c.text : '';
    return title ? `${String(c.component).toLowerCase()} “${title.slice(0, 40)}”` : `a ${String(c.component).toLowerCase()}`;
  };
}

function describeOp(op: BoardOp, label: (id: string) => string, boards: BoardsStore): { what: string; before: string; after: string } {
  switch (op.op) {
    case 'remove': return { what: 'Remove', before: '—', after: label(op.id) };
    case 'move': return { what: 'Move', before: '—', after: `${label(op.id)} into ${label(op.parent)}${op.index !== undefined ? `, position ${String(op.index + 1)}` : ''}` };
    case 'insert': {
      const n = op.node as { type?: string; agentId?: string; title?: string; text?: string };
      const what = n.type === 'tile' && n.agentId ? `the ${boards.tileTitle(n.agentId) ?? n.agentId} tile` : `a ${n.type ?? 'node'}${n.title ? ` “${n.title}”` : ''}`;
      return { what: 'Add', before: '—', after: `${what} to ${label(op.parent)}` };
    }
    case 'set': return { what: 'Change', before: '—', after: `${label(op.id)}: ${Object.keys(op.props ?? {}).join(', ')}` };
    case 'wrap': return { what: 'Wrap', before: '—', after: `${label(op.id)} in a ${op.in}` };
    case 'unwrap': return { what: 'Unwrap', before: '—', after: label(op.id) };
    case 'span': return { what: 'Resize', before: '—', after: `${label(op.id)}${op.span ? ` to ${String(op.span)} wide` : ''}${op.rows ? ` × ${String(op.rows)} tall` : ''}` };
    default: return { what: 'Change', before: '—', after: JSON.stringify(op).slice(0, 80) };
  }
}

/**
 * What applying `ops` would do, without saving: each op in plain words, then
 * the tile count before → after. Throws when the ops don't apply.
 */
export function previewBoardChange(boards: BoardsStore, boardId: string, ops: BoardOp[]): { version: number; name: string; changes: Array<{ what: string; before: string; after: string }> } {
  const cur = boards.loadDocOrDerive(boardId);
  if (!cur) throw new Error(`There's no board "${boardId}".`);
  const next = applyBoardOps(cur.doc, ops).doc;
  const label = labeler(boards, cur.doc);
  const changes = ops.map((op) => describeOp(op, label, boards));
  const before = boardDocAgentIds(cur.doc).length;
  const after = boardDocAgentIds(next).length;
  if (before !== after) changes.push({ what: 'Tiles', before: String(before), after: String(after) });
  return { version: cur.version, name: cur.name, changes };
}

/** The board's outline with ids (board-read's text), for triage. */
export async function boardOutlineFor(ctx: Ctx, boardId: string): Promise<string> {
  const out = await getBuiltinTool('board-read')!.execute({ board: boardId }, { boards: boardsOf(ctx) } as never);
  return out.isError ? '' : String(out.result ?? '').split('\n\n')[0].slice(0, 6000);
}

/** Apply through board-place: one new board version, refused if it changed since `version`. */
export async function applyBoardChange(ctx: Ctx, boardId: string, ops: BoardOp[], version?: number): Promise<{ ok: boolean; text: string }> {
  const out = await getBuiltinTool('board-place')!.execute({ board: boardId, ops, ...(version !== undefined ? { version } : {}) }, { boards: boardsOf(ctx) } as never);
  return { ok: !out.isError, text: String(out.result ?? '') };
}
