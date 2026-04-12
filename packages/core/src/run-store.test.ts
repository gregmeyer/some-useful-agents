import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import type { Run } from './types.js';

const TEST_DB = join(import.meta.dirname, '__test-data__', 'test-runs.db');

function makeRun(overrides?: Partial<Run>): Run {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentName: 'test-agent',
    status: 'completed',
    startedAt: new Date().toISOString(),
    triggeredBy: 'cli',
    ...overrides,
  };
}

let store: RunStore;

beforeEach(() => {
  store = new RunStore(TEST_DB);
});

afterEach(() => {
  store.close();
  rmSync(join(import.meta.dirname, '__test-data__'), { recursive: true, force: true });
});

describe('RunStore', () => {
  it('creates and retrieves a run', () => {
    const run = makeRun({ id: 'run-1' });
    store.createRun(run);
    const retrieved = store.getRun('run-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.agentName).toBe('test-agent');
  });

  it('returns null for non-existent run', () => {
    expect(store.getRun('nonexistent')).toBeNull();
  });

  it('updates run status', () => {
    const run = makeRun({ id: 'run-2', status: 'running' });
    store.createRun(run);
    store.updateRun('run-2', { status: 'completed', completedAt: new Date().toISOString() });
    const updated = store.getRun('run-2');
    expect(updated!.status).toBe('completed');
    expect(updated!.completedAt).toBeTruthy();
  });

  it('lists runs filtered by agent name', () => {
    store.createRun(makeRun({ id: 'r1', agentName: 'agent-a' }));
    store.createRun(makeRun({ id: 'r2', agentName: 'agent-b' }));
    store.createRun(makeRun({ id: 'r3', agentName: 'agent-a' }));
    const runs = store.listRuns({ agentName: 'agent-a' });
    expect(runs.length).toBe(2);
    expect(runs.every(r => r.agentName === 'agent-a')).toBe(true);
  });

  it('lists runs filtered by status', () => {
    store.createRun(makeRun({ id: 'r1', status: 'completed' }));
    store.createRun(makeRun({ id: 'r2', status: 'failed' }));
    const runs = store.listRuns({ status: 'failed' });
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe('failed');
  });

  it('lists runs with limit', () => {
    for (let i = 0; i < 5; i++) {
      store.createRun(makeRun({ id: `r${i}` }));
    }
    const runs = store.listRuns({ limit: 3 });
    expect(runs.length).toBe(3);
  });

  it('auto-creates data directory', () => {
    // The constructor already creates the directory, this test verifies
    // no error is thrown when the directory doesn't exist
    const deepPath = join(import.meta.dirname, '__test-data__', 'deep', 'nested', 'test.db');
    const deepStore = new RunStore(deepPath);
    const run = makeRun({ id: 'deep-1' });
    deepStore.createRun(run);
    expect(deepStore.getRun('deep-1')).not.toBeNull();
    deepStore.close();
  });

  it('stores and retrieves result and error fields', () => {
    const run = makeRun({ id: 'r-fields', result: 'hello output', exitCode: 0 });
    store.createRun(run);
    const retrieved = store.getRun('r-fields');
    expect(retrieved!.result).toBe('hello output');
    expect(retrieved!.exitCode).toBe(0);
  });
});
