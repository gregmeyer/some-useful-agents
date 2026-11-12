/**
 * "Improve this board" (ADR-0075): sua reviews a board against its goal and
 * suggests agents to add or leave out. This gathers what the reviewer reads
 * (the board's agents and the best candidates, each with what it actually
 * returns), runs one round in the background, and applies a suggestion when
 * the person presses its button: a new board version they can undo, the
 * agent run once, and the board's own page redrawn when sua composed it.
 */
import { randomUUID } from 'node:crypto';
import {
  AgentCatalogStore, BoardReviewStore, BoardsStore, SYSTEM_AGENT_IDS, applyBoardOps, boardDocAgentIds, boardFlagAgent, executeAgentDag,
  isComposedBoardDoc, parseBoardReview, rankAgentsByRelevance, sectionsFromBoardDoc,
  type Agent, type AgentSignal, type BoardDoc, type BoardReview, type StoredBoardSuggestion,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { maybeKickoffFirstRun } from '../routes/dashboard-first-run.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { buildPulseTile, withTileSignal } from '../views/pulse-tile-builder.js';
import { boardAgentShape } from './board-widgets.js';
import { boardPageIsItsOwn, decideBoardPage } from './board-page.js';
import { readLine } from './home-reads.js';

type Ctx = ReturnType<typeof getContext>;

export const BOARD_REVIEWER_ID = 'board-reviewer';
/** How many agents that aren't on the board the reviewer is shown. */
export const REVIEW_CANDIDATES = 25;

export const reviewsOf = (ctx: Ctx) => new BoardReviewStore(ctx.runStore.databaseHandle());
const boardsOf = (ctx: Ctx) => new BoardsStore(ctx.runStore.databaseHandle());

/** One agent as the reviewer reads it: what it is, what it returns, and its latest line. */
export interface ReviewAgent {
  id: string; title: string; description?: string; useFor?: string;
  outputs: Array<{ name: string; type: string; length?: number }>;
  latest?: string; lastRun?: string; failing?: true;
}

function describeAgent(ctx: Ctx, agent: Agent, useFor?: string): ReviewAgent | undefined {
  const withTile = withTileSignal(agent);
  if (!withTile.signal) return undefined;
  const tile = buildPulseTile(withTile as Agent & { signal: AgentSignal }, { runStore: ctx.runStore });
  const shape = boardAgentShape(tile, ctx.runStore);
  const last = ctx.runStore.listRuns({ agentName: agent.id, limit: 1 })[0];
  const done = last?.status === 'completed' ? last : ctx.runStore.listRuns({ agentName: agent.id, status: 'completed', limit: 1 })[0];
  const latest = readLine(done?.result, 160);
  const title = shape.title && !shape.title.includes('{{') ? shape.title : agent.name || agent.id;
  const description = (agent.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return {
    id: agent.id, title, ...(description ? { description } : {}), ...(useFor ? { useFor } : {}),
    outputs: shape.outputs.slice(0, 12).map((o) => ({ name: o.name, type: o.type, ...(o.length !== undefined ? { length: o.length } : {}) })),
    ...(latest ? { latest } : {}), ...(last ? { lastRun: (last.completedAt ?? last.startedAt).slice(0, 10) } : {}), ...(last?.status === 'failed' ? { failing: true as const } : {}),
  };
}

/**
 * The agents on a board: what its page shows (tiles, and parts bound to an
 * agent). The dashboard's old section list can name agents the page no
 * longer shows; those aren't on it, and may be suggested.
 */
export function boardAgentIds(_ctx: Ctx, _boardId: string, doc: BoardDoc): string[] {
  return boardDocAgentIds(doc);
}

/**
 * What the reviewer is given for a board: its agents, and the agents not on
 * it that best match the goal, the board's name and what's on it (ranked in
 * code; at most REVIEW_CANDIDATES). Only agents that have a tile and aren't
 * sua's own, archived or drafts.
 */
export function boardReviewInputs(ctx: Ctx, boardId: string): { inputs: Record<string, string>; onBoard: Set<string>; candidates: Set<string>; skipped: Set<string> } | undefined {
  const board = boardsOf(ctx).loadDocOrDerive(boardId);
  if (!board) return undefined;
  const goal = boardsOf(ctx).goal(boardId)?.text ?? '';
  const catalog = AgentCatalogStore.fromHandle(ctx.runStore.databaseHandle()).all();
  const onIds = boardAgentIds(ctx, boardId, board.doc);
  const on = onIds.map((id) => ctx.agentStore.getAgent(id)).filter((a): a is Agent => !!a).map((a) => describeAgent(ctx, a, catalog.get(a.id)?.useFor)).filter((a): a is ReviewAgent => !!a);
  const onBoard = new Set(onIds);
  const pool = ctx.agentStore.listAgents().filter((a) => a.status === 'active' && !SYSTEM_AGENT_IDS.has(a.id) && !a.id.startsWith('_') && !onBoard.has(a.id) && !!withTileSignal(a).signal);
  const query = [goal, board.name, ...on.map((a) => `${a.title} ${a.description ?? ''}`)].join(' ');
  // The most related first; with room to spare, the rest too (the reviewer judges by what each returns, not by its words).
  const ranked = rankAgentsByRelevance(pool, query).slice(0, REVIEW_CANDIDATES);
  const cands = ranked.map((r) => describeAgent(ctx, r.agent, catalog.get(r.agent.id)?.useFor)).filter((a): a is ReviewAgent => !!a);
  const skipped = new Set(reviewsOf(ctx).skippedKeys(boardId));
  const round = (reviewsOf(ctx).latest(boardId)?.round ?? 0);
  return {
    inputs: {
      GOAL: goal,
      BOARD: JSON.stringify({ name: board.name, agents: on }),
      CANDIDATES: JSON.stringify(cands),
      SKIPPED: JSON.stringify([...skipped]),
      ROUND: String(round),
    },
    onBoard, candidates: new Set(cands.map((c) => c.id)), skipped,
  };
}

async function runReviewer(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
  if (ctx.boardReviewRun) return ctx.boardReviewRun(inputs);
  // A page test that presses the button would otherwise start a real model run.
  if (process.env.VITEST) return undefined;
  if (!ensureSystemAgentCurrent(ctx, BOARD_REVIEWER_ID, 'board reviews')) return undefined;
  const agent = ctx.agentStore.getAgent(BOARD_REVIEWER_ID);
  if (!agent) return undefined;
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  try {
    await executeAgentDag(agent, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
      runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
      dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
    });
    const run = ctx.runStore.getRun(runId);
    return run?.status === 'completed' ? run.result ?? undefined : undefined;
  } finally {
    ctx.activeRuns.delete(runId);
  }
}

/**
 * Start the next round for a board, in the background. Returns the round
 * (running), or why not: no such board, Pulse, or a round already going.
 */
export function startBoardReview(ctx: Ctx, boardId: string): { review?: BoardReview; error?: string; work?: Promise<void> } {
  if (boardId === 'pulse' || boardId === 'today') return { error: 'Pulse has no goal to review against. Make a board for it.' };
  const reviews = reviewsOf(ctx);
  reviews.failStale();
  if (reviews.latest(boardId)?.status === 'running') return { error: 'sua is already looking at this board.' };
  const given = boardReviewInputs(ctx, boardId);
  if (!given) return { error: "There's no such board." };
  const review = reviews.start(boardId);
  const inputs = { ...given.inputs, ROUND: String(review.round) };
  const work = (async () => {
    try {
      const answer = parseBoardReview(await runReviewer(ctx, inputs), given);
      if (!answer) { reviews.fail(review.id, "sua didn't come back with a review that could be used. Look again to retry."); return; }
      // A goal is only proposed for a board without one.
      if (given.inputs.GOAL) delete answer.goal;
      reviews.finish(review.id, answer);
    } catch (err) {
      try { reviews.fail(review.id, err instanceof Error ? err.message : 'The review failed.'); } catch { /* the store is gone */ }
    }
  })();
  return { review, work };
}

/** The board's document with these agents' tiles added: in its first grid, else in a new "Added" section. */
export function docWithAgents(doc: BoardDoc, agentIds: readonly string[]): BoardDoc {
  const have = new Set(boardDocAgentIds(doc));
  const add = agentIds.filter((id) => !have.has(id));
  if (!add.length) return doc;
  let grid = doc.components.find((c) => c.component === 'Grid')?.id as string | undefined;
  let cur = doc;
  if (!grid || isComposedBoardDoc(doc.components)) {
    const sec = applyBoardOps(cur, [{ op: 'insert', parent: 'root', node: { type: 'section', title: 'Added' } }]);
    cur = sec.doc;
    grid = cur.components.find((c) => c.id === sec.created[0])!.child as string;
  }
  return applyBoardOps(cur, add.map((agentId) => ({ op: 'insert' as const, parent: grid!, node: { type: 'tile' as const, agentId } }))).doc;
}

/** The board's document without this agent: its tile, and any part drawn only when it has run. */
export function docWithoutAgent(doc: BoardDoc, agentId: string): BoardDoc {
  const ids = doc.components.filter((c) => (c.component === 'AgentTile' && c.agentId === agentId) || boardFlagAgent(c.when) === agentId).map((c) => String(c.id));
  let cur = doc;
  for (const id of ids) {
    // A part already gone with its parent is fine.
    if (!cur.components.some((c) => c.id === id)) continue;
    try { cur = applyBoardOps(cur, [{ op: 'remove', id }]).doc; } catch { /* gone with an earlier one */ }
  }
  return cur;
}

export interface AppliedSuggestions { applied: string[]; refused: Array<{ key: string; why: string }> }

/**
 * Apply open suggestions of a round (`keys`, or every open one): one new
 * board version. An agent to add must still be installed, have a tile and
 * not be on the board; one to leave out must still be on it. Added agents
 * run once. When sua composed the board's page (or it has none), the page
 * is redrawn in the background with the goal.
 */
export function applyBoardSuggestions(ctx: Ctx, boardId: string, reviewId: string, keys?: readonly string[]): AppliedSuggestions & { error?: string; redraw?: Promise<unknown> } {
  const reviews = reviewsOf(ctx);
  const review = reviews.get(reviewId);
  if (!review || review.boardId !== boardId) return { applied: [], refused: [], error: "That review isn't for this board." };
  const boards = boardsOf(ctx);
  const board = boards.loadDocOrDerive(boardId);
  if (!board) return { applied: [], refused: [], error: "There's no such board." };
  const open = review.suggestions.filter((s) => s.state === 'open' && (!keys || keys.includes(s.key)));
  const onBoard = new Set(boardAgentIds(ctx, boardId, board.doc));
  let doc = board.doc;
  const done: StoredBoardSuggestion[] = [];
  const refused: AppliedSuggestions['refused'] = [];
  for (const s of open) {
    if (s.type === 'add-agent') {
      const agent = ctx.agentStore.getAgent(s.agentId);
      if (!agent || agent.status !== 'active' || !withTileSignal(agent).signal) { refused.push({ key: s.key, why: `${s.agentId} isn't available any more.` }); continue; }
      if (onBoard.has(s.agentId)) { done.push(s); continue; }
      doc = docWithAgents(doc, [s.agentId]);
      onBoard.add(s.agentId);
      done.push(s);
    } else {
      if (onBoard.has(s.agentId)) { doc = docWithoutAgent(doc, s.agentId); onBoard.delete(s.agentId); }
      done.push(s);
    }
  }
  const changed = JSON.stringify(doc) !== JSON.stringify(board.doc);
  if (changed) {
    try {
      // A board that has never been saved is saved as it is first, so Undo has something to go back to.
      const from = board.derived ? boards.saveDoc({ id: boardId, name: board.name, packId: board.packId, doc: board.doc, expectedVersion: 0 }).version : board.version;
      boards.saveDoc({ id: boardId, name: board.name, packId: board.packId, doc, expectedVersion: from });
    } catch (err) {
      return { applied: [], refused, error: err instanceof Error ? err.message : 'The board could not be saved.' };
    }
    const dash = ctx.dashboardsStore?.getDashboard(boardId);
    if (dash) {
      // The dashboard's sections follow the page; an agent the page only binds (no tile) stays listed.
      const sections = sectionsFromBoardDoc(doc);
      const listed = new Set(sections.flatMap((x) => x.agentIds));
      const rest = [...onBoard].filter((id) => !listed.has(id));
      ctx.dashboardsStore!.upsertDashboard({ id: dash.id, packId: dash.packId, name: dash.name, layout: { sections: rest.length ? [...sections, { title: 'On this page', agentIds: rest }] : sections } });
    }
  }
  for (const s of done) reviews.setState(reviewId, s.key, 'applied');
  const added = done.filter((s) => s.type === 'add-agent').map((s) => s.agentId);
  for (const id of added) { try { maybeKickoffFirstRun(ctx, id); } catch { /* it can be run from its tile */ } }
  // The board's own page takes the change in: sua redraws it with the goal. A page you picked or arranged is left as it is.
  let redraw: Promise<unknown> | undefined;
  if (changed && boardPageIsItsOwn(boards.get(boardId) ?? {})) {
    redraw = decideBoardPage(ctx, boardId, { again: true }).catch(() => 'failed');
  }
  return { applied: done.map((s) => s.key), refused, ...(redraw ? { redraw } : {}) };
}

/** Turn a suggestion down: it isn't offered again on this board. */
export function skipBoardSuggestion(ctx: Ctx, boardId: string, reviewId: string, key: string): boolean {
  const reviews = reviewsOf(ctx);
  const review = reviews.get(reviewId);
  if (!review || review.boardId !== boardId) return false;
  return reviews.setState(reviewId, key, 'skipped');
}
