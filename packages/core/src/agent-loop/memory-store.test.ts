import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentMemoryStore } from './memory-store.js';

describe('AgentMemoryStore', () => {
  let dir: string;
  let store: AgentMemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'amem-test-'));
    store = new AgentMemoryStore(join(dir, 'agent.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips an iteration row', () => {
    store.recordIteration({
      agentId: 'agent-a',
      rootRunId: 'root-1',
      iteration: 1,
      runId: 'root-1',
      inputsJson: JSON.stringify({ X: 'hi' }),
      observationsJson: JSON.stringify({ a: { status: 'completed' } }),
      evalStatus: 'failed',
      evalFailuresJson: JSON.stringify([{ description: 'x', passed: false }]),
    });
    const rows = store.listForRoot('agent-a', 'root-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId: 'agent-a',
      rootRunId: 'root-1',
      iteration: 1,
      runId: 'root-1',
      evalStatus: 'failed',
    });
  });

  it('orders iterations ascending and groups by root', () => {
    store.recordIteration({ agentId: 'a', rootRunId: 'r1', iteration: 2, runId: 'r1b', inputsJson: null, observationsJson: null, evalStatus: 'failed', evalFailuresJson: null });
    store.recordIteration({ agentId: 'a', rootRunId: 'r1', iteration: 1, runId: 'r1', inputsJson: null, observationsJson: null, evalStatus: 'failed', evalFailuresJson: null });
    store.recordIteration({ agentId: 'a', rootRunId: 'r1', iteration: 3, runId: 'r1c', inputsJson: null, observationsJson: null, evalStatus: 'passed', evalFailuresJson: null });
    store.recordIteration({ agentId: 'a', rootRunId: 'r2', iteration: 1, runId: 'r2', inputsJson: null, observationsJson: null, evalStatus: 'passed', evalFailuresJson: null });

    const root1 = store.listForRoot('a', 'r1');
    expect(root1.map((r) => r.iteration)).toEqual([1, 2, 3]);
    expect(store.listForRoot('a', 'r2')).toHaveLength(1);
  });

  it('upserts (replaces) on the (agent_id, root_run_id, iteration) PK', () => {
    store.recordIteration({ agentId: 'a', rootRunId: 'r', iteration: 1, runId: 'r', inputsJson: null, observationsJson: null, evalStatus: 'failed', evalFailuresJson: null });
    store.recordIteration({ agentId: 'a', rootRunId: 'r', iteration: 1, runId: 'r', inputsJson: null, observationsJson: null, evalStatus: 'passed', evalFailuresJson: null });
    const rows = store.listForRoot('a', 'r');
    expect(rows).toHaveLength(1);
    expect(rows[0].evalStatus).toBe('passed');
  });
});
