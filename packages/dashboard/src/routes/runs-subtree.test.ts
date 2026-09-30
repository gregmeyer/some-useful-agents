import { describe, it, expect } from 'vitest';
import type { Run } from '@some-useful-agents/core';
import { collectSubRunTree } from './runs.js';

const run = (id: string, parent?: string): Run => ({ id, agentName: id, status: 'completed', startedAt: '2026-09-30T10:00:00Z', triggeredBy: 'cli', parentRunId: parent } as Run);

describe('collectSubRunTree', () => {
  it('walks children depth-first with their depth, and stops at a loop or the depth cap', () => {
    const byParent: Record<string, Run[]> = {
      root: [run('a', 'root'), run('b', 'root')],
      a: [run('a1', 'a')],
      a1: [run('a1x', 'a1'), run('root', 'a1')], // a bad link back to the root
      a1x: [run('deep', 'a1x')],
      deep: [run('deeper', 'deep')],
    };
    const tree = collectSubRunTree({ listChildRuns: (id) => byParent[id] ?? [] }, 'root');
    expect(tree.map((r) => `${r.id}@${r.depth}`)).toEqual(['a@0', 'a1@1', 'a1x@2', 'deep@3', 'b@0']);
  });
});
