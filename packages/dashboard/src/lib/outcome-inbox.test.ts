import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type OutcomeRecord, type OutcomeVerdict, type Run } from '@some-useful-agents/core';
import {
  buildCoalescedOutcomeNote,
  buildOutcomeMessage,
  raiseOutcomeInbox,
  shouldRaiseOutcome,
} from './outcome-inbox.js';

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-abc12345-xyz',
  agentName: 'news-digest',
  status: 'completed',
  startedAt: '2026-01-01T00:00:00Z',
  triggeredBy: 'schedule',
  ...overrides,
});

function record(overrides: {
  satisfied?: OutcomeVerdict;
  agentId?: string;
  runId?: string;
  failedReason?: string;
} = {}): OutcomeRecord {
  const agentId = overrides.agentId ?? 'news-digest';
  const runId = overrides.runId ?? 'run-abc12345-xyz';
  const satisfied = overrides.satisfied ?? 'partial';
  return {
    version: 1,
    runId,
    agentId,
    agentVersion: 2,
    detectedAt: '2026-01-01T00:01:00Z',
    intent: {
      expected: 'A digest listing headlines with a non-zero count line.',
      assumptions: [],
      success: [{ kind: 'regexMatch', nodeId: 'summarise', pattern: '[1-9][0-9]* headlines' }],
      unobservable: [],
    },
    execution: {
      actor: { agentId, agentVersion: 2, triggeredBy: 'schedule' },
      runStatus: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      nodes: [{ nodeId: 'summarise', status: 'completed', exitCode: 0 }],
    },
    observation: {
      evidence: [
        {
          id: 'ev1',
          kind: 'node-result',
          source: { runId, nodeId: 'summarise', selector: 'nodeResult' },
          value: '=== Daily Digest ===\n0 headlines loaded.',
          truncated: false,
          capturedAt: '2026-01-01T00:01:00Z',
        },
        {
          id: 'ev2',
          kind: 'absent',
          source: { runId, nodeId: 'fetch', field: 'bytes', selector: 'nodeOutputField' },
          value: 'node "fetch" produced no structured output',
          truncated: false,
          capturedAt: '2026-01-01T00:01:00Z',
        },
      ],
    },
    evaluation: {
      satisfied,
      basis: 'criteria',
      confidence: 'high',
      criteriaResults: [
        { description: 'shellExitZero(summarise)', passed: true },
        {
          description: 'regexMatch(summarise, /[1-9][0-9]* headlines/)',
          passed: false,
          reason: overrides.failedReason ?? 'regex did not match',
        },
      ],
    },
    unknowns: [
      { field: 'observation.evidence.ev2', reason: 'evidence-missing', detail: 'node "fetch" produced no structured output' },
      { field: 'observation.observedOutcome', reason: 'not-inferred', detail: 'No judge was supplied.' },
    ],
  };
}

let dir: string;
let store: InboxStore;
let prevFlag: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-outcome-inbox-'));
  store = new InboxStore(join(dir, 'runs.db'));
  prevFlag = process.env.SUA_INBOX_OUTCOME_MISSES;
  delete process.env.SUA_INBOX_OUTCOME_MISSES;
});

