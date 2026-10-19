import { describe, it, expect } from 'vitest';
import { shortSteps } from './notebook-steps.js';

describe('shortSteps: what a completed run left undone', () => {
  it('names steps that failed and steps that ran out of turns', () => {
    expect(shortSteps([
      { nodeId: 'plan', status: 'completed' },
      { nodeId: 'gather-main', status: 'failed', error: 'error_max_turns: Reached maximum number of turns (10)' },
      { nodeId: 'gather-counter', status: 'completed', error: 'Ran out of turns (10), so claude answered from what it had already read; it may not have covered everything.' },
      { nodeId: 'lever', status: 'failed', error: 'Timed out after 240s' },
      { nodeId: 'workday', status: 'failed', error: 'exit 1' },
    ])).toBe("gather-main didn't finish (out of turns); lever didn't finish (timed out); workday didn't finish (failed); gather-counter ran out of turns and answered from part of its research");
  });

  it('says nothing when every step ran in full', () => {
    expect(shortSteps([{ nodeId: 'plan', status: 'completed' }, { nodeId: 'x', status: 'completed', error: 'claude was blocked from using WebFetch' }])).toBeUndefined();
    expect(shortSteps([])).toBeUndefined();
  });
});

describe("stepAgentHelpers: the agents sua's step agents call", () => {
  it('installs the checker with research-fanout and research-one, and the finder with its search', async () => {
    const { stepAgentHelpers } = await import('./notebook-step-agents.js');
    expect(stepAgentHelpers('notebook-checker')).toEqual(['research-fanout', 'research-one']);
    expect(stepAgentHelpers('notebook-finder')).toEqual(['notebook-find-one']);
    expect(stepAgentHelpers('my-own-agent')).toEqual([]);
  });
});
