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

describe('RunStore.queryRuns', () => {
  beforeEach(() => {
    // Seed a fixture set that covers the filter dimensions the dashboard
    // ships. Mixing agents, statuses, and triggered-by values.
    const t = Date.now();
    const secondsAgo = (n: number) => new Date(t - n * 1000).toISOString();
    const seed: Array<Partial<Run>> = [
      { id: 'abc-111', agentName: 'hello',   status: 'completed', triggeredBy: 'cli',      startedAt: secondsAgo(10) },
      { id: 'abc-222', agentName: 'hello',   status: 'failed',    triggeredBy: 'schedule', startedAt: secondsAgo(20) },
      { id: 'def-333', agentName: 'greet',   status: 'completed', triggeredBy: 'cli',      startedAt: secondsAgo(30) },
      { id: 'def-444', agentName: 'greet',   status: 'failed',    triggeredBy: 'mcp',      startedAt: secondsAgo(40) },
      { id: 'ghi-555', agentName: 'weather', status: 'running',   triggeredBy: 'schedule', startedAt: secondsAgo(50) },
      { id: 'ghi-666', agentName: 'weather', status: 'cancelled', triggeredBy: 'cli',      startedAt: secondsAgo(60) },
    ];
    for (const s of seed) store.createRun(makeRun(s));
  });

  it('returns all rows when no filters, newest first', () => {
    const { rows, total } = store.queryRuns();
    expect(total).toBe(6);
    expect(rows).toHaveLength(6);
    expect(rows[0].id).toBe('abc-111');
    expect(rows[5].id).toBe('ghi-666');
  });

  it('filters by agentName', () => {
    const { rows, total } = store.queryRuns({ agentName: 'greet' });
    expect(total).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(['def-333', 'def-444']);
  });

  it('filters by single status', () => {
    const { rows, total } = store.queryRuns({ statuses: ['failed'] });
    expect(total).toBe(2);
    expect(rows.every((r) => r.status === 'failed')).toBe(true);
  });

  it('ORs multiple statuses', () => {
    const { rows, total } = store.queryRuns({ statuses: ['completed', 'failed'] });
    expect(total).toBe(4);
    expect(rows.every((r) => r.status === 'completed' || r.status === 'failed')).toBe(true);
  });

  it('filters by triggeredBy', () => {
    const { rows, total } = store.queryRuns({ triggeredBy: 'schedule' });
    expect(total).toBe(2);
    expect(rows.every((r) => r.triggeredBy === 'schedule')).toBe(true);
  });

  it('composes filters with AND', () => {
    const { rows, total } = store.queryRuns({
      agentName: 'hello',
      statuses: ['failed'],
      triggeredBy: 'schedule',
    });
    expect(total).toBe(1);
    expect(rows[0].id).toBe('abc-222');
  });

  it('q matches run-id prefix', () => {
    const { rows, total } = store.queryRuns({ q: 'abc' });
    expect(total).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(['abc-111', 'abc-222']);
  });

  it('q matches agentName substring case-insensitively', () => {
    const { rows, total } = store.queryRuns({ q: 'EATHE' });
    expect(total).toBe(2);
    expect(rows.every((r) => r.agentName === 'weather')).toBe(true);
  });

  it('q escapes SQL LIKE metacharacters', () => {
    // Seed a row whose id includes a literal %. Searching for "%" should
    // not match every row — it should only match this one.
    store.createRun(makeRun({ id: '50%-win', agentName: 'edge' }));
    const { rows, total } = store.queryRuns({ q: '50%' });
    expect(total).toBe(1);
    expect(rows[0].id).toBe('50%-win');
  });

  it('clamps limit to MAX_RUNS_LIMIT', () => {
    const { rows } = store.queryRuns({ limit: 10_000 });
    expect(rows.length).toBeLessThanOrEqual(500);
  });

  it('honors offset for pagination', () => {
    const page1 = store.queryRuns({ limit: 2, offset: 0 });
    const page2 = store.queryRuns({ limit: 2, offset: 2 });
    expect(page1.rows[0].id).toBe('abc-111');
    expect(page2.rows[0].id).toBe('def-333');
    expect(page1.total).toBe(page2.total); // total is filter-relative, not page-relative
  });

  it('returns empty rows but correct total when offset exceeds size', () => {
    const { rows, total } = store.queryRuns({ offset: 1000 });
    expect(rows).toHaveLength(0);
    expect(total).toBe(6);
  });

  it('limit=0 returns zero rows but correct total', () => {
    const { rows, total } = store.queryRuns({ limit: 0 });
    expect(rows).toHaveLength(0);
    expect(total).toBe(6);
  });
});

