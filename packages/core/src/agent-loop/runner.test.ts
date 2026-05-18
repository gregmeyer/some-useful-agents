import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeAgentLoop } from './runner.js';
import { AgentMemoryStore } from './memory-store.js';
import type { Agent } from '../agent-v2-types.js';
import type { Run } from '../types.js';
import type { DagExecutorDeps } from '../dag-executor.js';

// Mock `executeAgentWithRetry` so tests don't spin up a real DAG executor.
vi.mock('../retry.js', async (orig) => {
  const real = await orig<typeof import('../retry.js')>();
  return {
    ...real,
    executeAgentWithRetry: vi.fn(),
  };
});

import { executeAgentWithRetry } from '../retry.js';

const baseAgent: Agent = {
  id: 'test-agent',
  name: 'test',
  status: 'active',
  source: 'local',
  version: 1,
  nodes: [{ id: 'a', type: 'shell', command: 'echo' }],
};

function makeRun(id: string, status: Run['status'] = 'completed'): Run {
  return {
    id, agentName: 'test-agent', status,
    startedAt: '2026-05-18T00:00:00Z',
    triggeredBy: 'cli',
  };
}

/**
 * Build a deps stub. Only `runStore.listNodeExecutions` is used by the
 * runner; the mocked executeAgentWithRetry doesn't touch the rest.
 */
function stubDeps(execs: Record<string, Array<{ nodeId: string; status: string; exitCode?: number; result?: string }>>): DagExecutorDeps {
  return {
    runStore: {
      listNodeExecutions: (runId: string) => execs[runId] ?? [],
    },
  } as unknown as DagExecutorDeps;
}

