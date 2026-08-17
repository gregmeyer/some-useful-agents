import { describe, it, expect } from 'vitest';
import type { Agent, NodeExecutionRecord } from '../agent-v2-types.js';
import type { Run } from '../types.js';
import { detectOutcome } from './detect.js';
import type { JudgeFn, OutcomeExpectation } from './types.js';

const FIXED_NOW = () => new Date('2026-08-15T12:00:00.000Z');

function agent(outcome?: OutcomeExpectation): Agent {
  return {
    id: 'digest',
    name: 'Digest',
    status: 'active',
    source: 'examples',
    version: 3,
    nodes: [
      { id: 'fetch', type: 'shell', tool: 'file-read' },
      { id: 'summarise', type: 'shell', command: 'echo hi', dependsOn: ['fetch'] },
    ],
    ...(outcome && { outcome }),
  } as Agent;
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    agentName: 'digest',
    status: 'completed',
    startedAt: '2026-08-15T11:59:00.000Z',
    completedAt: '2026-08-15T12:00:00.000Z',
    triggeredBy: 'cli',
    ...overrides,
  } as Run;
}

function execs(summariseResult: string, status = 'completed', exitCode = 0): NodeExecutionRecord[] {
  return [
    { runId: 'run-1', nodeId: 'fetch', workflowVersion: 1, status: 'completed', startedAt: 'x', result: '{}', exitCode: 0, outputsJson: JSON.stringify({ bytes: 940 }) },
    { runId: 'run-1', nodeId: 'summarise', workflowVersion: 1, status, startedAt: 'x', result: summariseResult, exitCode },
  ] as NodeExecutionRecord[];
}

const EXPECTATION: OutcomeExpectation = {
  expected: 'A digest listing headlines with a non-zero count line.',
  evidence: [
    { kind: 'nodeResult', nodeId: 'summarise' },
    { kind: 'nodeOutputField', nodeId: 'fetch', field: 'bytes' },
  ],
  success: [
    { kind: 'shellExitZero', nodeId: 'summarise' },
    { kind: 'regexMatch', nodeId: 'summarise', pattern: '[1-9][0-9]* headlines loaded' },
  ],
};

describe('detectOutcome — deterministic path', () => {
  it('reports yes with high confidence when every criterion passes', async () => {
    const record = await detectOutcome({
      agent: agent(EXPECTATION),
      run: run(),
      nodeExecutions: execs('=== Daily Digest ===\n10 headlines loaded.'),
      now: FIXED_NOW,
    });

    expect(record.evaluation.satisfied).toBe('yes');
    expect(record.evaluation.basis).toBe('criteria');
    expect(record.evaluation.confidence).toBe('high');
    expect(record.observation.evidence).toHaveLength(2);
    expect(record.intent.expected).toContain('non-zero count line');
    expect(record.agentVersion).toBe(3);
  });

  // The headline requirement: agent completion is NOT outcome success.
  it('does not report success for a run that completed cleanly but missed the outcome', async () => {
    const record = await detectOutcome({
      agent: agent(EXPECTATION),
      run: run({ status: 'completed', exitCode: 0 }),
      nodeExecutions: execs('=== Daily Digest ===\n0 headlines loaded.'),
      now: FIXED_NOW,
    });

    // The run exited 0 and the shell criterion passed — but the digest was
    // empty, so the outcome was only partly reached. `partial`, not `yes`.
    expect(record.execution.runStatus).toBe('completed');
    expect(record.evaluation.satisfied).toBe('partial');
    const failed = record.evaluation.criteriaResults!.filter((r) => !r.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0].description).toContain('regexMatch');
  });

  it('reports no when every criterion fails', async () => {
    const record = await detectOutcome({
      agent: agent(EXPECTATION),
      run: run(),
      // non-zero exit AND no count line — nothing to salvage.
      nodeExecutions: execs('crashed', 'failed', 2),
      now: FIXED_NOW,
    });
    expect(record.evaluation.satisfied).toBe('no');
    expect(record.evaluation.criteriaResults!.every((r) => !r.passed)).toBe(true);
  });

  it('reports undetermined when nothing was declared to check against', async () => {
    const record = await detectOutcome({
      agent: agent({ expected: 'something good happened', evidence: [{ kind: 'runStatus' }] }),
      run: run(),
      nodeExecutions: execs('whatever'),
      now: FIXED_NOW,
    });

    expect(record.evaluation.satisfied).toBe('undetermined');
    expect(record.evaluation.basis).toBe('undetermined');
    expect(record.evaluation.confidence).toBe('low');
    expect(record.unknowns.map((u) => u.reason)).toContain('no-criteria');
    expect(record.unknowns.map((u) => u.reason)).toContain('not-inferred');
  });

  it('records each absent evidence item as a typed unknown', async () => {
    const record = await detectOutcome({
      agent: agent({
        expected: 'x',
        evidence: [{ kind: 'nodeResult', nodeId: 'never-ran' }],
      }),
      run: run(),
      nodeExecutions: execs('ok'),
      now: FIXED_NOW,
    });
    const missing = record.unknowns.filter((u) => u.reason === 'evidence-missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].field).toBe('observation.evidence.ev1');
  });

  it('flags declared blind spots and refuses to call the outcome a full success', async () => {
    const record = await detectOutcome({
      agent: agent({ ...EXPECTATION, unobservable: ['whether a human actually read the digest'] }),
      run: run(),
      nodeExecutions: execs('10 headlines loaded.'),
      now: FIXED_NOW,
    });

    // Every machine-checkable criterion passed…
    expect(record.evaluation.criteriaResults!.every((r) => r.passed)).toBe(true);
    // …but part of the expectation was never observable, so not "yes".
    expect(record.evaluation.satisfied).toBe('partial');
    const blind = record.unknowns.filter((u) => u.reason === 'not-observable-post-hoc');
    expect(blind).toHaveLength(1);
    expect(blind[0].detail).toContain('human actually read');
  });

  it('flags a total absence of evidence selectors', async () => {
    const record = await detectOutcome({
      agent: agent({ expected: 'x' }),
      run: run(),
      nodeExecutions: execs('ok'),
      now: FIXED_NOW,
    });
    expect(record.unknowns.some((u) => u.field === 'observation.evidence' && u.reason === 'not-captured')).toBe(true);
  });

  it('honours an imperative expectation over the agent block', async () => {
    const record = await detectOutcome({
      agent: agent({ expected: 'from yaml' }),
      run: run(),
      nodeExecutions: execs('ok'),
      expectation: { expected: 'from the caller', evidence: [{ kind: 'runStatus' }] },
      now: FIXED_NOW,
    });
    expect(record.intent.expected).toBe('from the caller');
  });
});

