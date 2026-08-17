/**
 * `sua outcome` command wiring. The rendering logic is private to the
 * command file, so this exercises the surface a user actually touches:
 * the command tree, its options, and the store queries behind them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutcomeStore, type OutcomeRecord, type OutcomeVerdict } from '@some-useful-agents/core';
import { outcomeCommand } from './outcome.js';

function record(runId: string, satisfied: OutcomeVerdict, agentId = 'digest'): OutcomeRecord {
  return {
    version: 1,
    runId,
    agentId,
    agentVersion: 1,
    detectedAt: `2026-08-15T12:00:0${runId.slice(-1)}.000Z`,
    intent: { expected: 'a digest', assumptions: [], unobservable: [] },
    execution: {
      actor: { agentId, agentVersion: 1, triggeredBy: 'cli' },
      runStatus: 'completed',
      startedAt: '2026-08-15T11:59:00.000Z',
      nodes: [{ nodeId: 'work', status: 'completed', exitCode: 0 }],
    },
    observation: {
      evidence: [{
        id: 'ev1',
        kind: 'node-result',
        source: { runId, nodeId: 'work', selector: 'nodeResult' },
        value: '10 headlines loaded.',
        truncated: false,
        capturedAt: '2026-08-15T12:00:00.000Z',
      }],
    },
    evaluation: { satisfied, basis: 'criteria', confidence: 'high' },
    unknowns: [{ field: 'observation.observedOutcome', reason: 'not-inferred' }],
  };
}

describe('outcomeCommand', () => {
  it('exposes list and show subcommands', () => {
    const names = outcomeCommand.commands.map((c) => c.name()).sort();
    expect(names).toEqual(['list', 'show']);
  });

  it('offers the filters that make the list useful', () => {
    const list = outcomeCommand.commands.find((c) => c.name() === 'list')!;
    const flags = list.options.map((o) => o.long);
    expect(flags).toContain('--agent');
    expect(flags).toContain('--unsatisfied');
    expect(flags).toContain('--limit');
  });

  it('offers --json on show for piping into other tools', () => {
    const show = outcomeCommand.commands.find((c) => c.name() === 'show')!;
    expect(show.options.map((o) => o.long)).toContain('--json');
  });
});

describe('the queries the command runs', () => {
  let dir: string;
  let store: OutcomeStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-cli-outcome-'));
    store = new OutcomeStore(join(dir, 'runs.db'));
    store.record(record('run-aaaa1', 'yes'));
    store.record(record('run-bbbb2', 'no'));
    store.record(record('run-cccc3', 'undetermined', 'other'));
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists newest first', () => {
    expect(store.list().map((r) => r.runId)).toEqual(['run-cccc3', 'run-bbbb2', 'run-aaaa1']);
  });

  it('narrows to the records worth looking at', () => {
    const rows = store.list({ unsatisfiedOnly: true });
    expect(rows.map((r) => r.runId).sort()).toEqual(['run-bbbb2', 'run-cccc3']);
  });

  it('narrows by agent', () => {
    expect(store.list({ agentId: 'other' }).map((r) => r.runId)).toEqual(['run-cccc3']);
  });

  // `show` accepts a prefix because run ids are UUIDs and nobody types those.
  it('resolves a run-id prefix the way show does', () => {
    const match = store.list({ limit: 500 }).find((r) => r.runId.startsWith('run-bb'));
    expect(match?.runId).toBe('run-bbbb2');
  });
});
