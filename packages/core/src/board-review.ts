/**
 * A board reviewed against its goal (ADR-0075). sua looks at what's on the
 * board, what else the person has, and what the board is for, and suggests
 * changes. The suggestions are checked here (only agents that exist, only
 * what wasn't turned down before), stored per round, and applied one by one
 * by the person. Nothing changes on a board because a review said so.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { extractTaggedJson } from './build-plan-schema.js';
import { BOARD_GOAL_MAX } from './boards.js';

export type BoardSuggestion =
  /** An agent the person has that isn't on the board. */
  | { type: 'add-agent'; agentId: string; why: string }
  /** A tile that repeats another, never runs, or keeps failing. */
  | { type: 'remove'; agentId: string; why: string };

export type BoardSuggestionState = 'open' | 'applied' | 'skipped';
export type StoredBoardSuggestion = BoardSuggestion & { key: string; state: BoardSuggestionState };

export interface BoardReview {
  id: string;
  boardId: string;
  round: number;
  status: 'running' | 'ready' | 'failed';
  /** A goal sua proposes, when the board had none. */
  goal?: string;
  suggestions: StoredBoardSuggestion[];
  /** sua's line on the round ("covers the top stories; nothing sorts them by topic"). */
  note?: string;
  /** Nothing more to suggest for this goal. */
  done?: boolean;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export const BOARD_REVIEW_MAX = 6;
const WHY_MAX = 200;

/** What a suggestion is, for telling it's the same one in a later round ("add-agent:hn-top-3"). */
export function boardSuggestionKey(s: BoardSuggestion): string {
  return `${s.type}:${s.agentId}`;
}

const line = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export interface BoardReviewAnswer { goal?: string; suggestions: BoardSuggestion[]; note?: string; done?: boolean }

/**
 * The reviewer's `<review>` answer, checked: an agent to add must be one of
 * the candidates it was shown and not on the board; one to remove must be on
 * the board; nothing the person skipped before; each once; at most
 * BOARD_REVIEW_MAX. Undefined when there is no usable answer. Pure.
 */
export function parseBoardReview(raw: string | undefined, known: { onBoard: ReadonlySet<string>; candidates: ReadonlySet<string>; skipped?: ReadonlySet<string> }): BoardReviewAnswer | undefined {
  const block = extractTaggedJson(raw ?? '', 'review');
  if (!block) return undefined;
  let v: { goal?: unknown; suggestions?: unknown; note?: unknown; done?: unknown };
  try { v = JSON.parse(block) as typeof v; } catch { return undefined; }
  if (!v || typeof v !== 'object') return undefined;
  const seen = new Set<string>();
  const suggestions: BoardSuggestion[] = [];
  for (const x of Array.isArray(v.suggestions) ? (v.suggestions as Array<Record<string, unknown>>) : []) {
    if (!x || typeof x !== 'object' || typeof x.agentId !== 'string') continue;
    const why = line(x.why, WHY_MAX);
    let s: BoardSuggestion | undefined;
    if (x.type === 'add-agent' && known.candidates.has(x.agentId) && !known.onBoard.has(x.agentId)) s = { type: 'add-agent', agentId: x.agentId, why };
    if (x.type === 'remove' && known.onBoard.has(x.agentId)) s = { type: 'remove', agentId: x.agentId, why };
    if (!s || !why) continue;
    const key = boardSuggestionKey(s);
    if (seen.has(key) || known.skipped?.has(key)) continue;
    seen.add(key);
    suggestions.push(s);
    if (suggestions.length === BOARD_REVIEW_MAX) break;
  }
  const goal = line(v.goal, BOARD_GOAL_MAX);
  const note = line(v.note, 300);
  return { ...(goal ? { goal } : {}), suggestions, ...(note ? { note } : {}), ...(v.done === true || suggestions.length === 0 ? { done: true } : {}) };
}

/** A board's reviews, round by round. */
export class BoardReviewStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS board_reviews (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS board_reviews_board ON board_reviews (board_id, round);
    `);
  }

  private read(row: { id: string; board_id: string; round: number; status: string; result_json: string; created_at: number; updated_at: number }): BoardReview {
    let r: Partial<BoardReview> = {};
    try { r = JSON.parse(row.result_json) as Partial<BoardReview>; } catch { r = {}; }
    return {
      id: row.id, boardId: row.board_id, round: row.round, status: row.status === 'ready' || row.status === 'failed' ? row.status : 'running',
      suggestions: Array.isArray(r.suggestions) ? r.suggestions : [],
      ...(r.goal ? { goal: r.goal } : {}), ...(r.note ? { note: r.note } : {}), ...(r.done ? { done: true } : {}), ...(r.error ? { error: r.error } : {}),
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  get(id: string): BoardReview | undefined {
    const row = this.db.prepare('SELECT * FROM board_reviews WHERE id = ?').get(id) as Parameters<BoardReviewStore['read']>[0] | undefined;
    return row ? this.read(row) : undefined;
  }

  /** The board's latest round, if it has been reviewed. */
  latest(boardId: string): BoardReview | undefined {
    const row = this.db.prepare('SELECT * FROM board_reviews WHERE board_id = ? ORDER BY round DESC LIMIT 1').get(boardId) as Parameters<BoardReviewStore['read']>[0] | undefined;
    return row ? this.read(row) : undefined;
  }

  /** Begin the next round (running). */
  start(boardId: string, now = Date.now()): BoardReview {
    const round = (this.latest(boardId)?.round ?? 0) + 1;
    const id = randomUUID();
    this.db.prepare("INSERT INTO board_reviews (id, board_id, round, status, result_json, created_at, updated_at) VALUES (?, ?, ?, 'running', '{}', ?, ?)").run(id, boardId, round, now, now);
    return this.get(id)!;
  }

  private write(id: string, status: BoardReview['status'], result: Partial<BoardReview>, now = Date.now()): BoardReview | undefined {
    this.db.prepare('UPDATE board_reviews SET status = ?, result_json = ?, updated_at = ? WHERE id = ?').run(status, JSON.stringify(result), now, id);
    return this.get(id);
  }

  finish(id: string, answer: BoardReviewAnswer): BoardReview | undefined {
    return this.write(id, 'ready', {
      ...(answer.goal ? { goal: answer.goal } : {}), ...(answer.note ? { note: answer.note } : {}), ...(answer.done ? { done: true } : {}),
      suggestions: answer.suggestions.map((s) => ({ ...s, key: boardSuggestionKey(s), state: 'open' as const })),
    });
  }

  fail(id: string, error: string): BoardReview | undefined {
    return this.write(id, 'failed', { suggestions: [], error: error.slice(0, 300) });
  }

  /** Mark one suggestion applied or skipped. False when there's no such open suggestion. */
  setState(id: string, key: string, state: Exclude<BoardSuggestionState, 'open'>): boolean {
    const r = this.get(id);
    const s = r?.suggestions.find((x) => x.key === key && x.state === 'open');
    if (!r || !s) return false;
    s.state = state;
    this.write(id, r.status, { ...(r.goal ? { goal: r.goal } : {}), ...(r.note ? { note: r.note } : {}), ...(r.done ? { done: true } : {}), suggestions: r.suggestions });
    return true;
  }

  /** Every suggestion the person turned down on this board, in any round: not to be offered again. */
  skippedKeys(boardId: string): string[] {
    const rows = this.db.prepare('SELECT * FROM board_reviews WHERE board_id = ?').all(boardId) as Array<Parameters<BoardReviewStore['read']>[0]>;
    return [...new Set(rows.flatMap((row) => this.read(row).suggestions.filter((s) => s.state === 'skipped').map((s) => s.key)))];
  }

  /** A round left running by a restart: it will never finish. */
  failStale(olderThanMs = 10 * 60_000, now = Date.now()): number {
    return Number(this.db.prepare("UPDATE board_reviews SET status = 'failed', result_json = ?, updated_at = ? WHERE status = 'running' AND updated_at < ?").run(JSON.stringify({ suggestions: [], error: 'The review was interrupted. Look again to retry.' }), now, now - olderThanMs).changes);
  }
}
