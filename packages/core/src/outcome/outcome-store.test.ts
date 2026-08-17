import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutcomeStore } from './outcome-store.js';
import { OUTCOME_RECORD_VERSION, type OutcomeRecord, type OutcomeVerdict } from './types.js';

function record(runId: string, satisfied: OutcomeVerdict, agentId = 'digest'): OutcomeRecord {
  return {
    version: OUTCOME_RECORD_VERSION,
    runId,
    agentId,
    agentVersion: 1,
    detectedAt: `2026-08-15T12:00:0${runId.slice(-1)}.000Z`,
    intent: { expected: 'a digest', assumptions: [], unobservable: [] },
    execution: {
      actor: { agentId, agentVersion: 1, triggeredBy: 'cli' },
      runStatus: 'completed',
      startedAt: '2026-08-15T11:59:00.000Z',
      nodes: [],
    },
    observation: { evidence: [] },
    evaluation: { satisfied, basis: 'criteria', confidence: 'high' },
    unknowns: [],
  };
}

describe('OutcomeStore', () => {
  let dir: string;
  let store: OutcomeStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-outcome-store-'));
    store = new OutcomeStore(join(dir, 'runs.db'));
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a record', () => {
    store.record(record('run-1', 'yes'));
    const got = store.get('run-1');
    expect(got?.satisfied).toBe('yes');
    expect(got?.record.intent.expected).toBe('a digest');
    expect(got?.evidenceCount).toBe(0);
  });

  it('returns null for an unknown run', () => {
    expect(store.get('nope')).toBeNull();
  });

  // `options.resume` (the durable Temporal path) and Temporal activity
  // retries both re-execute the tail of executeAgentDag against the SAME
  // run id. An INSERT would throw on the second pass and lose the record.
  it('upserts rather than throwing when the same run is detected twice', () => {
    store.record(record('run-1', 'undetermined'));
    const updated = { ...record('run-1', 'yes'), detectedAt: '2026-08-15T13:00:00.000Z' };
    expect(() => store.record(updated)).not.toThrow();

    expect(store.list()).toHaveLength(1);
    expect(store.get('run-1')?.satisfied).toBe('yes');
    expect(store.get('run-1')?.detectedAt).toBe('2026-08-15T13:00:00.000Z');
  });

  it('lists newest first and filters by agent', () => {
    store.record(record('run-1', 'yes', 'digest'));
    store.record(record('run-2', 'no', 'digest'));
    store.record(record('run-3', 'yes', 'other'));

    expect(store.list().map((r) => r.runId)).toEqual(['run-3', 'run-2', 'run-1']);
    expect(store.list({ agentId: 'digest' }).map((r) => r.runId)).toEqual(['run-2', 'run-1']);
  });

  it('filters to the interesting rows with unsatisfiedOnly', () => {
    store.record(record('run-1', 'yes'));
    store.record(record('run-2', 'no'));
    store.record(record('run-3', 'partial'));
    store.record(record('run-4', 'undetermined'));

    const rows = store.list({ unsatisfiedOnly: true });
    expect(rows.map((r) => r.satisfied).sort()).toEqual(['no', 'partial', 'undetermined']);
  });

  it('respects limit', () => {
    for (let i = 1; i <= 5; i++) store.record(record(`run-${i}`, 'yes'));
    expect(store.list({ limit: 2 })).toHaveLength(2);
  });

  it('shares a connection via fromHandle without owning it', () => {
    const attached = OutcomeStore.fromHandle((store as unknown as { db: never }).db);
    attached.record(record('run-9', 'yes'));
    attached.close(); // must be a no-op — it does not own the handle
    expect(store.get('run-9')?.satisfied).toBe('yes');
  });
});
