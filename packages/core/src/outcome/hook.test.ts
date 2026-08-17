/**
 * Integration coverage for the declarative wiring: registering
 * `onRunComplete: outcomeDetectionHook(...)` on a real `executeAgentDag`
 * call must produce a stored record, exactly once, for the agents that
 * opted in — including the paths (retry chains, eval loops) where the
 * hook is fired by a wrapper rather than the executor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '../run-store.js';
import { executeAgentDag, type DagExecutorDeps } from '../dag-executor.js';
import { executeAgentWithRetry } from '../retry.js';
import { executeAgentLoop } from '../agent-loop/runner.js';
import type { Agent } from '../agent-v2-types.js';
import { OutcomeStore } from './outcome-store.js';
import { outcomeDetectionHook } from './hook.js';
import type { OutcomeRecord } from './types.js';

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'hooked',
    name: 'Hooked',
    status: 'active',
    source: 'examples',
    version: 1,
    nodes: [{ id: 'work', type: 'shell', command: 'echo done' }],
    outcome: {
      expected: 'Work was done.',
      evidence: [{ kind: 'nodeResult', nodeId: 'work' }],
      success: [{ kind: 'shellExitZero', nodeId: 'work' }],
    },
    ...overrides,
  } as Agent;
}

describe('outcomeDetectionHook', () => {
  let dir: string;
  let runStore: RunStore;
  let outcomeStore: OutcomeStore;
  let seen: OutcomeRecord[];
  let deps: DagExecutorDeps;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-outcome-hook-'));
    runStore = new RunStore(join(dir, 'runs.db'));
    outcomeStore = new OutcomeStore(join(dir, 'outcomes.db'));
    seen = [];
    deps = {
      runStore,
      spawnNode: async () => ({ result: 'done', exitCode: 0 }),
      onRunComplete: outcomeDetectionHook({
        outcomeStore,
        onRecord: (r) => seen.push(r),
      }),
    };
  });

  afterEach(() => {
    runStore.close();
    outcomeStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores exactly one record for a plain run', async () => {
    const run = await executeAgentDag(agent(), { triggeredBy: 'cli' }, deps);

    expect(seen).toHaveLength(1);
    const stored = outcomeStore.get(run.id);
    expect(stored?.satisfied).toBe('yes');
    expect(stored?.record.observation.evidence[0].value).toBe('done');
  });

  // Detection must stay opt-in: registering the hook globally can't start
  // writing empty records for every agent in the system.
  it('skips agents that declared no outcome block', async () => {
    const run = await executeAgentDag(
      agent({ outcome: undefined }),
      { triggeredBy: 'cli' },
      deps,
    );
    expect(seen).toHaveLength(0);
    expect(outcomeStore.get(run.id)).toBeNull();
  });

  it('records a failed run rather than skipping it', async () => {
    const run = await executeAgentDag(agent(), { triggeredBy: 'cli' }, {
      ...deps,
      spawnNode: async () => ({ result: '', exitCode: 1, error: 'boom', category: 'exit_nonzero' }),
    });
    expect(run.status).toBe('failed');
    expect(outcomeStore.get(run.id)?.satisfied).toBe('no');
  });

  // The executor suppresses the hook on every internal retry attempt, so
  // the wrapper has to fire it. Before this was wired, ANY agent with
  // retry.attempts > 1 silently produced no record at all.
  it('fires exactly once for a retry chain, not once per attempt', async () => {
    let attempts = 0;
    const run = await executeAgentWithRetry(
      agent({ retry: { attempts: 3, delaySeconds: 0, categories: ['timeout'] } }),
      { triggeredBy: 'cli' },
      {
        ...deps,
        spawnNode: async () => {
          attempts++;
          return attempts < 3
            ? { result: '', exitCode: 1, error: 'slow', category: 'timeout' as const }
            : { result: 'done', exitCode: 0 };
        },
      },
      { sleepFn: async () => {} },
    );

    expect(attempts).toBe(3);
    expect(run.status).toBe('completed');
    expect(seen).toHaveLength(1);
    expect(seen[0].runId).toBe(run.id);
  });

  it('fires once for a whole eval loop, not once per iteration', async () => {
    let iterations = 0;
    await executeAgentLoop(
      agent({
        successCriteria: [{ kind: 'regexMatch', nodeId: 'work', pattern: 'never-matches' }],
        maxLoopIterations: 3,
      }),
      { triggeredBy: 'cli' },
      {
        ...deps,
        spawnNode: async () => {
          iterations++;
          return { result: 'done', exitCode: 0 };
        },
      },
    );

    expect(iterations).toBe(3); // the loop really did iterate…
    expect(seen).toHaveLength(1); // …and produced one outcome record.
  });

  it('never lets a broken detector change the run result', async () => {
    const warnings: string[] = [];
    const run = await executeAgentDag(agent(), { triggeredBy: 'cli' }, {
      ...deps,
      onRunComplete: async () => { throw new Error('detector exploded'); },
      notifyLogger: { warn: (m) => warnings.push(m) },
    });

    expect(run.status).toBe('completed');
    expect(warnings.join(' ')).toContain('detector exploded');
  });
});
