/**
 * A board decides its own page (ADR-0070): once a board is built and its
 * tiles have run, the `board-page` agent keeps the grid of tiles, takes the
 * front page, or composes a page that fits what the board is for, as an
 * A2UI document bound to the board's data. "How it looks" on the board
 * offers the same choices by hand; a board-page card does it from your
 * words. Undo on the board (Arrange) puts the layout before it back. A page
 * that doesn't check out gets one more try with the reasons, then the
 * board stays as it is.
 */
import { randomUUID } from 'node:crypto';
import {
  BoardsStore, BOARD_LAYOUT_PRESETS, checkBoardLayout, pageRhythm, frontPageDoc, gridDoc, boardLayoutGuide, suaComponentDocs, boardComponentDocs,
  executeAgentDag, extractTaggedJson, boardDocAgentIds, isComposedBoardDoc,
  type Agent, type AgentSignal, type Board, type BoardAgentShape, type BoardLayoutMeta, type ViewComponent,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { boardFigures, figuresInWords } from './board-figures.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { buildPulseTile, withTileSignal } from '../views/pulse-tile-builder.js';
import { boardAgentShape } from './board-widgets.js';
import type { PulseTile } from '../views/pulse-types.js';

type Ctx = ReturnType<typeof getContext>;

export const BOARD_PAGE_ID = 'board-page';

export const boardsOf = (ctx: Ctx) => new BoardsStore(ctx.runStore.databaseHandle());

/** The board's agents as a layout can know them: their shapes, from the tiles the board draws (order: the document's). Never values. */
export function boardShapes(ctx: Ctx, board: { doc: { components: ViewComponent[] } }): BoardAgentShape[] {
  const out: BoardAgentShape[] = [];
  for (const id of boardDocAgentIds(board.doc)) {
    const agent = withTileSignal(ctx.agentStore.getAgent(id));
    if (!agent?.signal) continue;
    const tile: PulseTile = buildPulseTile(agent as Agent & { signal: AgentSignal }, { runStore: ctx.runStore });
    out.push(boardAgentShape(tile, ctx.runStore));
  }
  return out;
}

/** What the page agent reads about a board: its name, what it was built for, and its agents' shapes. Pure. */
export function boardForPage(board: { name: string }, shapes: readonly BoardAgentShape[], about?: string, figures?: { lead: string; others: readonly string[] }): Record<string, unknown> {
  return { name: board.name, ...(about ? { for: about } : {}), agents: shapes, ...(figures ? { figures } : {}) };
}

export type BoardPageAnswer =
  | { preset: 'grid' | 'front-page'; components: ViewComponent[]; about?: string }
  | { components: ViewComponent[]; about?: string }
  | { error: string };

/** The agent's <page>: a preset (filled for this board), a page that checks out, or why it doesn't. Pure. */
export function parseBoardPageAnswer(raw: string | undefined, shapes: readonly BoardAgentShape[]): BoardPageAnswer {
  const block = extractTaggedJson(raw ?? '', 'page');
  if (!block) return { error: 'There was no <page> block.' };
  let v: { preset?: unknown; components?: unknown; about?: unknown };
  try { v = JSON.parse(block) as typeof v; } catch { return { error: 'The <page> block wasn\'t valid JSON.' }; }
  const about = typeof v.about === 'string' ? v.about.trim().slice(0, 200) : undefined;
  if (v.components === undefined) {
    if (v.preset === 'grid') return { preset: 'grid', components: gridDoc(shapes), ...(about ? { about } : {}) };
    if (v.preset === 'front-page') return { preset: 'front-page', components: frontPageDoc(shapes), ...(about ? { about } : {}) };
    return { error: `There's no ready-made page "${String(v.preset)}"; use one of ${BOARD_LAYOUT_PRESETS.map((p) => p.id).join(', ')}, or draw one.` };
  }
  const check = checkBoardLayout(v.components, shapes.map((s) => s.id));
  if (!check.ok) return { error: check.errors.slice(0, 6).join('; ') };
  return { components: check.components, ...(about ? { about } : {}) };
}

/** One run of the page agent (or the test's stand-in): its answer, or undefined. Never throws. */
export async function runBoardPageAgent(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
  if (ctx.boardPageRun) return ctx.boardPageRun(inputs);
  if (!ensureSystemAgentCurrent(ctx, BOARD_PAGE_ID, 'board pages')) return undefined;
  const agent = ctx.agentStore.getAgent(BOARD_PAGE_ID);
  if (!agent) return undefined;
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  try {
    // No onRunFailure: a page that can't be drawn leaves the board as it is, not an inbox thread.
    await executeAgentDag(agent, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
      runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
      dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
    });
    const run = ctx.runStore.getRun(runId);
    return run?.status === 'completed' ? run.result ?? undefined : undefined;
  } catch {
    return undefined;
  } finally {
    ctx.activeRuns.delete(runId);
  }
}

