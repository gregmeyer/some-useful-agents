import { Router, type Request, type Response } from 'express';
import {
  BOARD_COLUMNS,
  BOARD_ROW_PX,
  BoardConflictError,
  BoardsStore,
  PULSE_BOARD_ID,
  boardItemsFromSections,
  type Agent,
  type AgentSignal,
  type Board,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { html, render, unsafeHtml } from '../views/html.js';
import { layout } from '../views/layout.js';
import { pageHeader } from '../views/page-header.js';
import { renderBoard } from '../views/board.js';
import { buildPulseBoardData } from './pulse.js';
import { buildPulseTile, attachLayoutHints, withTileSignal } from '../views/pulse-tile-builder.js';
import { TEMPLATE_REGISTRY, normalizeSignal } from '../views/pulse-templates.js';
import type { PulseTile } from '../views/pulse-types.js';

/**
 * Boards (W4a, docs/boards.md): read-only for now. `/boards/pulse` is Pulse as
 * a board (placed items + the Unplaced tray); `/boards/<dashboard id>` is a
 * named dashboard, from its saved board or, until one is saved, derived from
 * its sections. Editing (W4b) and agent placement (W4c) build on this.
 */
export const boardsRouter: Router = Router();

const boardsOf = (ctx: ReturnType<typeof getContext>) => new BoardsStore(ctx.runStore.databaseHandle());

/** The size a tile would choose on its own (layout hint → signal → template default). */
function preferredSize(tile: PulseTile | undefined): string | undefined {
  if (!tile) return undefined;
  return tile.layoutHint?.size ?? tile.signal.size ?? TEMPLATE_REGISTRY[normalizeSignal(tile.signal).template]?.defaultSize;
}

export interface ResolvedBoard {
  board: Board & { derived: boolean };
  tiles: Map<string, PulseTile>;
  unplaced?: PulseTile[];
  systemTileIds?: string[];
}

/** A board with the tiles it needs, or undefined when there's no such board. */
export function resolveBoard(ctx: ReturnType<typeof getContext>, id: string): ResolvedBoard | undefined {
  const stored = boardsOf(ctx).get(id);
  if (id === PULSE_BOARD_ID) {
    const data = buildPulseBoardData(ctx);
    const all = [...data.systemTiles, ...data.tiles];
    const tiles = new Map(all.map((t) => [t.agent.id, t]));
    const board = stored ?? { id, name: 'Pulse', packId: null, items: [], version: 0, updatedAt: 0 };
    const placed = new Set(board.items.flatMap((it) => (it.kind === 'agent' ? [it.agentId] : it.kind === 'system' ? [it.tileId] : [])));
    return {
      board: { ...board, derived: !stored },
      tiles,
      unplaced: all.filter((t) => !placed.has(t.agent.id)),
      systemTileIds: data.systemTiles.map((t) => t.agent.id),
    };
  }
  const dashboard = ctx.dashboardsStore?.getDashboard(id);
  if (!dashboard && !stored) return undefined;
  const tiles = new Map<string, PulseTile>();
  const agentIds = new Set<string>();
  for (const s of dashboard?.layout.sections ?? []) s.agentIds.forEach((a) => agentIds.add(a));
  for (const it of stored?.items ?? []) if (it.kind === 'agent') agentIds.add(it.agentId);
  const built: PulseTile[] = [];
  for (const agentId of agentIds) {
    const agent = withTileSignal(ctx.agentStore.getAgent(agentId));
    if (!agent?.signal) continue;
    const tile = buildPulseTile(agent as Agent & { signal: AgentSignal }, { runStore: ctx.runStore });
    built.push(tile);
    tiles.set(agentId, tile);
  }
  attachLayoutHints(built, ctx.layoutHintsStore);
  const board = stored ?? {
    id,
    name: dashboard!.name,
    packId: dashboard!.packId,
    items: boardItemsFromSections(dashboard!.layout.sections, (agentId) => preferredSize(tiles.get(agentId))),
    version: 0,
    updatedAt: dashboard!.updatedAt,
  };
  return { board: { ...board, derived: !stored }, tiles };
}

boardsRouter.get('/boards/:id.json', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const r = resolveBoard(ctx, String(req.params.id));
  if (!r) { res.status(404).json({ error: 'No such board.' }); return; }
  res.json({
    board: r.board,
    ...(r.unplaced ? { unplaced: r.unplaced.map((t) => t.agent.id) } : {}),
  });
});