describe('detectOutcome — evidence grounding', () => {
  const honest: JudgeFn = async ({ evidence }) => ({
    observedOutcome: { text: 'A digest with 10 headlines was produced.', citedEvidenceIds: [evidence[0].id] },
    expectedVsObserved: { text: 'Matches the expectation.', citedEvidenceIds: [evidence[0].id] },
    satisfied: 'yes',
  });

  it('keeps claims whose citations all resolve', async () => {
    const record = await detectOutcome({
      agent: agent(EXPECTATION),
      run: run(),
      nodeExecutions: execs('10 headlines loaded.'),
      judge: honest,
      now: FIXED_NOW,
    });
    expect(record.observation.observedOutcome?.text).toContain('10 headlines');
    expect(record.observation.observedOutcome?.citedEvidenceIds).toEqual(['ev1']);
  });

  // This is the anti-fabrication mechanism. A model that invents a citation
  // must lose the claim outright, not have it quietly accepted.
  it('drops a claim that cites evidence which does not exist', async () => {
    const liar: JudgeFn = async () => ({
      observedOutcome: { text: 'The digest was emailed to 400 subscribers.', citedEvidenceIds: ['ev99'] },
      expectedVsObserved: { text: 'Fully satisfied.', citedEvidenceIds: ['ev1'] },
      satisfied: 'yes',
    });

    const record = await detectOutcome({
      agent: agent({ ...EXPECTATION, success: undefined }),
      run: run(),
      nodeExecutions: execs('10 headlines loaded.'),
      judge: liar,
      now: FIXED_NOW,
    });

    expect(record.observation.observedOutcome).toBeUndefined();
    const ungrounded = record.unknowns.filter((u) => u.reason === 'ungrounded-claim');
    expect(ungrounded).toHaveLength(1);
    expect(ungrounded[0].detail).toContain('ev99');
    expect(ungrounded[0].detail).toContain('emailed to 400 subscribers');
    // The surviving claim is kept; confidence drops because one was dropped.
    expect(record.evaluation.expectedVsObserved?.text).toBe('Fully satisfied.');
    expect(record.evaluation.confidence).toBe('low');
  });

  it('drops a claim that cites nothing at all', async () => {
    const vague: JudgeFn = async () => ({
      observedOutcome: { text: 'It seems to have worked.', citedEvidenceIds: [] },
      expectedVsObserved: { text: 'Close enough.', citedEvidenceIds: [] },
      satisfied: 'yes',
    });
    const record = await detectOutcome({
      agent: agent({ ...EXPECTATION, success: undefined }),
      run: run(),
      nodeExecutions: execs('10 headlines loaded.'),
      judge: vague,
      now: FIXED_NOW,
    });
    expect(record.observation.observedOutcome).toBeUndefined();
    expect(record.evaluation.expectedVsObserved).toBeUndefined();
    expect(record.unknowns.filter((u) => u.reason === 'ungrounded-claim')).toHaveLength(2);
  });
});