/** What the page agent is given for a board: it, the ready-made pages (the front page filled for it), and how to draw one. Pure. */
export function boardPageInputs(board: { name: string }, shapes: readonly BoardAgentShape[], about?: string, figures?: { lead: string; others: readonly string[] }): Record<string, string> {
  return {
    BOARD: JSON.stringify(boardForPage(board, shapes, about, figures)),
    PRESETS: BOARD_LAYOUT_PRESETS.map((p) => `${p.id}: ${p.when}${p.id === 'front-page' ? `\n  filled for this board: ${JSON.stringify(frontPageDoc(shapes))}` : ''}`).join('\n'),
    GUIDE: boardLayoutGuide([...suaComponentDocs(), ...boardComponentDocs()], shapes, figures),
    ERRORS: '',
    ASK: '',
    CURRENT: '',
  };
}

export interface DrawnBoardPage {
  answer: BoardPageAnswer;
  /** 1, or 2 when the first answer couldn't be used or read like a grid. */
  tries: number;
  firstNotes?: string;
}

/**
 * Ask for a board's page with `ask` (the agent, or a recorded answer): a page
 * drawn for it that can't be used, or breaks the editorial rhythm, gets one
 * more try with the reasons; if that try can't be drawn, the first stands.
 * With a `request` ("put the weather first"), it changes `current` to do it.
 */
export async function drawBoardPage(board: { name: string }, shapes: readonly BoardAgentShape[], ask: (inputs: Record<string, string>) => Promise<string | undefined>, opts: { about?: string; request?: string; current?: ViewComponent[]; figures?: { lead: string; others: readonly string[] } } = {}): Promise<DrawnBoardPage> {
  const base = { ...boardPageInputs(board, shapes, opts.about, opts.figures), ...(opts.request ? { ASK: opts.request, CURRENT: opts.current && isComposedBoardDoc(opts.current) ? JSON.stringify(opts.current) : '' } : {}) };
  const first = parseBoardPageAnswer(await ask(base), shapes);
  const rhythm = 'components' in first && !('preset' in first) ? pageRhythm(first.components) : [];
  if (!('error' in first) && !rhythm.length) return { answer: first, tries: 1 };
  const firstNotes = 'error' in first ? first.error : `It can be drawn, but it reads like a grid: ${rhythm.join(' ')}`;
  const again = parseBoardPageAnswer(await ask({ ...base, ERRORS: firstNotes }), shapes);
  return { answer: !('error' in again) || 'error' in first ? again : first, tries: 2, firstNotes };
}

export type BoardPageOutcome = 'drawn' | 'kept' | 'skipped' | 'failed';

/** Its page is still the board's own (sua's after the build, or never composed): the board may decide it again. Pure. */
export function boardPageIsItsOwn(board: Pick<Board, 'layoutMeta'>): boolean {
  return !board.layoutMeta || board.layoutMeta.layoutBy === 'board';
}

/**
 * Let a board decide its page. `again`: decide even though it has a composed
 * page already; otherwise a board with one keeps it. `request`: what the
 * person asked in words (saved as `you`); `keep`: the picker's "Let sua
 * pick" (saved as `picked`). Never throws.
 */