afterEach(() => {
  if (prevFlag === undefined) delete process.env.SUA_INBOX_OUTCOME_MISSES;
  else process.env.SUA_INBOX_OUTCOME_MISSES = prevFlag;
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * The gate is the highest-risk decision in the producer: too permissive and
 * the inbox becomes noise, too strict and the capability is invisible.
 */
describe('shouldRaiseOutcome — the gate', () => {
  it('raises for a completed run that missed its outcome', () => {
    expect(shouldRaiseOutcome(record({ satisfied: 'no' }), run())).toBe(true);
    expect(shouldRaiseOutcome(record({ satisfied: 'partial' }), run())).toBe(true);
  });

  it('does not raise when the outcome was achieved', () => {
    expect(shouldRaiseOutcome(record({ satisfied: 'yes' }), run())).toBe(false);
  });

  // "We couldn't tell" is not evidence of a problem. Raising on it is how an
  // inbox teaches people to ignore it.
  it('does not raise on undetermined', () => {
    expect(shouldRaiseOutcome(record({ satisfied: 'undetermined' }), run())).toBe(false);
  });

  // run-failure already owns these; a second thread would be duplicate noise.
  it('does not raise for a failed run', () => {
    expect(shouldRaiseOutcome(record({ satisfied: 'no' }), run({ status: 'failed' }))).toBe(false);
  });

  it('does not raise for a cancelled run', () => {
    expect(shouldRaiseOutcome(record({ satisfied: 'no' }), run({ status: 'cancelled' }))).toBe(false);
  });
});

describe('buildOutcomeMessage', () => {
  const msg = buildOutcomeMessage(record(), 'http://127.0.0.1:3000');

  it('is medium priority with the outcome source and documented dedupeKey', () => {
    expect(msg.priority).toBe('medium');
    expect(msg.source).toBe('outcome');
    expect(msg.dedupeKey).toBe('outcome:run-abc12345-xyz');
    expect(msg.agentId).toBe('news-digest');
    expect(msg.runId).toBe('run-abc12345-xyz');
  });

  it('leads with the distinction that makes this thread worth opening', () => {
    expect(msg.title).toBe('Outcome missed: news-digest');
    expect(msg.body).toContain('ran successfully but only partly achieved its declared outcome');
  });

  it('states the expectation, the failed check, and the observed value', () => {
    expect(msg.body).toContain('A digest listing headlines with a non-zero count line.');
    expect(msg.body).toContain('regexMatch(summarise');
    expect(msg.body).toContain('regex did not match');
    expect(msg.body).toContain('0 headlines loaded');
  });

  it('marks absent evidence as not found rather than omitting it', () => {
    expect(msg.body).toContain('**not found**');
    expect(msg.body).toContain('node `fetch`.bytes');
  });

  it('reports actionable unknowns but not the no-judge default', () => {
    expect(msg.body).toContain('Could not be determined');
    expect(msg.body).toContain('evidence-missing');
    expect(msg.body).not.toContain('not-inferred');
  });

  it('makes clear the execution itself was fine', () => {
    expect(msg.body).toContain('completed cleanly; the outcome, not the execution, is what failed');
    expect(msg.body).toContain('sua outcome show run-abc1');
  });

  it('omits inferred prose when no judge ran', () => {
    expect(msg.body).not.toContain('What appears to have happened');
  });

  it('includes inferred prose, labelled as inferred, when a judge ran', () => {
    const withJudge = record();
    withJudge.observation.observedOutcome = { text: 'The digest was empty.', citedEvidenceIds: ['ev1'] };
    const body = buildOutcomeMessage(withJudge).body;
    expect(body).toContain('inferred from the evidence below');
    expect(body).toContain('The digest was empty.');
  });
});

describe('raiseOutcomeInbox', () => {
  it('opens a thread for a completed run that missed its outcome', () => {
    const raised = raiseOutcomeInbox(store, record(), run());
    expect(raised?.coalesced).toBe(false);
    expect(raised?.message.source).toBe('outcome');
    expect(store.list({}).length).toBe(1);
  });

  it('returns undefined for achieved, undetermined, and failed runs', () => {
    expect(raiseOutcomeInbox(store, record({ satisfied: 'yes' }), run())).toBeUndefined();
    expect(raiseOutcomeInbox(store, record({ satisfied: 'undetermined' }), run())).toBeUndefined();
    expect(raiseOutcomeInbox(store, record({ satisfied: 'no' }), run({ status: 'failed' }))).toBeUndefined();
    expect(store.list({}).length).toBe(0);
  });

  // A nightly agent that misses every night must yield ONE thread with a
  // visible frequency, not 30 threads and 30 auto-triage turns.
  it('coalesces a repeat miss onto the agent existing thread', () => {
    const first = raiseOutcomeInbox(store, record({ runId: 'run-1' }), run({ id: 'run-1' }));
    const second = raiseOutcomeInbox(store, record({ runId: 'run-2' }), run({ id: 'run-2' }));

    expect(second?.coalesced).toBe(true);
    expect(second?.message.id).toBe(first?.message.id);
    expect(second?.response?.body).toContain('Another run of **news-digest**');
    expect(second?.response?.body).toContain('run-2');
    expect(store.list({}).length).toBe(1);
  });

  it('is idempotent for the same run (hook double-fire / resume)', () => {
    raiseOutcomeInbox(store, record(), run());
    const again = raiseOutcomeInbox(store, record(), run());
    expect(again?.coalesced).toBe(true);
    expect(store.listResponses(again!.message.id).length).toBe(0);
    expect(store.list({}).length).toBe(1);
  });

  it('opens a fresh thread once the previous one is resolved', () => {
    const first = raiseOutcomeInbox(store, record({ runId: 'run-1' }), run({ id: 'run-1' }));
    store.updateStatus(first!.message.id, 'resolved');
    const second = raiseOutcomeInbox(store, record({ runId: 'run-2' }), run({ id: 'run-2' }));
    expect(second?.coalesced).toBe(false);
    expect(second?.message.id).not.toBe(first?.message.id);
  });

  it('skips synthetic underscore-prefixed helper agents', () => {
    const r = record({ agentId: '_yaml-fixer' });
    expect(raiseOutcomeInbox(store, r, run({ agentName: '_yaml-fixer' }))).toBeUndefined();
  });

  it('honours the SUA_INBOX_OUTCOME_MISSES=0 escape hatch', () => {
    process.env.SUA_INBOX_OUTCOME_MISSES = '0';
    expect(raiseOutcomeInbox(store, record(), run())).toBeUndefined();
    expect(store.list({}).length).toBe(0);
  });

  it('returns undefined rather than throwing when there is no store', () => {
    expect(raiseOutcomeInbox(undefined, record(), run())).toBeUndefined();
  });
});

describe('buildCoalescedOutcomeNote', () => {
  it('names the run and the check that failed', () => {
    const note = buildCoalescedOutcomeNote(record({ runId: 'run-9' }), 'http://127.0.0.1:3000');
    expect(note).toContain('Another run of **news-digest** only partly achieved its outcome');
    expect(note).toContain('http://127.0.0.1:3000/runs/run-9');
    expect(note).toContain('regex did not match');
  });
});

/**
 * The composition `index.ts` hand-wires: detection hook → onRecord →
 * raiseOutcomeInbox. Exercised against a REAL executor run so the glue between
 * the three pieces is covered, not just each piece in isolation.
 */
describe('detection hook → inbox (the wiring index.ts does)', () => {
  it('raises a thread for a run that completed but missed its outcome', async () => {
    const { executeAgentDag, OutcomeStore, outcomeDetectionHook, RunStore } =
      await import('@some-useful-agents/core');

    const runStore = new RunStore(join(dir, 'runs2.db'));
    const outcomeStore = new OutcomeStore(join(dir, 'outcomes.db'));
    const raised: string[] = [];
    try {
      const agent = {
        id: 'digest', name: 'Digest', status: 'active', source: 'examples', version: 1,
        nodes: [{ id: 'summarise', type: 'shell', command: 'echo hi' }],
        outcome: {
          expected: 'A non-empty digest.',
          evidence: [{ kind: 'nodeResult', nodeId: 'summarise' }],
          success: [{ kind: 'regexMatch', nodeId: 'summarise', pattern: 'never-matches' }],
        },
      } as never;

      const completed = await executeAgentDag(agent, { triggeredBy: 'schedule' }, {
        runStore,
        spawnNode: async () => ({ result: 'hi', exitCode: 0 }),
        onRunComplete: outcomeDetectionHook({
          outcomeStore,
          onRecord: (record) => {
            const run = runStore.getRun(record.runId);
            if (!run) return;
            const r = raiseOutcomeInbox(store, record, run);
            if (r) raised.push(r.message.id);
          },
        }),
      });

      // The run itself is perfectly healthy — that's the whole point.
      expect(completed.status).toBe('completed');
      expect(raised).toHaveLength(1);

      const thread = store.get(raised[0])!;
      expect(thread.source).toBe('outcome');
      expect(thread.priority).toBe('medium');
      expect(thread.title).toBe('Outcome missed: digest');
      expect(thread.body).toContain('never-matches');
    } finally {
      runStore.close();
      outcomeStore.close();
    }
  });

  it('raises nothing for a run that achieved its outcome', async () => {
    const { executeAgentDag, OutcomeStore, outcomeDetectionHook, RunStore } =
      await import('@some-useful-agents/core');

    const runStore = new RunStore(join(dir, 'runs3.db'));
    const outcomeStore = new OutcomeStore(join(dir, 'outcomes3.db'));
    const raised: string[] = [];
    try {
      const agent = {
        id: 'digest-ok', name: 'Digest', status: 'active', source: 'examples', version: 1,
        nodes: [{ id: 'summarise', type: 'shell', command: 'echo hi' }],
        outcome: {
          expected: 'A non-empty digest.',
          evidence: [{ kind: 'nodeResult', nodeId: 'summarise' }],
          success: [{ kind: 'regexMatch', nodeId: 'summarise', pattern: 'hi' }],
        },
      } as never;

      await executeAgentDag(agent, { triggeredBy: 'schedule' }, {
        runStore,
        spawnNode: async () => ({ result: 'hi', exitCode: 0 }),
        onRunComplete: outcomeDetectionHook({
          outcomeStore,
          onRecord: (record) => {
            const run = runStore.getRun(record.runId);
            if (!run) return;
            const r = raiseOutcomeInbox(store, record, run);
            if (r) raised.push(r.message.id);
          },
        }),
      });

      expect(raised).toHaveLength(0);
      expect(store.list({}).length).toBe(0);
    } finally {
      runStore.close();
      outcomeStore.close();
    }
  });
});
