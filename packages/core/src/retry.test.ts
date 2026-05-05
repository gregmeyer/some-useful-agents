import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import {
  executeAgentWithRetry,
  isRetryableCategory,
  computeBackoffDelay,
  DEFAULT_RETRY_CATEGORIES,
} from './retry.js';
import type { Agent, NodeErrorCategory, RetryPolicy } from './agent-v2-types.js';
import type { Run } from './types.js';
import type { DagExecuteOptions, DagExecutorDeps } from './dag-executor.js';

const TEST_DB = join(import.meta.dirname, '__test-data__', 'retry.db');

let store: RunStore;
beforeEach(() => { store = new RunStore(TEST_DB); });
afterEach(() => {
  store.close();
  rmSync(join(import.meta.dirname, '__test-data__'), { recursive: true, force: true });
});

function makeAgent(retry?: RetryPolicy): Agent {
  return {
    id: 'flake', name: 'flake', status: 'active', source: 'local',
    version: 1, mcp: false,
    nodes: [{ id: 'main', type: 'shell', command: 'exit 1' }],
    retry,
  } as Agent;
}

// Build a minimal deps fixture. The test never calls the real executor;
// we stub through executeAgentWithRetry's hooks + a fake executor injected
// via the deps' spawnNode. But the wrapper calls executeAgentDag directly,
// so for these tests we instead test the wrapper's PURE helpers and
// orchestrate behaviour by writing pre-canned runs to the store and
// stubbing executeAgentDag at the module boundary via a thin shim.
//
// Rather than mock the executor, we run a minimal fake by invoking the
// wrapper with a custom deps object whose runStore is real and whose
// downstream behaviour is encoded by a deterministic stand-in. The
// wrapper calls `executeAgentDag(agent, options, deps)`; we'd need to
// substitute that. Since the wrapper uses a static import, we test the
// helpers directly and then add a smaller integration test below that
// uses a real (cheap) shell command.

describe('isRetryableCategory', () => {
  it('returns false for undefined', () => {
    expect(isRetryableCategory(undefined, { categories: ['timeout'] })).toBe(false);
  });

  it('honours the policy categories list', () => {
    expect(isRetryableCategory('timeout', { categories: ['timeout'] })).toBe(true);
    expect(isRetryableCategory('exit_nonzero', { categories: ['timeout'] })).toBe(false);
  });

  it('falls back to DEFAULT_RETRY_CATEGORIES when policy.categories is undefined', () => {
    expect(isRetryableCategory('timeout', {})).toBe(true);
    expect(isRetryableCategory('spawn_failure', {})).toBe(true);
    expect(isRetryableCategory('exit_nonzero', {})).toBe(false);
    expect(DEFAULT_RETRY_CATEGORIES).toContain('timeout');
    expect(DEFAULT_RETRY_CATEGORIES).toContain('spawn_failure');
  });

  it('NEVER retries deterministic / user-driven categories regardless of policy', () => {
    const broad: { categories: NodeErrorCategory[] } = {
      categories: ['setup', 'input_resolution', 'cancelled', 'condition_not_met', 'flow_ended', 'upstream_failed'],
    };
    expect(isRetryableCategory('setup', broad)).toBe(false);
    expect(isRetryableCategory('input_resolution', broad)).toBe(false);
    expect(isRetryableCategory('cancelled', broad)).toBe(false);
    expect(isRetryableCategory('condition_not_met', broad)).toBe(false);
    expect(isRetryableCategory('flow_ended', broad)).toBe(false);
    // upstream_failed isn't on the never-retry list, but it's a cascade —
    // the wrapper looks for the root-cause category, not this.
    expect(isRetryableCategory('upstream_failed', broad)).toBe(true);
  });
});