describe('RunStore node_executions', () => {
  function baseRun(id = 'r-x'): Parameters<RunStore['createRun']>[0] {
    return {
      id,
      agentName: 'news-digest',
      status: 'running',
      startedAt: new Date().toISOString(),
      triggeredBy: 'cli',
      workflowId: 'news-digest',
      workflowVersion: 1,
    };
  }

  beforeEach(() => {
    store.createRun(baseRun());
  });

  it('round-trips a single node execution', () => {
    store.createNodeExecution({
      runId: 'r-x', nodeId: 'fetch', workflowVersion: 1,
      status: 'running', startedAt: new Date().toISOString(),
    });
    const got = store.getNodeExecution('r-x', 'fetch');
    expect(got).not.toBeNull();
    expect(got!.nodeId).toBe('fetch');
    expect(got!.status).toBe('running');
    expect(got!.errorCategory).toBeUndefined();
  });

  it('persists errorCategory on failed rows', () => {
    store.createNodeExecution({
      runId: 'r-x', nodeId: 'fetch', workflowVersion: 1,
      status: 'failed', startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: 'Timed out after 30s', errorCategory: 'timeout', exitCode: 124,
    });
    const got = store.getNodeExecution('r-x', 'fetch')!;
    expect(got.errorCategory).toBe('timeout');
    expect(got.error).toBe('Timed out after 30s');
  });

  it('updateNodeExecution applies a partial patch', () => {
    store.createNodeExecution({
      runId: 'r-x', nodeId: 'fetch', workflowVersion: 1,
      status: 'running', startedAt: new Date().toISOString(),
    });
    store.updateNodeExecution('r-x', 'fetch', {
      status: 'completed',
      completedAt: new Date().toISOString(),
      result: 'some stdout',
      exitCode: 0,
    });
    const got = store.getNodeExecution('r-x', 'fetch')!;
    expect(got.status).toBe('completed');
    expect(got.result).toBe('some stdout');
    expect(got.exitCode).toBe(0);
  });

  it('listNodeExecutions returns all rows for a run in startedAt order', () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      store.createNodeExecution({
        runId: 'r-x', nodeId: `node-${i}`, workflowVersion: 1,
        status: 'completed',
        startedAt: new Date(t0 + i * 1000).toISOString(),
      });
    }
    const list = store.listNodeExecutions('r-x');
    expect(list.map((r) => r.nodeId)).toEqual(['node-0', 'node-1', 'node-2']);
  });

  it('queryNodeExecutionsByCategory finds rows of that category only', () => {
    store.createRun(baseRun('r-y'));
    store.createNodeExecution({
      runId: 'r-x', nodeId: 'a', workflowVersion: 1,
      status: 'failed', errorCategory: 'timeout',
      startedAt: new Date().toISOString(),
    });
    store.createNodeExecution({
      runId: 'r-x', nodeId: 'b', workflowVersion: 1,
      status: 'failed', errorCategory: 'exit_nonzero',
      startedAt: new Date().toISOString(),
    });
    store.createNodeExecution({
      runId: 'r-y', nodeId: 'c', workflowVersion: 1,
      status: 'failed', errorCategory: 'timeout',
      startedAt: new Date().toISOString(),
    });
    const timeouts = store.queryNodeExecutionsByCategory('timeout');
    expect(timeouts.map((r) => r.nodeId).sort()).toEqual(['a', 'c']);
  });

  it('cascades deletion via FK when a run is removed', () => {
    store.createNodeExecution({
      runId: 'r-x', nodeId: 'a', workflowVersion: 1,
      status: 'completed', startedAt: new Date().toISOString(),
    });
    // Manually delete from runs to exercise the cascade.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).db.prepare('DELETE FROM runs WHERE id = ?').run('r-x');
    expect(store.getNodeExecution('r-x', 'a')).toBeNull();
  });
});

describe('RunStore migration — workflow_id / workflow_version columns', () => {
  it('adds the columns to a legacy DB and keeps old rows queryable', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { mkdirSync } = await import('node:fs');
    const legacyDir = join(import.meta.dirname, '__legacy__');
    rmSync(legacyDir, { recursive: true, force: true });
    mkdirSync(legacyDir, { recursive: true });
    const legacyPath = join(legacyDir, 'legacy.db');

    // Step 1: build a legacy schema by hand.
    const raw = new DatabaseSync(legacyPath);
    raw.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY, agentName TEXT NOT NULL, status TEXT NOT NULL,
        startedAt TEXT NOT NULL, completedAt TEXT, result TEXT,
        exitCode INTEGER, error TEXT, triggeredBy TEXT NOT NULL
      )
    `);
    raw.prepare(`INSERT INTO runs (id, agentName, status, startedAt, triggeredBy) VALUES (?, ?, ?, ?, ?)`)
      .run('old-row', 'legacy', 'completed', new Date().toISOString(), 'cli');
    raw.close();

    // Step 2: open with v2 RunStore — migration runs automatically.
    const legacyStore = new RunStore(legacyPath);
    const got = legacyStore.getRun('old-row');
    expect(got).not.toBeNull();
    expect(got!.workflowId).toBeUndefined();
    expect(got!.workflowVersion).toBeUndefined();

    // Step 3: new rows can use the new columns.
    legacyStore.createRun({
      id: 'new-row', agentName: 'news', status: 'completed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
      workflowId: 'news', workflowVersion: 3,
    });
    expect(legacyStore.getRun('new-row')!.workflowId).toBe('news');
    expect(legacyStore.getRun('new-row')!.workflowVersion).toBe(3);

    legacyStore.close();
    rmSync(legacyDir, { recursive: true, force: true });
  });
});

describe('RunStore.distinctValues', () => {
  beforeEach(() => {
    store.createRun(makeRun({ id: 'a', agentName: 'hello',   status: 'completed', triggeredBy: 'cli' }));
    store.createRun(makeRun({ id: 'b', agentName: 'greet',   status: 'failed',    triggeredBy: 'schedule' }));
    store.createRun(makeRun({ id: 'c', agentName: 'hello',   status: 'failed',    triggeredBy: 'cli' }));
  });

  it('returns distinct agent names', () => {
    expect(store.distinctValues('agentName')).toEqual(['greet', 'hello']);
  });

  it('returns distinct statuses', () => {
    expect(store.distinctValues('status')).toEqual(['completed', 'failed']);
  });

  it('returns distinct triggeredBy values', () => {
    expect(store.distinctValues('triggeredBy')).toEqual(['cli', 'schedule']);
  });
});
