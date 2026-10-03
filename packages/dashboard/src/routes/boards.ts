import { Router, type Request, type Response } from 'express';
import {
  BoardConflictError,
  BoardsStore,
  PULSE_BOARD_ID,
  boardItemsFromSections,
  boardItemsFromLayoutPlan,
  normalizeBoardItems,
  boardDocFromItems,
  boardDocAgentIds,
  boardDocSystemTileIds,
  validateBoardDoc,
  applyBoardOps,
  type BoardDoc,
  layoutPlanSchema,
  type Agent,
  type AgentSignal,
  type Board,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { html, render, unsafeHtml, type SafeHtml } from '../views/html.js';
import { layout } from '../views/layout.js';
import { pageHeader } from '../views/page-header.js';
import { assembleCanvas, canvasTileEntry } from '../lib/board-canvas.js';
import { boardCatalog, decideBoardDrafts, latestBoardBuild, retryFailedTiles, startBoardBuild } from '../lib/board-build.js';
import { boardApprovalButtons } from '../views/board-approval.js';
import { buildDashboardOptions, renderDashboardsDropdown } from '../views/dashboards-dropdown.js';
import { renderInstallPacksModal } from '../views/install-packs-modal.js';
import { boardPagesEnabled } from '../lib/dashboard-prefs.js';
import { buildPulseBoardData } from './pulse.js';
import { buildPulseTile, attachLayoutHints, withTileSignal } from '../views/pulse-tile-builder.js';
import { TEMPLATE_REGISTRY, normalizeSignal } from '../views/pulse-templates.js';
import type { PulseTile } from '../views/pulse-types.js';

/**
 * Boards (docs/boards.md): Pulse and every named dashboard, each drawn as ONE
 * A2UI surface (a canvas) and arranged in the canvas editor. A board's layout
 * is its saved canvas document, or, until it has one, derived from its older
 * grid items / the dashboard's sections. Pulse adds agents the document
 * doesn't place under "Everything else".
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
  for (const a of stored?.doc ? boardDocAgentIds(stored.doc) : []) agentIds.add(a);
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
function placeableAgents(ctx: ReturnType<typeof getContext>): Array<{ id: string; name: string; description: string; size: string }> {
  return ctx.agentStore.listAgents()
    .filter((a) => a.status !== 'archived')
    .map(withTileSignal)
    .filter((a): a is NonNullable<typeof a> => Boolean(a?.signal))
    .map((a) => ({
      id: a.id,
      // A tile title can be a template ("{{inputs.SEARCH_QUERY}}") filled per run; it isn't a name.
      name: (a.signal!.title && !a.signal!.title.includes('{{') ? a.signal!.title : '') || a.name || a.id,
      description: (a.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
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
 * Turn a layout-planner plan into a canvas document for the editor to show
 * as unsaved changes (nothing is saved here). Body: { plan }. Tiles the plan names that aren't
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
  res.json({ doc: boardDocFromItems(items), summary: parsed.data.summary });
});

type Flash = { kind: 'ok' | 'error' | 'info'; message: string } | undefined;

/** The page a board lives at: /pulse, /dashboards/<id> (or /boards/<id> when board pages are off). */
export function boardPageUrl(id: string): string {
  if (!boardPagesEnabled()) return `/boards/${encodeURIComponent(id)}/canvas`;
  return id === PULSE_BOARD_ID ? '/pulse' : `/dashboards/${encodeURIComponent(id)}`;
}

/**
 * A board's full page: the page header (Pulse's or the dashboard's), the
 * toolbar (Arrange, Suggest a layout, Undo last save), the canvas, and the
 * canvas editor.
 * Undefined when there's no such board.
 */
export function renderBoardPage(ctx: ReturnType<typeof getContext>, id: string, opts: { flash?: Flash } = {}): string | undefined {
  const r = resolveBoard(ctx, id);
  if (!r) return undefined;
  const isPulse = id === PULSE_BOARD_ID;
  const returnTo = boardPageUrl(id);
  const installed = ctx.dashboardsStore?.listDashboards() ?? [];
  const archived = ctx.dashboardsStore?.listArchived() ?? [];
  const options = buildDashboardOptions(installed);
  const dropdown = options.length > 1 || archived.length > 0
    ? renderDashboardsDropdown({ options, archived, activeHref: isPulse ? '/pulse' : `/dashboards/${encodeURIComponent(id)}` })
    : html``;
  const archivedAt = isPulse ? undefined : ctx.dashboardsStore?.getDashboard(id)?.archivedAt;
  const doc = currentDoc(ctx, r);
  const canvas = canvasFor(ctx, r, doc);
  const tileCount = boardDocAgentIds(canvas.doc).length + boardDocSystemTileIds(canvas.doc).length;


  let header;
  let after = html``;
  if (isPulse) {
    const p = r.pulse!;
    const hidden = p.hiddenTiles.length;
    header = html`
      <div class="board-page__head">
        <h1 style="margin: 0;">Pulse</h1>
        <span class="dim board-page__meta">${String(tileCount)} placed${hidden > 0 ? html` · ${String(hidden)} hidden` : html``}</span>
        <div class="board-page__actions">
          ${dropdown}
          <a class="btn btn--ghost btn--sm" href="/boards/new" title="Describe a board; sua picks your agents, lays it out and runs it">＋ New board</a>
          ${p.tiles.length > 0 ? html`
            <form method="POST" action="/pulse/hide-all" style="margin: 0; display: inline;" data-confirm-modal="Hide all ${String(p.tiles.length)} agents from Pulse? They move to the hidden section and can be restored individually." data-confirm-label="Hide all" data-confirm-title="Hide all?">
              <button type="submit" class="btn btn--ghost btn--sm" title="Hide every agent from Pulse. Useful before installing packs.">Hide all</button>
            </form>` : html``}
        </div>
        <p class="page-header__description">Your board of agents. Each tile shows an agent's latest result and runs it in place. Press Arrange to lay it out; agents you haven't placed are under Everything else.</p>
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
          <a class="btn btn--ghost btn--sm" href="/boards/new" title="Describe a board; sua picks your agents, lays it out and runs it">＋ New board</a>
          <a class="btn btn--ghost btn--sm" href="/dashboards/${encodeURIComponent(id)}/edit">Edit dashboard</a>
          <a class="btn btn--ghost btn--sm" href="/dashboards/${encodeURIComponent(id)}/export" title="Download as a pack manifest YAML">Save as pack</a>
        </div>
      </div>`;
  }
  if (!boardPagesEnabled()) {
    header = html`${header}<p class="dim" style="font-size: var(--font-size-sm);">Canvas preview. Turn on boards in <a href="/settings/appearance#board-pages">Settings → Appearance</a> to make this the page.</p>`;
  }

  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const build = isPulse ? undefined : latestBoardBuild(ctx, id);
  const building = build && (build.phase === 'planning' || build.phase === 'arranging' || build.phase === 'running' || build.phase === 'drafting');
  const awaitingApproval = build && build.approval === 'pending';
  const recentlyBuilt = build && !building && !awaitingApproval && Date.now() - build.updatedAt < 6 * 3_600_000 && (r.board.version <= 1);
  const buildBanner = building
    ? html`<div class="flash flash--info board-build" data-board-build="${id}" role="status" aria-live="polite">
        <strong>Building this board from your request.</strong> <span data-board-build-detail>${build!.detail}</span>
        <span class="dim"> You can leave; your inbox will say when it's ready.</span>
      </div>
      ${unsafeHtml(`<script>(function(){var el=document.querySelector('[data-board-build]');if(!el)return;var id=el.getAttribute('data-board-build');function tick(){fetch('/boards/'+encodeURIComponent(id)+'/build.json',{headers:{Accept:'application/json'}}).then(function(r){return r.json();}).then(function(b){if(!b||!b.phase)return;if(b.phase==='done'||b.phase==='failed'){location.reload();return;}var d=el.querySelector('[data-board-build-detail]');if(d)d.textContent=b.detail||'';setTimeout(tick,3000);}).catch(function(){setTimeout(tick,5000);});}setTimeout(tick,3000);})();</script>`)}`
    : awaitingApproval
      ? html`<div class="flash flash--info board-build" role="status">
          <strong>${build!.detail}</strong> They were drafted for the parts of your request none of your agents covered, and haven't run.
          <ul class="board-build__drafts">${build!.drafts.filter((d) => d.ok && d.id).map((d) => html`<li><a href="/agents/${encodeURIComponent(d.id!)}">${d.name ?? d.id}</a>: ${d.purpose}</li>`) as unknown as SafeHtml[]}</ul>
          ${boardApprovalButtons(build!.id, returnTo)}
        </div>`
    : recentlyBuilt
      ? html`<div class="flash ${build!.phase === 'failed' ? 'flash--error' : 'flash--info'} board-build" role="status">
          ${build!.phase === 'failed'
            ? html`<strong>This board couldn't be built.</strong> ${build!.error ?? ''}`
            : html`<strong>Built from your request.</strong> ${build!.detail}${build!.failed.length ? html` ${String(build!.failed.length)} tile${build!.failed.length === 1 ? '' : 's'} didn't run cleanly (${build!.failed.join(', ')}).
                <form method="POST" action="/boards/builds/${encodeURIComponent(build!.id)}/retry" style="display: inline; margin: 0;"><button type="submit" class="btn btn--ghost btn--sm">Run ${build!.failed.length === 1 ? 'it' : 'them'} again</button></form>` : html``}`}
          ${build!.missing.length ? html`<div style="margin-top: var(--space-1);">Not covered by your agents yet: ${build!.missing.map((m) => m.purpose).join('; ')}. Build an agent for them (Build from goal on the <a href="/agents">Agents</a> page), then add it with Arrange.</div>` : html``}
        </div>`
      : html``;
  const editorData = {
    id,
    version: r.board.version,
    isPulse,
    doc,
    agents: placeableAgents(ctx),
    systemTiles: (r.systemTileIds ?? []).map((sid) => ({ id: sid, title: r.tiles.get(sid)?.signal.title ?? sid })),
    plannerUrl: isPulse ? '/pulse/layout-plan' : `/dashboards/${encodeURIComponent(id)}/layout-plan`,
    // Offer the old Pulse's browser arrangement until Pulse's board is first saved.
    offerImport: isPulse && r.board.version === 0,
  };
  return render(layout({ title: isPulse ? 'Pulse' : `${r.board.name} · Dashboards`, activeNav: isPulse ? 'pulse' : 'home', flash: opts.flash }, html`
    ${header}
    ${archivedAt !== undefined ? html`
      <div class="flash flash--info board-archived" role="status">
        <span>This board is archived: it's hidden from your lists and pickers, and nothing on it was deleted.</span>
        <form method="POST" action="/dashboards/${encodeURIComponent(id)}/restore" style="margin: 0;"><button type="submit" class="btn btn--sm btn--primary">Restore</button></form>
      </div>` : html``}
    ${buildBanner}
    <div class="board-toolbar" data-canvas-toolbar>
      <button type="button" class="btn btn--ghost btn--sm" data-canvas-edit>✎ Arrange</button>
      <button type="button" class="btn btn--ghost btn--sm" data-canvas-suggest title="Ask the layout planner for an arrangement; you review it before saving">✨ Suggest a layout</button>
      ${r.board.hasPrevious ? html`<button type="button" class="btn btn--ghost btn--sm" data-canvas-undo title="Go back to the layout before the last save">Undo last save</button>` : html``}
      <span class="board-toolbar__status dim" data-canvas-status role="status" aria-live="polite"></span>
      ${!isPulse && archivedAt === undefined ? html`<form method="POST" action="/dashboards/${encodeURIComponent(id)}/archive" class="board-toolbar__archive" style="margin: 0 0 0 auto;">
        <button type="submit" class="btn btn--ghost btn--sm" title="Hide this board from your lists; restore it any time">Archive</button>
      </form>` : html``}
    </div>
    ${canvas.errors.length ? html`<p class="flash flash--error">This board's layout couldn't be checked: ${canvas.errors[0]}</p>` : html``}
    <div class="canvas-workspace" data-canvas-workspace>
      <aside class="canvas-outline" data-canvas-outline hidden aria-label="Board outline"></aside>
      <div class="canvas-stage">
        ${unsafeHtml(`<script type="application/json" id="board-tiles">${json(canvas.tiles)}</script>`)}
        <div class="a2ui-host board-canvas" data-a2ui-surface data-board-canvas="${id}" data-return-to="${returnTo}" aria-label="${r.board.name}">${unsafeHtml(`<script type="application/json">${json(canvas.messages)}</script>`)}</div>
      </div>
    </div>
    ${after}
    ${unsafeHtml(`<script type="application/json" id="board-canvas-data">${json(editorData)}</script>`)}
    ${unsafeHtml(`<script type="application/json" id="pulse-template-registry">${JSON.stringify(TEMPLATE_REGISTRY).replace(/</g, '\\u003c')}</script>`)}
    <script type="module" src="/assets/board-canvas-editor.js"></script>`));
}

/** The board's canvas document: saved, else derived from its grid items / sections. */
function currentDoc(ctx: ReturnType<typeof getContext>, r: ResolvedBoard): BoardDoc {
  return boardsOf(ctx).get(r.board.id)?.doc ?? boardDocFromItems(r.board.items);
}

/**
 * The canvas for a document: surface messages + tile registry. Tiles the
 * board's own data doesn't cover (an agent just added to a dashboard) are
 * built here.
 */
function canvasFor(ctx: ReturnType<typeof getContext>, r: ResolvedBoard, docIn: BoardDoc) {
  const isPulse = r.unplaced !== undefined;
  let doc = docIn;
  if (isPulse) {
    // An agent placed on Pulse and since hidden (or deleted) drops off the board.
    const gone = doc.components.filter((c) => (c.component === 'AgentTile' && !r.tiles.has(String(c.agentId))) || (c.component === 'SystemTile' && !r.tiles.has(String(c.tileId))));
    if (gone.length) {
      try { doc = applyBoardOps(doc, gone.map((c) => ({ op: 'remove', id: c.id }))).doc; } catch { /* keep as is */ }
    }
  }
  const tiles = new Map(r.tiles);
  for (const agentId of boardDocAgentIds(doc)) {
    if (tiles.has(agentId)) continue;
    const agent = withTileSignal(ctx.agentStore.getAgent(agentId));
    if (!agent?.signal) continue;
    const tile = buildPulseTile(agent as Agent & { signal: AgentSignal }, { runStore: ctx.runStore });
    attachLayoutHints([tile], ctx.layoutHintsStore);
    tiles.set(agentId, tile);
  }
  return { doc, ...assembleCanvas({ boardId: r.board.id, doc, tiles, ...(isPulse ? { unplaced: r.unplaced ?? [], systemTileIds: r.systemTileIds } : {}) }) };
}

/**
 * Tiles a document ADDS (relative to `before`) that aren't installed agents
 * with a tile. Tiles already on the board for an agent since removed stay
 * (they show as "isn't installed"), so such a board can still be arranged.
 */
function unknownTiles(ctx: ReturnType<typeof getContext>, doc: BoardDoc, r: ResolvedBoard, before: BoardDoc): string[] {
  const had = new Set([...boardDocAgentIds(before), ...boardDocSystemTileIds(before)]);
  const agents = boardDocAgentIds(doc).filter((a) => !had.has(a) && !r.tiles.has(a) && !withTileSignal(ctx.agentStore.getAgent(a))?.signal);
  const systems = boardDocSystemTileIds(doc).filter((sid) => !had.has(sid) && !r.tiles.has(sid));
  return [...new Set([...agents, ...systems])];
}

/**
 * Apply arranging operations to a working copy of the canvas (nothing is
 * saved). Body: { doc?, ops } — `doc` is the editor's working copy (else the
 * board as saved). Returns the new doc, the ids it created, and the redrawn
 * surface (messages + tile registry) for the editor to show.
 */
boardsRouter.post('/boards/:id/doc/apply', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const r = resolveBoard(ctx, id);
  if (!r) { res.status(404).json({ error: 'No such board.' }); return; }
  const body = (req.body ?? {}) as { doc?: unknown; ops?: unknown };
  let base: BoardDoc;
  if (body.doc !== undefined) {
    const v = validateBoardDoc(body.doc);
    if (!v.ok) { res.status(400).json({ error: `That board layout isn't valid: ${v.errors[0]}` }); return; }
    base = v.doc;
  } else base = currentDoc(ctx, r);
  try {
    // An empty list just redraws the working copy (the editor's undo).
    const out = Array.isArray(body.ops) && body.ops.length === 0 ? { doc: base, created: [] as string[] } : applyBoardOps(base, body.ops);
    const unknown = unknownTiles(ctx, out.doc, r, base);
    if (unknown.length) { res.status(400).json({ error: `No tile for ${unknown.map((u) => `"${u}"`).join(', ')}: install the agent first.` }); return; }
    const canvas = canvasFor(ctx, r, out.doc);
    res.json({ doc: out.doc, created: out.created, messages: canvas.messages, tiles: canvas.tiles });
  } catch (err) {
    const issues = (err as { issues?: Array<{ path: Array<string | number>; message: string }> }).issues;
    res.status(400).json({ error: issues?.length ? `That change isn't valid: ${issues[0].path.join('.')}: ${issues[0].message}` : (err as Error).message });
  }
});

