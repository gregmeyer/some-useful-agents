import { Router, type Request, type Response } from 'express';
import {
  BoardsStore,
  PULSE_BOARD_ID,
  boardItemsFromSections,
  type Agent,
  type AgentSignal,
  type Board,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { html, render } from '../views/html.js';
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

boardsRouter.get('/boards/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const r = resolveBoard(ctx, id);
  if (!r) { res.status(404).type('html').send(render(layout({ title: 'Board not found' }, pageHeader({ title: 'Board not found', description: `There's no board "${id}".` })))); return; }
  const header = pageHeader({
    title: r.board.name,
    description: r.board.derived
      ? (id === PULSE_BOARD_ID
        ? 'Pulse as a board (preview). Nothing is placed yet; every agent is in the Unplaced tray. Arranging tiles arrives with the board editor.'
        : 'This dashboard as a board (preview), laid out from its sections. Arranging tiles arrives with the board editor.')
      : 'A saved board (preview).',
  });
  res.type('html').send(render(layout({ title: r.board.name, activeNav: id === PULSE_BOARD_ID ? 'pulse' : 'home' }, html`${header}${renderBoard(r)}`)));
});
