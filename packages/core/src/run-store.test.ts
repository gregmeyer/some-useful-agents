import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, statSync } from 'node:fs';
import { platform } from 'node:os';
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

  it.skipIf(platform() === 'win32')('chmods the DB file to 0o600 on create', () => {
    const mode = statSync(TEST_DB).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('sweepExpired deletes rows older than retention window', () => {
    // Row 40 days ago (should be deleted with 30-day window)
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    store.createRun(makeRun({ id: 'old-run', startedAt: old }));
    // Row 5 days ago (should survive)
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    store.createRun(makeRun({ id: 'recent-run', startedAt: recent }));

    const deleted = store.sweepExpired(30);
    expect(deleted).toBe(1);
    expect(store.getRun('old-run')).toBeNull();
    expect(store.getRun('recent-run')).not.toBeNull();
  });

  it('sweepExpired is no-op when retentionDays is Infinity', () => {
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    store.createRun(makeRun({ id: 'ancient', startedAt: old }));
    const deleted = store.sweepExpired(Infinity);
    expect(deleted).toBe(0);
    expect(store.getRun('ancient')).not.toBeNull();
  });

  it('constructor sweeps expired rows with configured retention', () => {
    // Seed a 60-day-old row in the default store, close it, reopen with 30-day retention
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    store.createRun(makeRun({ id: 'aged', startedAt: old }));
    store.close();

    const reopened = new RunStore(TEST_DB, { retentionDays: 30 });
    expect(reopened.getRun('aged')).toBeNull();
    reopened.close();
    store = new RunStore(TEST_DB);  // for afterEach cleanup
  });
});