/** Save the canvas. Body: { doc, version } (the version the editor loaded). */
boardsRouter.post('/boards/:id/doc', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const r = resolveBoard(ctx, id);
  if (!r) { res.status(404).json({ error: 'No such board.' }); return; }
  const body = (req.body ?? {}) as { doc?: unknown; version?: unknown };
  if (typeof body.version !== 'number') { res.status(400).json({ error: 'Send { doc, version: <the version you loaded> }.' }); return; }
  const v = validateBoardDoc(body.doc);
  if (!v.ok) { res.status(400).json({ error: `That board layout isn't valid: ${v.errors[0]}` }); return; }
  const saved = currentDoc(ctx, r);
  const unknown = unknownTiles(ctx, v.doc, r, saved);
  if (unknown.length) { res.status(400).json({ error: `No tile for ${unknown.map((u) => `"${u}"`).join(', ')}: install the agent first.` }); return; }
  try {
    const board = boardsOf(ctx).saveDoc({ id, name: r.board.name, packId: r.board.packId, doc: v.doc, expectedVersion: body.version });
    res.json({ board: { id: board.id, version: board.version } });
  } catch (err) { sendSaveError(res, err); }
});

/** One canvas tile's registry entry (AgentTile refreshes from this after a run). `?board=pulse` for Pulse's × meaning. */
boardsRouter.get('/boards/tile/:tileId.json', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const tileId = String(req.params.tileId);
  const isPulse = req.query.board === PULSE_BOARD_ID;
  let tile: PulseTile | undefined;
  if (tileId.startsWith('_')) tile = buildPulseBoardData(ctx).systemTiles.find((t) => t.agent.id === tileId);
  else {
    const agent = withTileSignal(ctx.agentStore.getAgent(tileId));
    if (agent?.signal) {
      tile = buildPulseTile(agent as Agent & { signal: AgentSignal }, { runStore: ctx.runStore });
      attachLayoutHints([tile], ctx.layoutHintsStore);
    }
  }
  if (!tile) { res.status(404).json({ error: 'No such tile.' }); return; }
  res.json(canvasTileEntry(tile, { isPulse }));
});

