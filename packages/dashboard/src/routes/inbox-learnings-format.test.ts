/**
 * formatLearnings — renders retrieved lessons as the RELEVANT_LEARNINGS prompt
 * block (numbered, `[category]`-prefixed, byte-budget trimmed). Pure, so tested
 * without a store or app.
 */
import { describe, it, expect } from 'vitest';
import type { TriageLearning } from '@some-useful-agents/core';
import { formatLearnings } from './inbox.js';

const learning = (over: Partial<TriageLearning> = {}): TriageLearning => ({
  id: 'l', createdAt: 1, status: 'approved', source: 'run-failure',
  scope: 'agent', lesson: 'do the thing', ...over,
});

describe('formatLearnings', () => {
  it('returns empty string for no learnings', () => {
    expect(formatLearnings([])).toBe('');
  });

  it('numbers lessons and prefixes the category when present', () => {
    const out = formatLearnings([
      learning({ category: 'fix', lesson: 'install the CLI' }),
      learning({ lesson: 'check the host allowlist' }), // no category
    ]);
    expect(out).toBe('1. [fix] install the CLI\n2. check the host allowlist');
  });

  it('trims to the byte budget, dropping the tail', () => {
    const big = Array.from({ length: 50 }, (_, i) => learning({ lesson: `lesson ${i} `.repeat(20) }));
    const out = formatLearnings(big);
    const lineCount = out.split('\n').length;
    expect(out.length).toBeLessThanOrEqual(1600);  // ~budget + one overshooting line
    expect(lineCount).toBeLessThan(50);             // tail dropped
    expect(out.startsWith('1. ')).toBe(true);
  });
});
