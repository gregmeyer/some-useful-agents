import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, NodeExecutionRecord } from '../agent-v2-types.js';
import type { Run } from '../types.js';
import { detectOutcome } from './detect.js';
import { OutcomeStore } from './outcome-store.js';
import type { JudgeFn, OutcomeExpectation } from './types.js';
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
    const evaluation = store.record(record('run-1', 'yes'));
    const got = store.get('run-1');
    expect(got?.satisfied).toBe('yes');
    expect(got?.record.intent.expected).toBe('a digest');
    expect(got?.evidenceCount).toBe(0);
    expect(evaluation.inputFingerprint).toBeTruthy();
    expect(evaluation.criteriaEngineVersion).toBe('evaluateCriteria/v1');
  });

  it('returns null for an unknown run', () => {
    expect(store.get('nope')).toBeNull();
  });

  // `options.resume` (the durable Temporal path) and Temporal activity
  // retries both re-execute the tail of executeAgentDag against the SAME
  // run id. An INSERT would throw on the second pass and lose the record.
  it('upserts rather than throwing when the same run is detected twice', () => {
    const first = store.record(record('run-1', 'undetermined'));
    const updated = { ...record('run-1', 'yes'), detectedAt: '2026-08-15T13:00:00.000Z' };
    const second = store.record(updated);

    expect(store.list()).toHaveLength(1);
    expect(store.get('run-1')?.satisfied).toBe('yes');
    expect(store.get('run-1')?.detectedAt).toBe('2026-08-15T13:00:00.000Z');
    expect(first.evaluationId).not.toBe(second.evaluationId);
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

  it('preserves earlier evaluations when later evidence changes the verdict', async () => {
    const reminderAgent = agent({
      expected: 'The reminder exists with the requested title.',
      evidence: [{ kind: 'nodeResult', nodeId: 'create-reminder' }],
    });
    const reminderRun = run();
    const reminderExecs = execs(JSON.stringify({ id: 'rem-1', title: 'Buy flowers' }));
    const initialJudge: JudgeFn = async ({ evidence }) => {
      const readback = evidence.find((item) => item.subject?.type === 'reminder');
      if (!readback) return null;
      return {
        observedOutcome: { text: 'The reminder exists with the requested title.', citedEvidenceIds: [readback.id] },
        expectedVsObserved: { text: 'The intended reminder now exists.', citedEvidenceIds: [readback.id] },
        satisfied: evidence.some((item) => item.value.includes('"Buy flowers"')) ? 'yes' : 'no',
      };
    };

    const pinnedEvaluator = { kind: 'judge', version: 'judge-v1', judge: 'reminder-proof' } as const;
    const firstRecord = await detectOutcome({
      agent: reminderAgent,
      run: reminderRun,
      nodeExecutions: reminderExecs,
      expectation: reminderAgent.outcome!,
      judge: initialJudge,
      now: () => new Date('2026-08-17T10:00:00.000Z'),
    });
    const first = store.record(firstRecord, { contractSnapshot: reminderAgent.outcome!, evaluator: pinnedEvaluator });
    expect(first.verdict).toBe('undetermined');
    expect(first.record.observation.evidence).toHaveLength(1);

    const second = await store.attachEvidenceAndReevaluate({
      agent: reminderAgent,
      run: reminderRun,
      nodeExecutions: reminderExecs,
      expectation: reminderAgent.outcome!,
      evidence: [{
        kind: 'node-result',
        label: 'read-back reminder',
        source: {
          runId: reminderRun.id,
          provenance: {
            source: 'tool:apple.apple.reminder-read',
            observingRunId: 'observe-run-1',
            observationMode: 'direct',
          },
        },
        subject: { type: 'reminder', id: 'rem-1' },
        value: JSON.stringify({ id: 'rem-1', title: 'Buy flowers' }),
        truncated: false,
        capturedAt: '2026-08-17T10:05:00.000Z',
      }],
      judge: initialJudge,
      now: () => new Date('2026-08-17T10:05:30.000Z'),
      evaluator: pinnedEvaluator,
    });

    expect(second.verdict).toBe('yes');
    expect(store.get(reminderRun.id)?.satisfied).toBe('yes');

    const evaluations = store.listEvaluations(reminderRun.id);
    expect(evaluations).toHaveLength(2);
    expect(evaluations[0].verdict).toBe('undetermined');
    expect(evaluations[0].evidenceIds).toEqual(['ev1']);
    expect(evaluations[1].verdict).toBe('yes');
    expect(evaluations[1].evidenceIds).toHaveLength(2);
    expect(evaluations[0].inputFingerprint).not.toBe(evaluations[1].inputFingerprint);
    expect(evaluations[1].record.observation.evidence[1].source.provenance?.observingRunId).toBe('observe-run-1');
    const history = store.getHistory(reminderRun.id);
    expect(history?.evaluations[0].changeReason).toEqual(['initial evaluation']);
    expect(history?.evaluations[1].changeReason).toEqual(['new evidence']);
    expect(history?.evaluations[1].addedEvidence[0].observingRunId).toBe('observe-run-1');
  });

  it('keeps hindsight out of earlier evaluations and captures later contradiction', async () => {
    const reminderAgent = agent({
      expected: 'The reminder still exists with title "Bring passport".',
      evidence: [{ kind: 'nodeResult', nodeId: 'create-reminder' }],
    });
    const reminderRun = run({ id: 'run-reminder-2' });
    const reminderExecs = execs(JSON.stringify({ id: 'rem-2', title: 'Bring passport' }), reminderRun.id);
    const judge: JudgeFn = async ({ evidence }) => {
      const latestObservation = [...evidence]
        .filter((item) => item.subject?.id === 'rem-2')
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
        .at(-1);
      if (!latestObservation) return null;
      const title = latestObservation.value.match(/"title":"([^"]+)"/)?.[1];
      const exists = !latestObservation.value.includes('"missing":true');
      const satisfies = exists && title === 'Bring passport';
      return {
        observedOutcome: {
          text: exists ? `Reminder title observed as ${title ?? 'unknown'}.` : 'Reminder no longer exists.',
          citedEvidenceIds: [latestObservation.id],
        },
        expectedVsObserved: {
          text: satisfies ? 'Matches the requested reminder state.' : 'Does not match the requested reminder state.',
          citedEvidenceIds: [latestObservation.id],
        },
        satisfied: satisfies ? 'yes' : 'no',
      };
    };

    const firstRecord = await detectOutcome({
      agent: reminderAgent,
      run: reminderRun,
      nodeExecutions: reminderExecs,
      expectation: reminderAgent.outcome!,
      judge,
      now: () => new Date('2026-08-17T10:55:00.000Z'),
    });
    store.record(firstRecord, { contractSnapshot: reminderAgent.outcome! });

    const satisfied = await store.attachEvidenceAndReevaluate({
      agent: reminderAgent,
      run: reminderRun,
      nodeExecutions: reminderExecs,
      expectation: reminderAgent.outcome!,
      evidence: [{
        kind: 'node-result',
        label: 'initial read-back reminder',
        source: {
          runId: reminderRun.id,
          provenance: {
            source: 'tool:apple.apple.reminder-read',
            observingRunId: 'observe-run-a',
            observationMode: 'direct',
          },
        },
        subject: { type: 'reminder', id: 'rem-2' },
        value: JSON.stringify({ id: 'rem-2', title: 'Bring passport' }),
        truncated: false,
        capturedAt: '2026-08-17T11:00:00.000Z',
      }],
      judge,
      now: () => new Date('2026-08-17T11:00:30.000Z'),
    });

    expect(satisfied.verdict).toBe('yes');

    const contradicted = await store.attachEvidenceAndReevaluate({
      agent: reminderAgent,
      run: reminderRun,
      nodeExecutions: reminderExecs,
      expectation: reminderAgent.outcome!,
      evidence: [{
        kind: 'node-result',
        label: 'later read-back reminder',
        source: {
          runId: reminderRun.id,
          provenance: {
            source: 'tool:apple.apple.reminder-read',
            observingRunId: 'observe-run-b',
            observationMode: 'direct',
          },
        },
        subject: { type: 'reminder', id: 'rem-2' },
        value: JSON.stringify({ id: 'rem-2', title: 'Bring passport [edited]' }),
        truncated: false,
        capturedAt: '2026-08-17T11:10:00.000Z',
      }],
      judge,
      now: () => new Date('2026-08-17T11:10:30.000Z'),
    });

    expect(contradicted.verdict).toBe('no');
    expect(store.get(reminderRun.id)?.satisfied).toBe('no');

    const evaluations = store.listEvaluations(reminderRun.id);
    expect(evaluations.map((entry) => entry.verdict)).toEqual(['undetermined', 'yes', 'no']);
    expect(evaluations[1].record.observation.evidence.some((item) => item.value.includes('[edited]'))).toBe(false);
    expect(evaluations[2].record.observation.evidence.some((item) => item.value.includes('[edited]'))).toBe(true);
  });

  it('stores evaluator-only reinterpretations as distinct immutable evaluation events', () => {
    const runId = 'run-evaluator-change';
    const contract = { expected: 'Result persisted', evidence: [{ kind: 'nodeResult', nodeId: 'step' }] } as OutcomeExpectation;
    const base = evaluationRecordBase(runId, 'persisted');

    const first = store.record({
      ...base,
      detectedAt: '2026-08-17T12:30:05.000Z',
      evaluation: { satisfied: 'yes', basis: 'judged', confidence: 'medium' },
    }, {
      contractSnapshot: contract,
      evaluator: { kind: 'judge', version: 'judge-A', judge: 'model-A' },
    });

    const second = store.record({
      ...base,
      detectedAt: '2026-08-17T12:31:05.000Z',
      evaluation: { satisfied: 'undetermined', basis: 'judged', confidence: 'low' },
      unknowns: [{ field: 'evaluation.satisfied', reason: 'not-inferred', detail: 'Model B declined to judge.' }],
    }, {
      contractSnapshot: contract,
      evaluator: { kind: 'judge', version: 'judge-B', judge: 'model-B' },
    });

    const evaluations = store.listEvaluations(runId);
    expect(evaluations).toHaveLength(2);
    expect(first.evaluationId).not.toBe(second.evaluationId);
    expect(first.inputFingerprint).not.toBe(second.inputFingerprint);
    expect(evaluations.map((entry) => entry.verdict)).toEqual(['yes', 'undetermined']);
    expect(store.get(runId)?.satisfied).toBe('undetermined');
    expect(evaluations[0].record.evaluation.satisfied).toBe('yes');
    expect(evaluations[1].evaluator.version).toBe('judge-B');
  });

  it('stores identical-input reruns as distinct events with the same input fingerprint', () => {
    const runId = 'run-identical-rerun';
    const contract = {
      expected: 'Result mentions VIP',
      evidence: [{ kind: 'nodeResult', nodeId: 'step' }],
      success: [{ kind: 'regexMatch', nodeId: 'step', pattern: 'VIP' }],
    } satisfies OutcomeExpectation;

    const first = store.record({
      ...evaluationRecordBase(runId, 'VIP contact synced'),
      detectedAt: '2026-08-17T12:40:05.000Z',
      evaluation: { satisfied: 'yes', basis: 'criteria', confidence: 'high', criteriaResults: [{ description: 'regexMatch(step, /VIP/)', passed: true }] },
    }, {
      contractSnapshot: contract,
      evaluator: { kind: 'deterministic', version: 'criteria-evaluator-v1' },
      criteriaEngineVersion: 'criteria-engine-v1',
    });

    const second = store.record({
      ...evaluationRecordBase(runId, 'VIP contact synced'),
      detectedAt: '2026-08-17T12:45:05.000Z',
      evaluation: { satisfied: 'yes', basis: 'criteria', confidence: 'high', criteriaResults: [{ description: 'regexMatch(step, /VIP/)', passed: true }] },
    }, {
      contractSnapshot: contract,
      evaluator: { kind: 'deterministic', version: 'criteria-evaluator-v1' },
      criteriaEngineVersion: 'criteria-engine-v1',
    });

    const evaluations = store.listEvaluations(runId);
    expect(evaluations).toHaveLength(2);
    expect(first.evaluationId).not.toBe(second.evaluationId);
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
    expect(evaluations[0].record.detectedAt).toBe('2026-08-17T12:40:05.000Z');
    expect(evaluations[1].record.detectedAt).toBe('2026-08-17T12:45:05.000Z');
    expect(store.get(runId)?.detectedAt).toBe('2026-08-17T12:45:05.000Z');
  });

  it('distinguishes contract changes from evaluator changes via stored fingerprints and hashes', () => {
    const runId = 'run-contract-vs-evaluator';
    const contractA = {
      expected: 'Result mentions VIP',
      evidence: [{ kind: 'nodeResult', nodeId: 'step' }],
      success: [{ kind: 'regexMatch', nodeId: 'step', pattern: 'VIP' }],
    } satisfies OutcomeExpectation;
    const contractB = {
      expected: 'Result mentions enterprise',
      evidence: [{ kind: 'nodeResult', nodeId: 'step' }],
      success: [{ kind: 'regexMatch', nodeId: 'step', pattern: 'enterprise' }],
    } satisfies OutcomeExpectation;

    const sameEvidence = evaluationRecordBase(runId, 'VIP contact synced');
    const contractEval = store.record({
      ...sameEvidence,
      detectedAt: '2026-08-17T12:50:05.000Z',
      evaluation: { satisfied: 'yes', basis: 'criteria', confidence: 'high', criteriaResults: [{ description: 'regexMatch(step, /VIP/)', passed: true }] },
    }, {
      contractSnapshot: contractA,
      evaluator: { kind: 'deterministic', version: 'criteria-evaluator-v1' },
      criteriaEngineVersion: 'criteria-engine-v1',
    });
    const contractChanged = store.record({
      ...sameEvidence,
      detectedAt: '2026-08-17T12:51:05.000Z',
      evaluation: { satisfied: 'no', basis: 'criteria', confidence: 'high', criteriaResults: [{ description: 'regexMatch(step, /enterprise/)', passed: false, reason: 'regex did not match' }] },
    }, {
      contractSnapshot: contractB,
      evaluator: { kind: 'deterministic', version: 'criteria-evaluator-v1' },
      criteriaEngineVersion: 'criteria-engine-v1',
    });
    const evaluatorChanged = store.record({
      ...sameEvidence,
      detectedAt: '2026-08-17T12:52:05.000Z',
      evaluation: { satisfied: 'undetermined', basis: 'judged', confidence: 'low' },
    }, {
      contractSnapshot: contractB,
      evaluator: { kind: 'judge', version: 'judge-v2', judge: 'model-v2' },
      criteriaEngineVersion: 'criteria-engine-v1',
    });

    expect(contractEval.contractHash).not.toBe(contractChanged.contractHash);
    expect(contractChanged.contractHash).toBe(evaluatorChanged.contractHash);
    expect(contractChanged.inputFingerprint).not.toBe(evaluatorChanged.inputFingerprint);
    const history = store.getHistory(runId);
    expect(history?.evaluations[1].changeReason).toEqual(['contract changed']);
    expect(history?.evaluations[2].changeReason).toEqual(['evaluator changed']);
  });

  it('marks identical-input reruns without claiming input changes', () => {
    const runId = 'run-history-rerun';
    const contract = {
      expected: 'Result mentions VIP',
      evidence: [{ kind: 'nodeResult', nodeId: 'step' }],
      success: [{ kind: 'regexMatch', nodeId: 'step', pattern: 'VIP' }],
    } satisfies OutcomeExpectation;
    store.record({
      ...evaluationRecordBase(runId, 'VIP contact synced'),
      detectedAt: '2026-08-17T12:55:05.000Z',
      evaluation: { satisfied: 'yes', basis: 'criteria', confidence: 'high', criteriaResults: [{ description: 'regexMatch(step, /VIP/)', passed: true }] },
    }, {
      contractSnapshot: contract,
      evaluator: { kind: 'deterministic', version: 'criteria-evaluator-v1' },
      criteriaEngineVersion: 'criteria-engine-v1',
    });
    store.record({
      ...evaluationRecordBase(runId, 'VIP contact synced'),
      detectedAt: '2026-08-17T12:56:05.000Z',
      evaluation: { satisfied: 'yes', basis: 'criteria', confidence: 'high', criteriaResults: [{ description: 'regexMatch(step, /VIP/)', passed: true }] },
    }, {
      contractSnapshot: contract,
      evaluator: { kind: 'deterministic', version: 'criteria-evaluator-v1' },
      criteriaEngineVersion: 'criteria-engine-v1',
    });
    const history = store.getHistory(runId);
    expect(history?.evaluations[1].changeReason).toEqual(['identical-input rerun']);
  });
});

