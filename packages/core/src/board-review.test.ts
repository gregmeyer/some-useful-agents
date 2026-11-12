import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { BoardReviewStore, boardSuggestionKey, parseBoardReview } from './board-review.js';

// A board reviewed against its goal: sua suggests, code checks, the person applies.

const known = { onBoard: new Set(['digest']), candidates: new Set(['classified', 'top3']), skipped: new Set(['add-agent:top3']) };
const answer = (v: unknown) => `Here.\n<review>\n${JSON.stringify(v)}\n</review>`;

describe("sua's review of a board, checked", () => {
  it('keeps an agent to add only if it was a candidate and is not on the board, one to remove only if it is on it; never one turned down before; each once', () => {
    const out = parseBoardReview(answer({
      goal: '  Know what matters\non HN each morning ', note: 'Covers the top five.', done: false,
      suggestions: [
        { type: 'add-agent', agentId: 'classified', why: 'Sorts the top five by topic, which the digest does not.' },
        { type: 'add-agent', agentId: 'classified', why: 'Again.' },
        { type: 'add-agent', agentId: 'top3', why: 'Turned down before.' },
        { type: 'add-agent', agentId: 'made-up', why: 'Not an agent they have.' },
        { type: 'add-agent', agentId: 'digest', why: 'Already on the board.' },
        { type: 'remove', agentId: 'digest', why: 'It keeps failing.' },
        { type: 'remove', agentId: 'classified', why: 'Not on the board.' },
        { type: 'add-agent', agentId: 'classified' },
        { type: 'paint-it-red', agentId: 'digest', why: 'x' },
      ],
    }), known)!;
    expect(out.goal).toBe('Know what matters on HN each morning');
    expect(out.note).toBe('Covers the top five.');
    expect(out.done).toBeUndefined();
    expect(out.suggestions).toEqual([
      { type: 'add-agent', agentId: 'classified', why: 'Sorts the top five by topic, which the digest does not.' },
      { type: 'remove', agentId: 'digest', why: 'It keeps failing.' },
    ]);
    expect(out.suggestions.map(boardSuggestionKey)).toEqual(['add-agent:classified', 'remove:digest']);
  });

  it('content is kept only when the board can carry it, from an agent that can give it', () => {
    const can = { ...known, content: { headline: new Set(['digest']), numbers: new Set<string>(), note: new Set(['digest']) } };
    const out = parseBoardReview(answer({ suggestions: [
      { type: 'content', kind: 'headline', from: 'digest', why: "Its summary says the day's news in a line." },
      { type: 'content', kind: 'headline', from: 'classified', why: 'Not on the board.' },
      { type: 'content', kind: 'numbers', from: 'digest', why: 'No figures on this board.' },
      { type: 'content', kind: 'top-story', from: 'digest', why: 'Not something this board can carry.' },
      { type: 'content', kind: 'note', why: 'Scores are from 8am.' },
      { type: 'content', kind: 'confetti', from: 'digest', why: 'Not a kind.' },
      { type: 'content', kind: 'headline', from: 'digest', why: 'Again.' },
    ] }), can)!;
    expect(out.suggestions).toEqual([
      { type: 'content', kind: 'headline', from: 'digest', why: "Its summary says the day's news in a line." },
      { type: 'content', kind: 'note', why: 'Scores are from 8am.' },
    ]);
    expect(out.suggestions.map(boardSuggestionKey)).toEqual(['content:headline:digest', 'content:note:']);
    // With nothing said about what the board can carry, no content is kept.
    expect(parseBoardReview(answer({ suggestions: [{ type: 'content', kind: 'headline', from: 'digest', why: 'A reason here.' }] }), known)!.suggestions).toEqual([]);
  });

  it('nothing to suggest is "done"; at most six; no block or bad JSON is no answer', () => {
    expect(parseBoardReview(answer({ suggestions: [], note: 'Serves the goal.' }), known)).toEqual({ suggestions: [], note: 'Serves the goal.', done: true });
    const many = { onBoard: new Set<string>(), candidates: new Set(Array.from({ length: 9 }, (_, i) => `a${String(i)}`)) };
    expect(parseBoardReview(answer({ suggestions: [...many.candidates].map((agentId) => ({ type: 'add-agent', agentId, why: 'Adds something.' })) }), many)!.suggestions).toHaveLength(6);
    expect(parseBoardReview('no block', known)).toBeUndefined();
    expect(parseBoardReview('<review>not json</review>', known)).toBeUndefined();
    expect(parseBoardReview(undefined, known)).toBeUndefined();
  });
});

describe('rounds of review, stored', () => {
  let db: DatabaseSync;
  beforeEach(() => { db = new DatabaseSync(':memory:'); });
  afterEach(() => { db.close(); });

  it('each round runs, then is ready with its suggestions open; one is applied or skipped once; skipped ones are remembered across rounds', () => {
    const store = new BoardReviewStore(db);
    expect(store.latest('b')).toBeUndefined();
    const r1 = store.start('b');
    expect(r1).toMatchObject({ boardId: 'b', round: 1, status: 'running', suggestions: [] });
    const ready = store.finish(r1.id, { goal: 'A goal', note: 'n', suggestions: [{ type: 'add-agent', agentId: 'x', why: 'w' }, { type: 'remove', agentId: 'y', why: 'w' }] })!;
    expect(ready).toMatchObject({ status: 'ready', goal: 'A goal', note: 'n' });
    expect(ready.suggestions.map((s) => [s.key, s.state])).toEqual([['add-agent:x', 'open'], ['remove:y', 'open']]);
    expect(store.setState(r1.id, 'add-agent:x', 'applied')).toBe(true);
    expect(store.setState(r1.id, 'add-agent:x', 'skipped')).toBe(false);
    expect(store.setState(r1.id, 'remove:y', 'skipped')).toBe(true);
    expect(store.setState(r1.id, 'nope', 'skipped')).toBe(false);
    expect(store.latest('b')!.suggestions.map((s) => s.state)).toEqual(['applied', 'skipped']);
    expect(store.latest('b')).toMatchObject({ goal: 'A goal', note: 'n' });
    const r2 = store.start('b');
    expect(r2.round).toBe(2);
    store.finish(r2.id, { suggestions: [], done: true });
    expect(store.latest('b')).toMatchObject({ round: 2, done: true });
    expect(store.skippedKeys('b')).toEqual(['remove:y']);
    expect(store.skippedKeys('other')).toEqual([]);
  });

  it('a failed round says why; a round left running by a restart is failed, a fresh one is not', () => {
    const store = new BoardReviewStore(db);
    const r = store.start('b', 1_000);
    expect(store.failStale(600_000, 1_000 + 60_000)).toBe(0);
    expect(store.failStale(600_000, 1_000 + 700_000)).toBe(1);
    expect(store.get(r.id)).toMatchObject({ status: 'failed', error: 'The review was interrupted. Look again to retry.' });
    const f = store.start('b');
    expect(store.fail(f.id, 'boom')).toMatchObject({ status: 'failed', error: 'boom', suggestions: [] });
  });
});
