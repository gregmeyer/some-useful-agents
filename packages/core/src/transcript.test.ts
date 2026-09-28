import { describe, it, expect } from 'vitest';
import { budgetTranscript, droppedNote, takeWithinBudget } from './transcript.js';

describe('budgetTranscript', () => {
  it('keeps everything when it fits', () => {
    expect(budgetTranscript(['a', 'b'], { maxBytes: 100 })).toEqual({ lines: ['a', 'b'], dropped: 0 });
  });

  it('drops the oldest first and returns the rest oldest first', () => {
    const { lines, dropped } = budgetTranscript(['one', 'two', 'three', 'four'], { maxBytes: 11 });
    expect(lines).toEqual(['three', 'four']);
    expect(dropped).toBe(2);
  });

  it('cuts long lines and counts bytes, not characters', () => {
    expect(budgetTranscript(['abcdefghij'], { maxBytes: 100, lineMaxChars: 4 }).lines).toEqual(['abcd …(cut)']);
    expect(budgetTranscript(['éé', 'éé'], { maxBytes: 6 }).lines).toEqual(['éé']);
  });
});

describe('takeWithinBudget', () => {
  it('keeps the first (highest priority) lines until the budget runs out', () => {
    expect(takeWithinBudget(['aaa', 'bbb', 'ccc'], 8)).toEqual(['aaa', 'bbb']);
    expect(takeWithinBudget(['toolong'], 3)).toEqual([]);
  });
});

describe('droppedNote', () => {
  it('says how many were left out, with the right plural', () => {
    expect(droppedNote(0)).toBe('');
    expect(droppedNote(1)).toBe('(1 earlier turn left out for length)');
    expect(droppedNote(3, 'entry', 'entries')).toBe('(3 earlier entries left out for length)');
  });
});
