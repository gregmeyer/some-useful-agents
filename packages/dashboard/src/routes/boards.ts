import { Router, type Request, type Response } from 'express';
import {
  BOARD_COLUMNS,
  BOARD_ROW_PX,
  BoardConflictError,
  BOARD_PALETTES,
  BoardsStore,
  PULSE_BOARD_ID,
  boardItemsFromSections,
  boardItemsFromLayoutPlan,
  normalizeBoardItems,
  layoutPlanSchema,
  type Agent,
  type AgentSignal,
  type Board,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { html, render, unsafeHtml } from '../views/html.js';
import { layout } from '../views/layout.js';
import { pageHeader } from '../views/page-header.js';
import { renderBoard } from '../views/board.js';
import { buildDashboardOptions, renderDashboardsDropdown } from '../views/dashboards-dropdown.js';
import { renderInstallPacksModal } from '../views/install-packs-modal.js';
import { boardPagesEnabled } from '../lib/dashboard-prefs.js';
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
  /** Pulse only: the Pulse page data (hidden count, dashboards, packs). */
  pulse?: ReturnType<typeof buildPulseBoardData>;
}

/** A board with the tiles it needs, or undefined when there's no such board. */
export function resolveBoard(ctx: ReturnType<typeof getContext>, id: string): ResolvedBoard | undefined {
  const stored = boardsOf(ctx).get(id);
  if (id === PULSE_BOARD_ID) {
    const data = buildPulseBoardData(ctx);
    const all = [...data.systemTiles, ...data.tiles];
    const tiles = new Map(all.map((t) => [t.agent.id, t]));
    const saved = stored ?? { id, name: 'Pulse', packId: null, items: [], version: 0, updatedAt: 0 };
    // A placed agent that's since been hidden from Pulse (or deleted) drops
    // off the board: the others float up, and the next save forgets it.
    const shown = saved.items.filter((it) => (it.kind === 'agent' ? tiles.has(it.agentId) : it.kind === 'system' ? tiles.has(it.tileId) : true));
    const board = shown.length === saved.items.length ? saved : { ...saved, items: normalizeBoardItems(shown) };
    const placed = new Set(board.items.flatMap((it) => (it.kind === 'agent' ? [it.agentId] : it.kind === 'system' ? [it.tileId] : [])));
    return {
      board: { ...board, derived: !stored },
      tiles,
      unplaced: all.filter((t) => !placed.has(t.agent.id)),
      systemTileIds: data.systemTiles.map((t) => t.agent.id),
      pulse: data,
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

/**
 * Turn an Improve-layout plan into board items for the editor to preview
 * (nothing is saved here). Body: { plan }. Tiles the plan names that aren't
 * on this board's agents are dropped, so a stale plan can't add ghosts.
 */
boardsRouter.post('/boards/:id/plan-preview', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const r = resolveBoard(ctx, String(req.params.id));
  if (!r) { res.status(404).json({ error: 'No such board.' }); return; }
  const parsed = layoutPlanSchema.safeParse((req.body ?? {}).plan);
  if (!parsed.success) { res.status(400).json({ error: `That plan isn't valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.` }); return; }
  const installed = new Set(ctx.agentStore.listAgents().map((a) => a.id));
  // System tiles exist only on Pulse; agent tiles must be installed agents.
  const known = (id: string) => (id.startsWith('_') ? r.unplaced !== undefined && r.tiles.has(id) : installed.has(id));
  const containers = parsed.data.containers
    .map((c) => ({ label: c.label, tiles: c.tiles.filter(known) }))
    .filter((c) => c.tiles.length > 0);
  if (containers.length === 0) { res.status(400).json({ error: 'The suggested layout has no tiles this board can show.' }); return; }
  const items = boardItemsFromLayoutPlan({ ...parsed.data, containers }, (id) => preferredSize(r.tiles.get(id)));
  res.json({ items, summary: parsed.data.summary });
});

type Flash = { kind: 'ok' | 'error' | 'info'; message: string } | undefined;

/** The page a board lives at: /pulse, /dashboards/<id> (or /boards/<id> when board pages are off). */
export function boardPageUrl(id: string): string {
  if (!boardPagesEnabled()) return `/boards/${encodeURIComponent(id)}`;
  return id === PULSE_BOARD_ID ? '/pulse' : `/dashboards/${encodeURIComponent(id)}`;
}

/**
 * A board's full page: the page header (Pulse's or the dashboard's), the
 * board toolbar (Edit, Suggest a layout, Undo), the board, and the editor.
 * Undefined when there's no such board.
 */
export function renderBoardPage(ctx: ReturnType<typeof getContext>, id: string, opts: { flash?: Flash } = {}): string | undefined {
  const r = resolveBoard(ctx, id);
  if (!r) return undefined;
  const isPulse = id === PULSE_BOARD_ID;
  const returnTo = boardPageUrl(id);
  const installed = ctx.dashboardsStore?.listDashboards() ?? [];
  const options = buildDashboardOptions(installed);
  const dropdown = options.length > 1
    ? renderDashboardsDropdown({ options, activeHref: isPulse ? '/' : `/dashboards/${encodeURIComponent(id)}` })
    : html``;
  const placedAgents = new Set(r.board.items.flatMap((it) => (it.kind === 'agent' ? [it.agentId] : [])));
  const tileCount = r.board.items.filter((it) => it.kind === 'agent' || it.kind === 'system').length;

  let header;
  let after = html``;
  if (isPulse) {
    const p = r.pulse!;
    const hidden = p.hiddenTiles.length;
    header = html`
      <div class="board-page__head">
        <h1 style="margin: 0;">Pulse</h1>
        <span class="dim board-page__meta">${String(tileCount)} placed · ${String(r.unplaced?.length ?? 0)} unplaced${hidden > 0 ? html` · ${String(hidden)} hidden` : html``}</span>
        <div class="board-page__actions">
          ${dropdown}
          ${p.tiles.length > 0 ? html`
            <form method="POST" action="/pulse/hide-all" style="margin: 0; display: inline;" data-confirm-modal="Hide all ${String(p.tiles.length)} agents from Pulse? They move to the hidden section and can be restored individually." data-confirm-label="Hide all" data-confirm-title="Hide all?">
              <button type="submit" class="btn btn--ghost btn--sm" title="Hide every agent from Pulse. Useful before installing packs.">Hide all</button>
            </form>` : html``}
        </div>
        <p class="page-header__description">Your board of agents. Each tile shows an agent's latest result and runs it in place. Press Edit to arrange the board; agents you haven't placed wait in the tray below.</p>
      </div>`;
    after = html`
      ${hidden > 0 ? html`
        <div class="pulse-hidden-section board-page__hidden">
          <span>${String(hidden)} agent${hidden !== 1 ? 's' : ''} hidden from Pulse.</span>
          <form method="POST" action="/pulse/show-all" style="margin: 0; display: inline;"><button type="submit" class="btn btn--ghost btn--sm">Show all</button></form>
          <a class="btn btn--ghost btn--sm" href="/agents">Manage in /agents</a>
        </div>` : html``}
      ${options.length > 1 ? renderInstallPacksModal(p.availablePacks ?? []) : html``}`;
  } else {
    const sourceLabel = r.board.packId ? `from pack: ${r.board.packId}` : 'user-created';
    header = html`
      <div class="board-page__head">
        <h1 style="margin: 0;">${r.board.name}</h1>
        <span class="dim board-page__meta">${String(tileCount)} tile${tileCount === 1 ? '' : 's'} · ${sourceLabel}</span>
        <div class="board-page__actions">
          ${dropdown}
          <a class="btn btn--ghost btn--sm" href="/dashboards/${encodeURIComponent(id)}/edit">Edit dashboard</a>
          <a class="btn btn--ghost btn--sm" href="/dashboards/${encodeURIComponent(id)}/export" title="Download as a pack manifest YAML">Save as pack</a>
        </div>
      </div>`;
  }
  if (!boardPagesEnabled()) {
    header = html`${header}<p class="dim" style="font-size: var(--font-size-sm);">Board view (preview). Turn on boards in <a href="/settings/appearance#board-pages">Settings → Appearance</a> to make this the page.</p>`;
  }

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
    plannerUrl: isPulse ? '/pulse/layout-plan' : `/dashboards/${encodeURIComponent(id)}/layout-plan`,
  };
  const toolbar = html`
    <div class="board-toolbar" data-board-toolbar>
      <button type="button" class="btn btn--ghost btn--sm" data-board-edit>✎ Edit${isPulse ? '' : html` · add tiles`}</button>
      <button type="button" class="btn btn--ghost btn--sm" data-board-suggest title="Ask the layout planner for an arrangement; you review it before saving">✨ Suggest a layout</button>
      ${r.board.hasPrevious ? html`<button type="button" class="btn btn--ghost btn--sm" data-board-undo title="Go back to the layout before the last save">Undo last save</button>` : html``}
      <span class="board-toolbar__status dim" data-board-status role="status" aria-live="polite"></span>
    </div>`;
  return render(layout({ title: isPulse ? 'Pulse' : `${r.board.name} · Dashboards`, activeNav: isPulse ? 'pulse' : 'home', flash: opts.flash }, html`
    ${header}${toolbar}${renderBoard({ ...r, returnTo })}${after}
    ${unsafeHtml(`<script type="application/json" id="board-data">${JSON.stringify(editorData).replace(/</g, '\\u003c')}</script>`)}
    ${unsafeHtml(`<script type="application/json" id="pulse-template-registry">${JSON.stringify(TEMPLATE_REGISTRY).replace(/</g, '\\u003c')}</script>`)}
    <script type="module" src="/assets/board-editor.js"></script>`));
}

/** Remove one item from a board (a tile's × on a dashboard board). Form post. */
boardsRouter.post('/boards/:id/items/:itemId/remove', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const back = safeReturnTo((req.body ?? {}).returnTo, boardPageUrl(id));
  const r = resolveBoard(ctx, id);
  if (!r) { res.redirect(303, back); return; }
  const itemId = String(req.params.itemId);
  const item = r.board.items.find((it) => it.id === itemId);
  if (!item) { res.redirect(303, `${back}?error=${encodeURIComponent('That tile is no longer on the board.')}`); return; }
  try {
    boardsOf(ctx).save({ id, name: r.board.name, packId: r.board.packId, items: r.board.items.filter((it) => it.id !== itemId), expectedVersion: r.board.version });
    const label = item.kind === 'agent' ? item.agentId : item.kind === 'system' ? item.tileId : item.kind;
    res.redirect(303, `${back}?ok=${encodeURIComponent(`Removed ${label} from the board. Undo last save puts it back.`)}`);
  } catch (err) {
    res.redirect(303, `${back}?error=${encodeURIComponent((err as Error).message)}`);
  }
});