function evaluationRecordBase(runId: string, value: string): OutcomeRecord {
  return {
    version: OUTCOME_RECORD_VERSION,
    runId,
    agentId: 'proof-agent',
    agentVersion: 1,
    detectedAt: '2026-08-17T12:00:00.000Z',
    intent: { expected: 'proof', assumptions: [], unobservable: [] },
    execution: {
      actor: { agentId: 'proof-agent', agentVersion: 1, triggeredBy: 'cli' },
      runStatus: 'completed',
      startedAt: '2026-08-17T11:59:00.000Z',
      completedAt: '2026-08-17T12:00:00.000Z',
      nodes: [{ nodeId: 'step', status: 'completed', exitCode: 0 }],
    },
    observation: {
      evidence: [{
        id: 'ev1',
        kind: 'node-result',
        source: { runId, nodeId: 'step', selector: 'nodeResult' },
        value,
        truncated: false,
        capturedAt: '2026-08-17T12:00:00.000Z',
      }],
    },
    evaluation: { satisfied: 'undetermined', basis: 'undetermined', confidence: 'low' },
    unknowns: [],
  };
}

function agent(outcome?: OutcomeExpectation): Agent {
  return {
    id: 'make-a-reminder',
    name: 'Make a reminder',
    status: 'active',
    source: 'examples',
    version: 1,
    nodes: [{ id: 'create-reminder', type: 'shell', command: 'echo ok' }],
    ...(outcome && { outcome }),
  } as Agent;
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-reminder-1',
    agentName: 'make-a-reminder',
    status: 'completed',
    startedAt: '2026-08-17T09:59:00.000Z',
    completedAt: '2026-08-17T10:00:00.000Z',
    triggeredBy: 'cli',
    ...overrides,
  } as Run;
}

function execs(result: string, runId = 'run-reminder-1'): NodeExecutionRecord[] {
  return [
    {
      runId,
      nodeId: 'create-reminder',
      workflowVersion: 1,
      status: 'completed',
      startedAt: '2026-08-17T10:00:00.000Z',
      result,
      exitCode: 0,
    },
  ] as NodeExecutionRecord[];
}