describe('computeBackoffDelay', () => {
  it('exponential doubles per attempt', () => {
    const p = { backoff: 'exponential' as const, delaySeconds: 10 };
    expect(computeBackoffDelay(p, 1)).toBe(10);
    expect(computeBackoffDelay(p, 2)).toBe(20);
    expect(computeBackoffDelay(p, 3)).toBe(40);
    expect(computeBackoffDelay(p, 4)).toBe(80);
  });

  it('linear scales with attempt', () => {
    const p = { backoff: 'linear' as const, delaySeconds: 10 };
    expect(computeBackoffDelay(p, 1)).toBe(10);
    expect(computeBackoffDelay(p, 2)).toBe(20);
    expect(computeBackoffDelay(p, 3)).toBe(30);
  });

  it('fixed always returns the base delay', () => {
    const p = { backoff: 'fixed' as const, delaySeconds: 10 };
    expect(computeBackoffDelay(p, 1)).toBe(10);
    expect(computeBackoffDelay(p, 5)).toBe(10);
  });

  it('defaults to exponential when backoff is unset', () => {
    expect(computeBackoffDelay({ delaySeconds: 5 }, 3)).toBe(20);
  });

  it('defaults delaySeconds to 30 when unset', () => {
    expect(computeBackoffDelay({}, 1)).toBe(30);
  });

  it('caps at MAX_BACKOFF_SECONDS (3600)', () => {
    expect(computeBackoffDelay({ delaySeconds: 1000 }, 5)).toBe(3600);
  });
});

// -- executeAgentWithRetry orchestration --
//
// To avoid spawning real shells, we exercise the wrapper by stubbing
// executeAgentDag via a custom deps.spawnNode — but the wrapper itself
// imports executeAgentDag directly, not through deps. The cleanest route
// is to use the helpers above for the bulk of the logic and add one
// end-to-end test below using a tiny shell command. However we can also
// test the wrapper's "no policy → single executor call" fast path by
// observing that a passing run (status: completed) doesn't loop.

describe('executeAgentWithRetry — fall-through semantics', () => {
  it('agents without retry policy go through executeAgentDag exactly once', async () => {
    const agent = makeAgent(/* no retry */);
    let calls = 0;
    const fakeOptions: DagExecuteOptions = { triggeredBy: 'cli' };
    const fakeDeps: DagExecutorDeps = {
      runStore: store,
      // The real executor runs `exit 1` and would write a failed run row.
      // We stub by passing a spawnNode that returns a synthetic completed
      // result so the executor doesn't actually fork a process.
      spawnNode: async () => {
        calls++;
        return { result: 'ok', exitCode: 0 };
      },
    };
    const run = await executeAgentWithRetry(agent, fakeOptions, fakeDeps);
    expect(run.status).toBe('completed');
    expect(calls).toBe(1);
  });

  it('attempts <= 1 (or unset) skips the retry loop', async () => {
    const agent = makeAgent({ attempts: 1 });
    let calls = 0;
    const fakeOptions: DagExecuteOptions = { triggeredBy: 'cli' };
    const fakeDeps: DagExecutorDeps = {
      runStore: store,
      spawnNode: async () => {
        calls++;
        return { result: '', exitCode: 1, error: 'boom', category: 'exit_nonzero' };
      },
    };
    const run = await executeAgentWithRetry(agent, fakeOptions, fakeDeps);
    expect(run.status).toBe('failed');
    expect(calls).toBe(1);
  });
});

