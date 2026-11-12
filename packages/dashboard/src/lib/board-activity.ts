/**
 * What is running for a board right now, so its page can say so plainly:
 * sua reviewing it, drafting an agent for it, or redrawing its page, and
 * any of its agents mid-run. Read fresh on every ask; nothing is stored.
 */
import { BoardBuildStore, BoardReviewStore, BoardsStore, boardDocAgentIds } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { TODAY_BOARD_ID, todayEdition } from './today-edition.js';

type Ctx = ReturnType<typeof getContext>;

export interface BoardActivity {
  /** `sua`: something sua is doing to the board (the page redraws itself when it ends). `agent`: one of its agents running (its tile updates itself). */
  kind: 'review' | 'draft' | 'redraw' | 'ask' | 'agent';
  text: string;
  /** When it started (ISO), when known. */
  since?: string;
}

export function boardActivity(ctx: Ctx, boardId: string): BoardActivity[] {
  const out: BoardActivity[] = [];
  try {
    const db = ctx.runStore.databaseHandle();
    const review = new BoardReviewStore(db).latest(boardId);
    if (review?.status === 'running') out.push({ kind: 'review', text: 'sua is looking at this against its goal', since: new Date(review.createdAt).toISOString() });
    if (boardId !== TODAY_BOARD_ID) {
      const build = new BoardBuildStore(db).latestFor(boardId);
      if (build && (build.phase === 'planning' || build.phase === 'arranging' || build.phase === 'running' || build.phase === 'drafting')) {
        out.push({ kind: 'draft', text: build.phase === 'drafting' ? (build.detail || 'sua is drafting a new agent for this board') : (build.detail || 'sua is building this board'), since: new Date(build.createdAt).toISOString() });
      }
    } else if (ctx.editionAsk?.status === 'running') {
      out.push({ kind: 'ask', text: 'sua is working out the change you asked for', since: new Date(ctx.editionAsk.at).toISOString() });
    }
    if (ctx.boardPages?.has(boardId)) out.push({ kind: 'redraw', text: "sua is redrawing this board's page" });
    const ids = new Set(boardId === TODAY_BOARD_ID ? [...(todayEdition(ctx)?.tiles.keys() ?? [])] : boardDocAgentIds(new BoardsStore(db).loadDocOrDerive(boardId)?.doc ?? { components: [] }));
    for (const run of ctx.runStore.listRuns({ status: 'running', limit: 50 })) {
      // A run another agent started is part of that agent's work.
      if (!ids.has(run.agentName) || run.parentRunId) continue;
      const name = ctx.agentStore.getAgent(run.agentName)?.name ?? run.agentName;
      if (!out.some((x) => x.kind === 'agent' && x.text.startsWith(`${name} `))) out.push({ kind: 'agent', text: `${name} is running`, since: run.startedAt });
    }
  } catch { /* nothing to say */ }
  return out;
}
