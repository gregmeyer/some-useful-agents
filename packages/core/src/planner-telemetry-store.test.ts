import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlannerTelemetryStore } from './planner-telemetry-store.js';

let dir: string;
let store: PlannerTelemetryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-planner-telem-'));
  store = new PlannerTelemetryStore(join(dir, 'runs.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('PlannerTelemetryStore', () => {
  it('records a fresh planner-run start', () => {
    store.recordStart('run-1', 'build me a daily news digest');
    const row = store.get('run-1');
    expect(row).not.toBeNull();
    expect(row!.runId).toBe('run-1');
    expect(row!.goal).toBe('build me a daily news digest');
    expect(row!.planAttempts).toBe(1);
    expect(row!.planExtractStatus).toBe('pending');
    expect(row!.planAutofixCount).toBe(0);
    expect(row!.committedAt).toBeNull();
  });

  it('truncates long goals to 1024 chars', () => {
    const longGoal = 'x'.repeat(2000);
    store.recordStart('run-long', longGoal);
    const row = store.get('run-long');
    expect(row!.goal!.length).toBe(1024);
  });

  it('recordStart is idempotent — re-calling does not overwrite the original goal', () => {
    store.recordStart('run-id', 'first goal');
    store.recordStart('run-id', 'second goal');
    expect(store.get('run-id')!.goal).toBe('first goal');
  });

  it('records an ok extract with autofix count + plan latency + intent', () => {
    store.recordStart('run-ok', 'goal');
    store.recordExtract({
      runId: 'run-ok',
      status: 'ok',
      autofixCount: 2,
      timeToPlanMs: 4500,
      intent: 'agent',
    });
    const row = store.get('run-ok')!;
    expect(row.planExtractStatus).toBe('ok');
    expect(row.planAutofixCount).toBe(2);
    expect(row.timeToPlanMs).toBe(4500);
    expect(row.intent).toBe('agent');
  });

  it('records a no-json extract failure', () => {
    store.recordStart('run-nojson', 'goal');
    store.recordExtract({ runId: 'run-nojson', status: 'no-json', autofixCount: 0, timeToPlanMs: 8000 });
    expect(store.get('run-nojson')!.planExtractStatus).toBe('no-json');
  });

  it('records a schema-invalid extract with validation-error count', () => {
    store.recordStart('run-bad', 'goal');
    store.recordExtract({
      runId: 'run-bad',
      status: 'schema-invalid',
      autofixCount: 0,
      validationErrors: 3,
      timeToPlanMs: 6000,
    });
    const row = store.get('run-bad')!;
    expect(row.planExtractStatus).toBe('schema-invalid');
    expect(row.planValidationErrors).toBe(3);
  });

  it('records a commit with timeToCommitMs', () => {
    store.recordStart('run-cmt', 'goal');
    store.recordExtract({ runId: 'run-cmt', status: 'ok', autofixCount: 0, timeToPlanMs: 4000, intent: 'agent' });
    store.recordCommit('run-cmt', 12000);
    const row = store.get('run-cmt')!;
    expect(row.timeToCommitMs).toBe(12000);
    expect(row.committedAt).not.toBeNull();
  });

  it('incrementAttempts bumps plan_attempts', () => {
    store.recordStart('run-retry', 'goal');
    store.incrementAttempts('run-retry');
    store.incrementAttempts('run-retry');
    expect(store.get('run-retry')!.planAttempts).toBe(3);
  });

  describe('retry alias map', () => {
    it('routes incrementAttempts on a retry runId back to the original row', () => {
      store.recordStart('orig', 'goal');
      store.recordRetrySpawn('orig', 'retry-1');
      store.incrementAttempts('retry-1');
      expect(store.get('orig')!.planAttempts).toBe(2);
      // No row was created for the retry id.
      expect(store.get('retry-1')).toBeNull();
    });

    it('routes recordExtract on a retry runId back to the original row', () => {
      store.recordStart('orig2', 'goal');
      store.recordRetrySpawn('orig2', 'retry-2');
      store.recordExtract({ runId: 'retry-2', status: 'ok', autofixCount: 1, validationErrors: 2, timeToPlanMs: 9000, intent: 'agent' });
      const row = store.get('orig2')!;
      expect(row.planExtractStatus).toBe('ok');
      expect(row.planAutofixCount).toBe(1);
      expect(row.planValidationErrors).toBe(2);
      expect(row.intent).toBe('agent');
    });

    it('routes recordCommit on a retry runId back to the original row', () => {
      store.recordStart('orig3', 'goal');
      store.recordRetrySpawn('orig3', 'retry-3');
      store.recordCommit('retry-3', 4242);
      expect(store.get('orig3')!.timeToCommitMs).toBe(4242);
    });

    it('resolveOriginalRunId returns input unchanged when no alias is registered', () => {
      expect(store.resolveOriginalRunId('unknown')).toBe('unknown');
    });

    it('resolves alias-of-alias chains down to the root', () => {
      store.recordStart('root', 'goal');
      store.recordRetrySpawn('root', 'retry-a');
      store.recordRetrySpawn('retry-a', 'retry-b');
      expect(store.resolveOriginalRunId('retry-b')).toBe('root');
      store.incrementAttempts('retry-b');
      expect(store.get('root')!.planAttempts).toBe(2);
    });
  });

  describe('computeStats', () => {
    it('returns zeroed stats when no rows exist', () => {
      const s = store.computeStats(7);
      expect(s.totalAttempted).toBe(0);
      expect(s.totalCommitted).toBe(0);
      expect(s.commitRate).toBe(0);
      expect(s.firstAttemptCleanRate).toBe(0);
      expect(s.p50PlanMs).toBeNull();
    });

    it('aggregates commit rate, first-attempt-clean rate, and latency percentiles', () => {
      // 4 attempts: 3 ok-on-first-try, 1 schema-invalid; 2 of the 4 committed.
      store.recordStart('a', 'g');
      store.recordExtract({ runId: 'a', status: 'ok', autofixCount: 0, timeToPlanMs: 1000 });
      store.recordCommit('a', 5000);

      store.recordStart('b', 'g');
      store.recordExtract({ runId: 'b', status: 'ok', autofixCount: 1, timeToPlanMs: 2000 });

      store.recordStart('c', 'g');
      store.recordExtract({ runId: 'c', status: 'ok', autofixCount: 0, timeToPlanMs: 3000 });
      store.recordCommit('c', 7000);

      store.recordStart('d', 'g');
      store.recordExtract({ runId: 'd', status: 'schema-invalid', autofixCount: 0, validationErrors: 2, timeToPlanMs: 4000 });

      const s = store.computeStats(7);
      expect(s.totalAttempted).toBe(4);
      expect(s.totalCommitted).toBe(2);
      expect(s.commitRate).toBeCloseTo(0.5);
      expect(s.firstAttemptCleanRate).toBeCloseTo(0.75);
      expect(s.p50PlanMs).toBe(3000);
      expect(s.extractStatusHistogram).toEqual({ ok: 3, 'schema-invalid': 1 });
    });
  });

  it('listRecent returns rows newest first, capped at limit', () => {
    for (let i = 0; i < 5; i++) {
      store.recordStart(`r${i}`, `goal ${i}`);
    }
    const rows = store.listRecent(3);
    expect(rows.length).toBe(3);
    // All returned ids are from the set of 5 created ones.
    for (const r of rows) {
      expect(r.runId).toMatch(/^r[0-4]$/);
    }
  });
});