/** New board from a request: the form. */
boardsRouter.get('/boards/new', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const count = boardCatalog(ctx).length;
  res.type('html').send(render(layout({ title: 'New board', activeNav: 'pulse' }, html`
    ${pageHeader({ title: 'New board from a request', description: 'Describe what you want to see. sua picks from your agents, groups and sizes them on a new board, runs every tile, and tells you in your inbox when it\'s ready.' })}
    <form method="POST" action="/boards/build" class="board-new">
      <label class="board-new__field"><span>What should this board show?</span>
        <textarea name="request" rows="4" required maxlength="2000" placeholder="A morning board: weather in Seattle, the markets, and new remote PM jobs"></textarea></label>
      <label class="board-new__field"><span>Name <span class="dim">(optional; sua names it otherwise)</span></span>
        <input type="text" name="name" maxlength="60" placeholder="Morning"></label>
      <p class="dim" style="font-size: var(--font-size-sm);">It uses the ${String(count)} agent${count === 1 ? '' : 's'} you have that can be a tile. Parts none of them cover are listed when it's done, so you can build agents for them.</p>
      <button type="submit" class="btn btn--primary">Build the board</button>
    </form>`)));
});

/** Start building a board from a request; go to the new board (it shows progress). */
boardsRouter.post('/boards/build', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as { request?: unknown; name?: unknown };
  try {
    const { boardId } = startBoardBuild(ctx, { request: String(body.request ?? ''), name: typeof body.name === 'string' ? body.name : undefined });
    res.redirect(303, boardPageUrl(boardId));
  } catch (err) {
    res.redirect(303, `/boards/new?error=${encodeURIComponent((err as Error).message)}`);
  }
});

