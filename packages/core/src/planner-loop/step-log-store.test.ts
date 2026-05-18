import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlannerLoopStepLogStore } from './step-log-store.js';

describe('PlannerLoopStepLogStore', () => {
  let dir: string;
  let store: PlannerLoopStepLogStore;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pls-test-'));
    dbPath = join(dir, 'planner-loop.db');
    store = new PlannerLoopStepLogStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const stepFixture = (overrides: Partial<Parameters<typeof store.appendSteps>[0]['steps'][number]> = {}) => ({
    phase: 'observe' as const,
    primitive: 'observePlan',
    runId: 'r1',
    ok: true,
    summary: 'extract ok',
    tookMs: 3,
    at: '2026-05-18T00:00:00Z',
    ...overrides,
  });

  it('round-trips a batch of steps', () => {
    store.appendSteps({
      runId: 'r1',
      attempt: 1,
      steps: [
        stepFixture(),
        stepFixture({ phase: 'evaluate', primitive: 'critiquePlan', ok: false, summary: 'critic flagged 2' }),
      ],
    });
    const rows = store.listForRun('r1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ phase: 'observe', primitive: 'observePlan', ok: true, attempt: 1 });
    expect(rows[1]).toMatchObject({ phase: 'evaluate', primitive: 'critiquePlan', ok: false });
  });

  it('orders rows by attempt then insert order across multiple appends', () => {
    store.appendSteps({ runId: 'r2', attempt: 1, steps: [stepFixture({ primitive: 'first' }), stepFixture({ primitive: 'second' })] });
    store.appendSteps({ runId: 'r2', attempt: 2, steps: [stepFixture({ primitive: 'third' })] });
    const rows = store.listForRun('r2');
    expect(rows.map((r) => r.primitive)).toEqual(['first', 'second', 'third']);
    expect(rows.map((r) => r.attempt)).toEqual([1, 1, 2]);
  });

  it('persists payload_json for steps that carry one', () => {
    const payloadByIdx = new Map<number, unknown>();
    payloadByIdx.set(0, { errors: ['a', 'b'] });
    store.appendSteps({
      runId: 'r3',
      attempt: 1,
      steps: [stepFixture({ primitive: 'critiquePlan' })],
      payloadByIdx,
    });
    const rows = store.listForRun('r3');
    expect(rows[0].payloadJson).toBe(JSON.stringify({ errors: ['a', 'b'] }));
  });

  it('caps oversized summary at 1024 chars', () => {
    store.appendSteps({
      runId: 'r4',
      attempt: 1,
      steps: [stepFixture({ summary: 'x'.repeat(2000) })],
    });
    const rows = store.listForRun('r4');
    expect(rows[0].summary.length).toBe(1024);
  });

  it('no-ops on empty step arrays', () => {
    store.appendSteps({ runId: 'r5', attempt: 1, steps: [] });
    expect(store.listForRun('r5')).toEqual([]);
  });
});