describe('executeAgentLoop', () => {
  let tmpDir: string;
  let memory: AgentMemoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentloop-test-'));
    memory = new AgentMemoryStore(join(tmpDir, 'mem.db'));
    vi.mocked(executeAgentWithRetry).mockReset();
  });

  afterEach(() => {
    memory.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is a pure pass-through when the agent declares no successCriteria', async () => {
    vi.mocked(executeAgentWithRetry).mockResolvedValueOnce(makeRun('r1'));
    const result = await executeAgentLoop(baseAgent, { triggeredBy: 'cli' }, stubDeps({}));
    expect(result.id).toBe('r1');
    expect(executeAgentWithRetry).toHaveBeenCalledOnce();
  });

  it('runs once + returns when criteria pass on the first iteration', async () => {
    vi.mocked(executeAgentWithRetry).mockResolvedValueOnce(makeRun('r1'));
    const agent: Agent = {
      ...baseAgent,
      successCriteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      maxLoopIterations: 3,
    };
    const deps = stubDeps({ r1: [{ nodeId: 'a', status: 'completed', exitCode: 0 }] });
    const result = await executeAgentLoop(agent, { triggeredBy: 'cli' }, deps, { memoryStore: memory });
    expect(result.id).toBe('r1');
    expect(executeAgentWithRetry).toHaveBeenCalledOnce();
    const mem = memory.listForRoot('test-agent', 'r1');
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({ iteration: 1, evalStatus: 'passed' });
  });

  it('re-runs up to maxLoopIterations when criteria fail, recording each iteration', async () => {
    vi.mocked(executeAgentWithRetry)
      .mockResolvedValueOnce(makeRun('r1'))
      .mockResolvedValueOnce(makeRun('r2'))
      .mockResolvedValueOnce(makeRun('r3'));
    const agent: Agent = {
      ...baseAgent,
      successCriteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      maxLoopIterations: 3,
    };
    const deps = stubDeps({
      r1: [{ nodeId: 'a', status: 'completed', exitCode: 1 }],
      r2: [{ nodeId: 'a', status: 'completed', exitCode: 1 }],
      r3: [{ nodeId: 'a', status: 'completed', exitCode: 1 }],
    });
    const result = await executeAgentLoop(agent, { triggeredBy: 'cli' }, deps, { memoryStore: memory });
    expect(result.id).toBe('r3'); // last iteration's run
    expect(executeAgentWithRetry).toHaveBeenCalledTimes(3);
    const mem = memory.listForRoot('test-agent', 'r1');
    expect(mem.map((m) => m.iteration)).toEqual([1, 2, 3]);
    expect(mem.every((m) => m.evalStatus === 'failed')).toBe(true);
  });

  it('stops early when an iteration passes', async () => {
    vi.mocked(executeAgentWithRetry)
      .mockResolvedValueOnce(makeRun('r1'))
      .mockResolvedValueOnce(makeRun('r2'));
    const agent: Agent = {
      ...baseAgent,
      successCriteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      maxLoopIterations: 5,
    };
    const deps = stubDeps({
      r1: [{ nodeId: 'a', status: 'completed', exitCode: 1 }],
      r2: [{ nodeId: 'a', status: 'completed', exitCode: 0 }],
    });
    const result = await executeAgentLoop(agent, { triggeredBy: 'cli' }, deps, { memoryStore: memory });
    expect(result.id).toBe('r2');
    expect(executeAgentWithRetry).toHaveBeenCalledTimes(2);
    const mem = memory.listForRoot('test-agent', 'r1');
    expect(mem.map((m) => m.evalStatus)).toEqual(['failed', 'passed']);
  });

  it('aborts after a transient failure without re-iterating', async () => {
    vi.mocked(executeAgentWithRetry).mockResolvedValueOnce(makeRun('r1', 'failed'));
    const agent: Agent = {
      ...baseAgent,
      successCriteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      maxLoopIterations: 3,
    };
    const result = await executeAgentLoop(agent, { triggeredBy: 'cli' }, stubDeps({}), { memoryStore: memory });
    expect(result.status).toBe('failed');
    expect(executeAgentWithRetry).toHaveBeenCalledOnce();
    const mem = memory.listForRoot('test-agent', 'r1');
    expect(mem[0].evalStatus).toBe('transient-error');
  });

  it('injects LOOP_FEEDBACK on iteration 2+ but not on the first', async () => {
    vi.mocked(executeAgentWithRetry)
      .mockResolvedValueOnce(makeRun('r1'))
      .mockResolvedValueOnce(makeRun('r2'));
    const agent: Agent = {
      ...baseAgent,
      successCriteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      maxLoopIterations: 2,
    };
    const deps = stubDeps({
      r1: [{ nodeId: 'a', status: 'completed', exitCode: 1 }],
      r2: [{ nodeId: 'a', status: 'completed', exitCode: 0 }],
    });
    await executeAgentLoop(agent, { triggeredBy: 'cli', inputs: { Q: 'hi' } }, deps);

    const calls = vi.mocked(executeAgentWithRetry).mock.calls;
    expect(calls[0][1].inputs?.LOOP_FEEDBACK).toBe(''); // first iteration: empty
    expect(calls[1][1].inputs?.LOOP_FEEDBACK).toContain('Eval feedback');
    expect(calls[1][1].inputs?.LOOP_FEEDBACK).toContain('shellExitZero(a)');
    expect(calls[1][1].inputs?.Q).toBe('hi'); // user inputs preserved
  });

  it('fires onEvalRetry hook before each retry iteration', async () => {
    vi.mocked(executeAgentWithRetry)
      .mockResolvedValueOnce(makeRun('r1'))
      .mockResolvedValueOnce(makeRun('r2'));
    const agent: Agent = {
      ...baseAgent,
      successCriteria: [{ kind: 'shellExitZero', nodeId: 'a' }],
      maxLoopIterations: 2,
    };
    const deps = stubDeps({
      r1: [{ nodeId: 'a', status: 'completed', exitCode: 1 }],
      r2: [{ nodeId: 'a', status: 'completed', exitCode: 0 }],
    });
    const onEvalRetry = vi.fn();
    await executeAgentLoop(agent, { triggeredBy: 'cli' }, deps, {}, { onEvalRetry });
    expect(onEvalRetry).toHaveBeenCalledOnce();
    expect(onEvalRetry).toHaveBeenCalledWith(2, expect.any(Array));
  });
});