/** The one approval for a build's drafted agents (from the inbox or the board page). */
/** Run a build's failed tiles again. */
boardsRouter.post('/boards/builds/:buildId/retry', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const out = retryFailedTiles(ctx, String(req.params.buildId));
  const back = out.boardId ? boardPageUrl(out.boardId) : '/pulse';
  res.redirect(303, `${back}?${out.ok ? 'ok' : 'error'}=${encodeURIComponent(out.message)}`);
});

for (const decision of ['approve', 'decline'] as const) {
  boardsRouter.post(`/boards/builds/:buildId/${decision}`, (req: Request, res: Response) => {
    const ctx = getContext(req.app.locals);
    const out = decideBoardDrafts(ctx, String(req.params.buildId), decision);
    const back = out.boardId ? boardPageUrl(out.boardId) : '/inbox';
    res.redirect(303, `${back}?${out.ok ? 'ok' : 'error'}=${encodeURIComponent(out.message)}`);
  });
}

/** A board's latest build (progress for its page). */
boardsRouter.get('/boards/:id/build.json', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const b = latestBoardBuild(ctx, String(req.params.id));
  if (!b) { res.status(404).json({ error: 'No build for this board.' }); return; }
  res.json(b);
});

/** A board's canvas page when board pages are off (with them on, the board lives at /pulse or /dashboards/<id>). */
boardsRouter.get('/boards/:id/canvas', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  if (boardPagesEnabled() && resolveBoard(ctx, id)) { res.redirect(302, boardPageUrl(id)); return; }
  const page = renderBoardPage(ctx, id);
  if (!page) { res.status(404).type('html').send(render(layout({ title: 'Board not found' }, pageHeader({ title: 'Board not found', description: `There's no board "${id}".` })))); return; }
  res.type('html').send(page);
});

boardsRouter.get('/boards/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  if (!resolveBoard(ctx, id)) { res.status(404).type('html').send(render(layout({ title: 'Board not found' }, pageHeader({ title: 'Board not found', description: `There's no board "${id}".` })))); return; }
  res.redirect(302, boardPagesEnabled() ? boardPageUrl(id) : `/boards/${encodeURIComponent(id)}/canvas`);
});
