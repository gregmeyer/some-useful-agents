import { describe, it, expect } from 'vitest';
import type { LineagePass, LineageRun } from '@some-useful-agents/core';
import { notebookMadeBy, passStep } from './notebook-made-by.js';

const run = (id: string, agentId: string, startedAt: string): LineageRun => ({ id, agentId, status: 'completed', startedAt, triggeredBy: 'dashboard' });
const pass = (id: string, agentId: string, at: string, extra: Partial<LineagePass> = {}, subs: LineageRun[] = []): LineagePass => ({
  id, kind: 'pipeline', startedAt: at, feeders: [{ run: run(`r-${id}`, agentId, at), kinds: {}, seenAgain: 0, subRuns: subs }], ...extra,
});
const nb = { steps: [
  { id: 's1', title: 'Learn about Arrive', kind: 'profile' as const, status: 'done' as const, tries: 1 },
  { id: 's2', title: 'Find 5 sources', kind: 'find' as const, status: 'done' as const, tries: 1 },
  { id: 's3', title: 'Source facts', kind: 'source' as const, agentId: 'firmographic-research', status: 'done' as const, tries: 1 },
] };

describe('what made a notebook', () => {
  it('names each pass\'s step: the one it recorded, else the one step its agent does', () => {
    expect(passStep(nb, pass('a', 'anything', 'x', { stepId: 's2' }))).toBe('s2');
    expect(passStep(nb, pass('b', 'notebook-finder', 'x'))).toBe('s2');
    expect(passStep(nb, pass('c', 'firmographic-research', 'x'))).toBe('s3');
    expect(passStep(nb, pass('d', 'someone-else', 'x'))).toBeUndefined();
    expect(passStep(nb, pass('e', 'x', 'x', { stepId: 'gone' }))).toBeUndefined();
  });

  it('counts runs (with the ones they started), names who made it, and keeps each step\'s latest pass', () => {
    const m = notebookMadeBy(nb, { passes: [
      pass('new-find', 'notebook-finder', '2026-10-27T12:00:00Z', {}, [run('sub1', 'research-one', '2026-10-27T12:01:00Z'), run('sub2', 'research-one', '2026-10-27T12:02:00Z')]),
      pass('profile', 'research-one', '2026-10-27T11:00:00Z', { stepId: 's1' }),
      pass('old-find', 'notebook-finder', '2026-10-27T10:00:00Z'),
      pass('facts', 'firmographic-research', '2026-10-27T09:00:00Z'),
    ] }, (a) => (a === 'firmographic-research' ? 'Firmographic research' : undefined));
    expect(m.runs).toBe(6);
    expect(m.lastAt).toBe('2026-10-27T12:02:00Z');
    expect(m.agents).toEqual(['sua’s researcher', 'sua’s finder', 'Firmographic research']);
    expect(m.stepPass).toEqual({ s2: 'new-find', s1: 'profile', s3: 'facts' });
  });
});
