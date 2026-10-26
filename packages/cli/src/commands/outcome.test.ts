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
import { outcomeCommand, findOutcome } from './outcome.js';

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

// The listing queries are tested with the store (core outcome-store.test.ts); show's lookup is the command's own.
describe('show finds a record by run id', () => {
  let dir: string;
  let store: OutcomeStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-cli-outcome-'));
    store = new OutcomeStore(join(dir, 'runs.db'));
    store.record(record('run-aaaa1', 'yes'));
    store.record(record('run-bbbb2', 'no'));
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('by its whole id, or the first characters of it', () => {
    expect(findOutcome(store, 'run-aaaa1')?.runId).toBe('run-aaaa1');
    expect(findOutcome(store, 'run-bb')?.runId).toBe('run-bbbb2');
    expect(findOutcome(store, 'nope')).toBeNull();
  });
});
