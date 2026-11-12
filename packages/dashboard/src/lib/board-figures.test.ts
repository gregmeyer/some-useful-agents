import { describe, it, expect } from 'vitest';
import { boardFiguresFrom, figuresInWords } from './board-figures.js';
import { contentAsk } from './board-review.js';
import type { BriefFigure } from './home-brief.js';

const fig = (agentId: string, label: string, kind: 'count' | 'percent', vals: number[], lastDay = 11): BriefFigure => ({
  agentId, agent: agentId.toUpperCase(), runId: `run-${agentId}`, key: 'k', label, kind, value: vals[vals.length - 1],
  text: kind === 'percent' ? `${String(vals[vals.length - 1])}%` : String(vals[vals.length - 1]),
  days: vals.map((value, i) => ({ day: `2026-11-${String(lastDay - (vals.length - 1 - i)).padStart(2, '0')}`, value })),
});

describe("a board's figures, from its agents' own results", () => {
  it('the largest count leads with its days (the last one "Today" only when it is today); percentages, then other counts, follow, three at most', () => {
    const all = [fig('personal', 'matched', 'count', [2, 0, 1]), fig('digest', 'matches', 'count', [5, 2, 6]), fig('markets', 'NASDAQ', 'percent', [-7.42, -3.56, -1.46]), fig('markets', 'DOW', 'percent', [-2.27, 0.09, 0.89]), fig('prs', 'open', 'count', [3, 4, 2])];
    const f = boardFiguresFrom(all, '2026-11-11')!;
    expect(f.lead).toEqual({ value: '6', label: 'matches', note: 'DIGEST', href: '/runs/run-digest', days: [{ label: 'Mon', value: 5, text: '5' }, { label: 'Tue', value: 2, text: '2' }, { label: 'Today', value: 6, text: '6' }] });
    expect(f.others.map((o) => [o.label, o.value, o.values])).toEqual([['NASDAQ', '-1.46%', [-7.42, -3.56, -1.46]], ['DOW', '0.89%', [-2.27, 0.09, 0.89]], ['matched', '1', [2, 0, 1]]]);
    expect(figuresInWords(f)).toEqual({ lead: '6 matches (DIGEST), 3 days', others: ['-1.46% NASDAQ (MARKETS)', '0.89% DOW (MARKETS)', '1 matched (PERSONAL)'] });
    // Not run today: the last day is named, not called today.
    expect(boardFiguresFrom(all, '2026-11-13')!.lead.days[2].label).toBe('Wed');
  });

  it('is nothing without a count above zero that has three days', () => {
    expect(boardFiguresFrom([])).toBeUndefined();
    expect(boardFiguresFrom([fig('markets', 'NASDAQ', 'percent', [1, 2, 3])])).toBeUndefined();
    expect(boardFiguresFrom([fig('digest', 'matches', 'count', [5, 2, 0])])).toBeUndefined();
    expect(boardFiguresFrom([fig('digest', 'matches', 'count', [5, 6])])).toBeUndefined();
  });

  it('a content suggestion becomes a plain ask for the page', () => {
    expect(contentAsk('headline', 'HN Digest', 'x')).toBe("Lead the page with the day's headline from HN Digest's result, as a lede right under the masthead.");
    expect(contentAsk('numbers', 'x', 'x')).toContain('/board/figures');
    expect(contentAsk('top-story', 'HN Digest', 'x')).toBe("Show the top item of HN Digest's list near the top of the page, with its link.");
    expect(contentAsk('note', 'the board', 'Scores are from 8am.')).toBe('Add one short line of context under the masthead: Scores are from 8am.');
  });
});