describe('detectOutcome — criteria beat the judge', () => {
  it('overrides a judge that claims success against failing criteria, and records the disagreement', async () => {
    const optimist: JudgeFn = async ({ evidence }) => ({
      observedOutcome: { text: 'Looks fine to me.', citedEvidenceIds: [evidence[0].id] },
      expectedVsObserved: { text: 'Satisfied.', citedEvidenceIds: [evidence[0].id] },
      satisfied: 'yes',
    });

    const record = await detectOutcome({
      agent: agent(EXPECTATION),
      run: run(),
      nodeExecutions: execs('0 headlines loaded.'),
      judge: optimist,
      now: FIXED_NOW,
    });

    expect(record.evaluation.satisfied).toBe('partial');
    expect(record.evaluation.basis).toBe('criteria');
    expect(record.evaluation.judgeDisagreedWithCriteria).toBe(true);
    // The judge's prose is still kept — it's inferred, and labelled as such.
    expect(record.observation.observedOutcome?.text).toBe('Looks fine to me.');
  });

  it('uses the judge verdict when no criteria exist', async () => {
    const judge: JudgeFn = async ({ evidence }) => ({
      observedOutcome: { text: 'Nothing was produced.', citedEvidenceIds: [evidence[0].id] },
      expectedVsObserved: { text: 'Falls short.', citedEvidenceIds: [evidence[0].id] },
      satisfied: 'no',
    });
    const record = await detectOutcome({
      agent: agent({ expected: 'a digest', evidence: [{ kind: 'runStatus' }] }),
      run: run(),
      nodeExecutions: execs(''),
      judge,
      now: FIXED_NOW,
    });
    expect(record.evaluation.satisfied).toBe('no');
    expect(record.evaluation.basis).toBe('judged');
    expect(record.evaluation.confidence).toBe('medium');
  });

  it('records a judge that returned nothing usable as not-inferred', async () => {
    const record = await detectOutcome({
      agent: agent(EXPECTATION),
      run: run(),
      nodeExecutions: execs('10 headlines loaded.'),
      judge: async () => null,
      now: FIXED_NOW,
    });
    expect(record.unknowns.some((u) => u.reason === 'not-inferred')).toBe(true);
    expect(record.evaluation.satisfied).toBe('yes'); // criteria still stand
  });
});

describe('detectOutcome — failed runs', () => {
  it('produces a record for a run that failed outright', async () => {
    const record = await detectOutcome({
      agent: agent({
        expected: 'a digest',
        evidence: [
          { kind: 'nodeStatus', nodeId: 'fetch' },
          { kind: 'nodeResult', nodeId: 'summarise' },
        ],
        success: [{ kind: 'shellExitZero', nodeId: 'summarise' }],
      }),
      run: run({ status: 'failed', error: 'Node "fetch" failed' }),
      nodeExecutions: [
        { runId: 'run-1', nodeId: 'fetch', workflowVersion: 1, status: 'failed', startedAt: 'x', exitCode: 1, errorCategory: 'exit_nonzero' },
        { runId: 'run-1', nodeId: 'summarise', workflowVersion: 1, status: 'skipped', startedAt: 'x', errorCategory: 'upstream_failed' },
      ] as NodeExecutionRecord[],
      now: FIXED_NOW,
    });

    expect(record.evaluation.satisfied).toBe('no');
    expect(record.execution.nodes.map((n) => n.status)).toEqual(['failed', 'skipped']);
    expect(record.execution.nodes[0].errorCategory).toBe('exit_nonzero');
    // The failure itself is evidence, and the missing downstream output is
    // recorded as absent rather than omitted.
    expect(record.observation.evidence[0].kind).toBe('node-status');
    expect(record.observation.evidence[1].kind).toBe('absent');
  });
});