export async function decideBoardPage(ctx: Ctx, boardId: string, opts: { again?: boolean; keep?: boolean; request?: string; /** What the board was built for (the build request), when known. */ about?: string } = {}): Promise<BoardPageOutcome> {
  if (boardId === 'pulse') return 'skipped';
  const boards = boardsOf(ctx);
  const board = boards.loadDocOrDerive(boardId);
  if (!board) return 'skipped';
  if (isComposedBoardDoc(board.doc.components) && !opts.again && !opts.request) return 'skipped';
  ctx.boardPages ??= new Set();
  if (ctx.boardPages.has(boardId)) return 'skipped';
  ctx.boardPages.add(boardId);
  try {
    const shapes = boardShapes(ctx, board);
    if (!shapes.length) return 'skipped';
    // What the board is for: said for this run, else the board's goal. Every run of the page agent gets it.
    const about = opts.about ?? boards.goal(boardId)?.text;
    // The board's day-by-day figures, when its agents have any: sua is told they're there to draw.
    const fig = boardFigures(ctx, shapes.map((s) => s.id));
    const { answer } = await drawBoardPage(board, shapes, (inputs) => runBoardPageAgent(ctx, inputs), { ...(about ? { about } : {}), ...(fig ? { figures: figuresInWords(fig) } : {}), ...(opts.request ? { request: opts.request, current: board.doc.components } : {}) });
    const now = boards.loadDocOrDerive(boardId);
    // Gone, or changed meanwhile (by hand, by a card): that stands.
    if (!now || JSON.stringify(now.doc) !== JSON.stringify(board.doc)) return 'skipped';
    if ('error' in answer) return 'failed';
    const by: BoardLayoutMeta['layoutBy'] = opts.request ? 'you' : opts.keep ? 'picked' : 'board';
    const meta: BoardLayoutMeta = { ...('preset' in answer ? { preset: answer.preset } : {}), ...(answer.about ? { about: answer.about } : {}), layoutBy: by };
    if ('preset' in answer && answer.preset === 'grid' && !isComposedBoardDoc(now.doc.components)) {
      // The grid it has: nothing to save.
      return 'kept';
    }
    boards.saveDoc({ id: boardId, name: now.name, packId: now.packId, doc: { components: answer.components }, expectedVersion: now.derived ? 0 : now.version, meta: 'preset' in answer && answer.preset === 'grid' ? null : meta });
    return 'preset' in answer && answer.preset === 'grid' ? 'kept' : 'drawn';
  } catch {
    return 'failed';
  } finally {
    ctx.boardPages.delete(boardId);
  }
}

/**
 * "How it looks" by hand: `grid` puts the tiles back in one section (meta
 * cleared), `front-page` fills the front page for the board's agents
 * (`picked`), `pick` lets sua decide (`picked`), `own` restores the page
 * sua composed for it when a preset replaced it (its meta stays). Returns
 * what happened, in words.
 */
export async function setBoardLook(ctx: Ctx, boardId: string, look: string): Promise<{ ok: boolean; text: string }> {
  if (boardId === 'pulse') return { ok: false, text: 'Pulse keeps its grid; a page is composed for a named board.' };
  const boards = boardsOf(ctx);
  const board = boards.loadDocOrDerive(boardId);
  if (!board) return { ok: false, text: 'There\'s no such board.' };
  const version = board.derived ? 0 : board.version;
  try {
    if (look === 'grid') {
      // Every agent the board has: the dashboard's sections (in their order), then any the page binds besides.
      const sections = ctx.dashboardsStore?.getDashboard(boardId)?.layout.sections ?? [];
      const ids = [...new Set([...sections.flatMap((s) => s.agentIds), ...boardDocAgentIds(board.doc)])].filter((id) => withTileSignal(ctx.agentStore.getAgent(id))?.signal);
      const shapes = boardShapes(ctx, { doc: { components: gridDoc(ids.map((id) => ({ id }))) } });
      boards.saveDoc({ id: boardId, name: board.name, packId: board.packId, doc: { components: gridDoc(shapes) }, expectedVersion: version, meta: null });
      return { ok: true, text: 'Back to a grid of tiles. Undo last save puts the page back.' };
    }
    if (look === 'front-page') {
      const shapes = boardShapes(ctx, board);
      boards.saveDoc({ id: boardId, name: board.name, packId: board.packId, doc: { components: frontPageDoc(shapes) }, expectedVersion: version, meta: { preset: 'front-page', layoutBy: 'picked' } });
      return { ok: true, text: 'Laid out as a front page. Undo last save puts the layout before it back.' };
    }
    if (look === 'pick') {
      const out = await decideBoardPage(ctx, boardId, { again: true, keep: true });
      return out === 'drawn' ? { ok: true, text: 'sua composed the page from what the board is for and what its agents found.' }
        : out === 'kept' ? { ok: true, text: 'sua would keep the grid of tiles for this board.' }
          : out === 'skipped' ? { ok: false, text: 'sua is already working on this board\'s page, or it changed meanwhile.' }
            : { ok: false, text: 'sua couldn\'t draw a page that checks out; the board is as it was.' };
    }
    return { ok: false, text: `There's no look "${look}".` };
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
}