/** Set one tile's palette (the ● button). Body: { palette, version }. Returns the new version. */
boardsRouter.post('/boards/:id/items/:itemId/palette', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const r = resolveBoard(ctx, id);
  if (!r) { res.status(404).json({ error: 'No such board.' }); return; }
  const body = (req.body ?? {}) as { palette?: unknown; version?: unknown };
  if (typeof body.palette !== 'string' || !(BOARD_PALETTES as readonly string[]).includes(body.palette)) { res.status(400).json({ error: 'Unknown palette.' }); return; }
  const itemId = String(req.params.itemId);
  if (!r.board.items.some((it) => it.id === itemId && (it.kind === 'agent' || it.kind === 'system'))) { res.status(404).json({ error: 'That tile is no longer on the board.' }); return; }
  const items = r.board.items.map((it) => {
    if (it.id !== itemId || (it.kind !== 'agent' && it.kind !== 'system')) return it;
    const { palette: _old, ...rest } = it;
    return body.palette === 'default' ? rest : { ...rest, palette: body.palette as typeof it.palette };
  });
  try {
    const board = boardsOf(ctx).save({ id, name: r.board.name, packId: r.board.packId, items, expectedVersion: typeof body.version === 'number' ? body.version : r.board.version });
    res.json({ version: board.version });
  } catch (err) { sendSaveError(res, err); }
});

/** Only same-site paths come back from a form's returnTo. */
function safeReturnTo(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^\/(?!\/)[\w\-./:%]*$/.test(v) ? v : fallback;
}

boardsRouter.get('/boards/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  // With board pages on, a board's home is /pulse or /dashboards/<id>.
  if (boardPagesEnabled() && resolveBoard(ctx, id)) { res.redirect(302, boardPageUrl(id)); return; }
  const page = renderBoardPage(ctx, id);
  if (!page) { res.status(404).type('html').send(render(layout({ title: 'Board not found' }, pageHeader({ title: 'Board not found', description: `There's no board "${id}".` })))); return; }
  res.type('html').send(page);
});