/** Agents that can go on a board (they have a tile), for the editor's Add menu. */
function placeableAgents(ctx: ReturnType<typeof getContext>): Array<{ id: string; name: string; size: string }> {
  return ctx.agentStore.listAgents()
    .map(withTileSignal)
    .filter((a): a is NonNullable<typeof a> => Boolean(a?.signal))
    .map((a) => ({
      id: a.id,
      name: a.signal!.title || a.name || a.id,
      size: a.signal!.size ?? TEMPLATE_REGISTRY[normalizeSignal(a.signal!).template]?.defaultSize ?? '1x1',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sendSaveError(res: Response, err: unknown): void {
  if (err instanceof BoardConflictError) { res.status(409).json({ error: err.message, version: err.current }); return; }
  if ((err as Error)?.name === 'ZodError') {
    const first = (err as { issues?: Array<{ path: Array<string | number>; message: string }> }).issues?.[0];
    res.status(400).json({ error: `That layout isn't valid: ${first ? `${first.path.join('.')}: ${first.message}` : 'unknown problem'}.` });
    return;
  }
  res.status(400).json({ error: (err as Error).message });
}

/** Save a board's items. Body: { items, version } where version is what the editor loaded. */
boardsRouter.post('/boards/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const r = resolveBoard(ctx, id);
  if (!r) { res.status(404).json({ error: 'No such board.' }); return; }
  const body = (req.body ?? {}) as { items?: unknown; version?: unknown };
  if (!Array.isArray(body.items) || typeof body.version !== 'number') {
    res.status(400).json({ error: 'Send { items: [...], version: <the version you loaded> }.' });
    return;
  }
  try {
    const board = boardsOf(ctx).save({ id, name: r.board.name, packId: r.board.packId, items: body.items, expectedVersion: body.version });
    res.json({ board });
  } catch (err) { sendSaveError(res, err); }
});

/** Go back to the layout before the last save. Body: { version }. */
boardsRouter.post('/boards/:id/undo', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const version = (req.body ?? {}).version;
  try {
    const board = boardsOf(ctx).undo(String(req.params.id), typeof version === 'number' ? version : undefined);
    res.json({ board });
  } catch (err) { sendSaveError(res, err); }
});

/**
 * Start Pulse's board from the arrangement this browser kept for the old
 * Pulse (its localStorage containers + tile sizes). Only before the board has
 * ever been saved; each custom container becomes a heading + its tiles.
 */
boardsRouter.post('/boards/pulse/import', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as { containers?: unknown; sizes?: unknown };
  if (!Array.isArray(body.containers)) { res.status(400).json({ error: 'Send { containers: [{ label, tiles }], sizes }.' }); return; }
  const r = resolveBoard(ctx, PULSE_BOARD_ID)!;
  const known = new Set(r.tiles.keys());
  const sizes = (body.sizes && typeof body.sizes === 'object' ? body.sizes : {}) as Record<string, unknown>;
  const sections = (body.containers as Array<{ label?: unknown; tiles?: unknown }>).slice(0, 50).map((c) => ({
    title: typeof c.label === 'string' && c.label.trim() ? c.label.trim().slice(0, 120) : 'Section',
    agentIds: (Array.isArray(c.tiles) ? c.tiles : []).filter((t): t is string => typeof t === 'string' && known.has(t)),
  })).filter((sct) => sct.agentIds.length > 0);
  if (sections.length === 0) { res.status(400).json({ error: 'Nothing in that arrangement matches a tile on Pulse.' }); return; }
  const items = boardItemsFromSections(sections, (agentId) => {
    const size = sizes[agentId];
    return typeof size === 'string' ? size : preferredSize(r.tiles.get(agentId));
  }).map((it) => (it.kind === 'agent' && it.agentId.startsWith('_') ? { id: it.id, kind: 'system' as const, tileId: it.agentId, x: it.x, y: it.y, w: it.w, h: it.h } : it));
  try {
    const board = boardsOf(ctx).save({ id: PULSE_BOARD_ID, name: 'Pulse', items, expectedVersion: 0 });
    res.json({ board });
  } catch (err) { sendSaveError(res, err); }
});

boardsRouter.get('/boards/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const r = resolveBoard(ctx, id);
  if (!r) { res.status(404).type('html').send(render(layout({ title: 'Board not found' }, pageHeader({ title: 'Board not found', description: `There's no board "${id}".` })))); return; }
  const isPulse = id === PULSE_BOARD_ID;
  const header = pageHeader({
    title: r.board.name,
    description: r.board.derived
      ? (isPulse
        ? 'Pulse as a board (preview). Nothing is placed yet: press Edit, then Place the tiles you want on the board.'
        : 'This dashboard as a board (preview), laid out from its sections. Press Edit to arrange it.')
      : 'A board (preview). Press Edit to arrange it.',
  });
  const placedAgents = new Set(r.board.items.flatMap((it) => (it.kind === 'agent' ? [it.agentId] : [])));
  const editorData = {
    id,
    version: r.board.version,
    hasPrevious: Boolean(r.board.hasPrevious),
    isPulse,
    items: r.board.items,
    rowPx: BOARD_ROW_PX,
    columns: BOARD_COLUMNS,
    sizes: Object.fromEntries([...r.tiles].map(([tid, t]) => [tid, preferredSize(t) ?? '1x1'])),
    agents: isPulse ? [] : placeableAgents(ctx).filter((a) => !placedAgents.has(a.id)),
  };
  const toolbar = html`
    <div class="board-toolbar" data-board-toolbar>
      <button type="button" class="btn btn--ghost btn--sm" data-board-edit>✎ Edit</button>
      ${r.board.hasPrevious ? html`<button type="button" class="btn btn--ghost btn--sm" data-board-undo title="Go back to the layout before the last save">Undo last save</button>` : html``}
      <span class="board-toolbar__status dim" data-board-status role="status" aria-live="polite"></span>
    </div>`;
  res.type('html').send(render(layout({ title: r.board.name, activeNav: isPulse ? 'pulse' : 'home' }, html`
    ${header}${toolbar}${renderBoard(r)}
    ${unsafeHtml(`<script type="application/json" id="board-data">${JSON.stringify(editorData).replace(/</g, '\\u003c')}</script>`)}
    <script type="module" src="/assets/board-editor.js"></script>`)));
});