describe('executeAgentWithRetry — retry loop', () => {
  // The cleanest way to exercise the loop is to seed deps.spawnNode to
  // fail twice (with a retryable category) then succeed on the third
  // attempt. The wrapper's getFailureCategory reads node_executions, which
  // the executor populates per-attempt — so we don't need to stub category
  // detection.

  it('retries on transient failure and succeeds on attempt 2', async () => {
    const agent = makeAgent({ attempts: 3, delaySeconds: 1, categories: ['timeout'] });
    let calls = 0;
    const fakeOptions: DagExecuteOptions = { triggeredBy: 'cli' };
    const onRetryAttempts: number[] = [];

    const fakeDeps: DagExecutorDeps = {
      runStore: store,
      spawnNode: async () => {
        calls++;
        if (calls === 1) {
          // First call: simulate a timeout — exit code -1 + the executor
          // categorises as 'timeout' when stderr looks like one, but the
          // simpler shape is to throw a TimeoutError. The local executor
          // sets errorCategory based on the spawn result. For this test
          // we use a non-zero exit and rely on the wrapper not treating
          // 'exit_nonzero' as retryable (since policy is timeout-only).
          // To get 'timeout' classification, the spawnNode promise needs
          // to throw with the right shape. We sidestep by manually writing
          // the node_execution row's errorCategory after the executor
          // creates it… but executor owns that path.
          //
          // Simpler: use a category the executor naturally produces.
          // exit_nonzero is the natural one for `exit 1`. Switch the
          // policy to retry on exit_nonzero for this test.
          return { result: '', exitCode: 1, error: 'fail', category: 'exit_nonzero' };
        }
        return { result: 'ok', exitCode: 0 };
      },
    };

    // Adjust policy to use exit_nonzero (the category the fake spawn produces).
    agent.retry = { attempts: 3, delaySeconds: 0, categories: ['exit_nonzero'] };
    const run = await executeAgentWithRetry(agent, fakeOptions, fakeDeps, {
      sleepFn: async () => {},
      onRetry: (attempt) => onRetryAttempts.push(attempt),
    });

    expect(run.status).toBe('completed');
    expect(calls).toBe(2);
    expect(run.attempt).toBe(2);
    expect(run.retryOfRunId).toBeDefined();
    expect(onRetryAttempts).toEqual([2]);
  });

  it('exhausts the budget when failures keep coming', async () => {
    const agent = makeAgent({ attempts: 3, delaySeconds: 0, categories: ['exit_nonzero'] });
    let calls = 0;
    const fakeDeps: DagExecutorDeps = {
      runStore: store,
      spawnNode: async () => {
        calls++;
        return { result: '', exitCode: 1, error: 'fail', category: 'exit_nonzero' };
      },
    };
    const run = await executeAgentWithRetry(
      agent, { triggeredBy: 'cli' }, fakeDeps,
      { sleepFn: async () => {} },
    );
    expect(run.status).toBe('failed');
    expect(calls).toBe(3);
    expect(run.attempt).toBe(3);

    // Chain has all 3 attempts.
    const chain = store.getRetryChain(run.id);
    expect(chain.length).toBe(3);
    expect(chain.map((r) => r.attempt).sort()).toEqual([1, 2, 3]);
  });

  it('does not retry when the failure category is not in the policy list', async () => {
    const agent = makeAgent({ attempts: 5, delaySeconds: 0, categories: ['timeout'] });
    let calls = 0;
    const fakeDeps: DagExecutorDeps = {
      runStore: store,
      spawnNode: async () => {
        calls++;
        // exit_nonzero — not in the retry list.
        return { result: '', exitCode: 1, error: 'fail', category: 'exit_nonzero' };
      },
    };
    const run = await executeAgentWithRetry(
      agent, { triggeredBy: 'cli' }, fakeDeps,
      { sleepFn: async () => {} },
    );
    expect(run.status).toBe('failed');
    expect(calls).toBe(1);
  });

  it('honours options.retryOf as the starting attempt number', async () => {
    // Manual retry already burned attempts 1 + 2; this run starts at 3
    // with a 4-attempt policy → only 1 more auto-retry is allowed.
    const agent = makeAgent({ attempts: 4, delaySeconds: 0, categories: ['exit_nonzero'] });
    let calls = 0;
    const fakeDeps: DagExecutorDeps = {
      runStore: store,
      spawnNode: async () => {
        calls++;
        return { result: '', exitCode: 1, error: 'fail', category: 'exit_nonzero' };
      },
    };
    // Pre-create the head run so retryOf has somewhere to point. The
    // wrapper itself doesn't validate the parent exists; the executor's
    // createRun does. For this test the chain integrity is covered by R1.
    store.createRun({
      id: 'head', agentName: 'flake', status: 'failed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });
    const run = await executeAgentWithRetry(
      agent,
      { triggeredBy: 'cli', retryOf: { originalRunId: 'head', attempt: 3 } },
      fakeDeps,
      { sleepFn: async () => {} },
    );
    expect(run.status).toBe('failed');
    // Started at 3, can go to 4 (one more attempt under attempts=4) → 2 calls total.
    expect(calls).toBe(2);
  });

  it('aborts the loop when the signal fires between attempts', async () => {
    const agent = makeAgent({ attempts: 5, delaySeconds: 0, categories: ['exit_nonzero'] });
    let calls = 0;
    const ctl = new AbortController();
    const fakeDeps: DagExecutorDeps = {
      runStore: store,
      spawnNode: async () => {
        calls++;
        if (calls === 1) ctl.abort();
        return { result: '', exitCode: 1, error: 'fail', category: 'exit_nonzero' };
      },
    };
    const run = await executeAgentWithRetry(
      agent,
      { triggeredBy: 'cli', signal: ctl.signal },
      fakeDeps,
      { sleepFn: async () => {} },
    );
    // Loop entered, signal aborted before attempt 2 → only 1 spawn.
    expect(calls).toBe(1);
    expect(run.status).toBe('failed');
  });
});
