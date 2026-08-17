import { describe, it, expect } from 'vitest';
import type { OutcomeHistory, OutcomeRecord, OutcomeVerdict } from '@some-useful-agents/core';
import { render } from './html.js';
import { renderOutcomeRecord } from './outcome-record.js';
import { renderRunDetail } from './run-detail.js';

function record(overrides: Partial<{ satisfied: OutcomeVerdict; judged: boolean }> = {}): OutcomeRecord {
  const satisfied = overrides.satisfied ?? 'partial';
  return {
    version: 1,
    runId: 'run-abcd1234-zzz',
    agentId: 'news-digest',
    agentVersion: 2,
    detectedAt: '2026-01-01T00:01:00Z',
    intent: {
      expected: 'A digest listing headlines with a non-zero count line.',
      assumptions: ['The source file is valid JSON.'],
      unobservable: [],
    },
    execution: {
      actor: { agentId: 'news-digest', agentVersion: 2, triggeredBy: 'schedule' },
      runStatus: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      nodes: [{ nodeId: 'summarise', status: 'completed', exitCode: 0 }],
    },
    observation: {
      evidence: [
        {
          id: 'ev1',
          kind: 'node-result',
          label: 'The digest text',
          source: { runId: 'run-abcd1234-zzz', nodeId: 'summarise', selector: 'nodeResult' },
          value: '0 headlines loaded.',
          truncated: false,
          capturedAt: '2026-01-01T00:01:00Z',
        },
        {
          id: 'ev2',
          kind: 'absent',
          source: { runId: 'run-abcd1234-zzz', nodeId: 'fetch', field: 'bytes', selector: 'nodeOutputField' },
          value: 'node "fetch" produced no structured output',
          truncated: false,
          capturedAt: '2026-01-01T00:01:00Z',
        },
      ],
      ...(overrides.judged
        ? { observedOutcome: { text: 'The digest came out empty.', citedEvidenceIds: ['ev1'] } }
        : {}),
    },
    evaluation: {
      satisfied,
      basis: 'criteria',
      confidence: 'high',
      criteriaResults: [
        { description: 'shellExitZero(summarise)', passed: true },
        { description: 'regexMatch(summarise, /[1-9]/)', passed: false, reason: 'regex did not match' },
      ],
      ...(overrides.judged
        ? { expectedVsObserved: { text: 'Falls short of the expectation.', citedEvidenceIds: ['ev1'] } }
        : {}),
    },
    unknowns: [
      { field: 'observation.evidence.ev2', reason: 'evidence-missing', detail: 'no structured output' },
      { field: 'observation.observedOutcome', reason: 'not-inferred', detail: 'No judge was supplied.' },
    ],
  };
}

function history(overrides: Partial<OutcomeHistory> = {}): OutcomeHistory {
  return {
    runId: 'run-abcd1234-zzz',
    latestVerdict: 'undetermined',
    latestEvaluatedAt: '2026-08-17T12:16:05.000Z',
    evaluations: [
      {
        evaluationId: 'oeval-1',
        inputFingerprint: 'fp-1',
        evaluatedAt: '2026-08-17T12:00:05.000Z',
        verdict: 'undetermined',
        contractHash: 'contract-a',
        contractSnapshot: { expected: 'Reminder persisted', evidence: [{ kind: 'nodeResult', nodeId: 'create-reminder' }] },
        evaluator: { kind: 'judge', version: 'judge-v1', judge: 'model-a' },
        criteriaEngineVersion: 'criteria-v1',
        evidenceIds: ['ev1'],
        changeReason: ['initial evaluation'],
        evidence: [
          {
            id: 'ev1',
            observedAt: '2026-08-17T12:00:00.000Z',
            source: 'nodeResult',
            originatingRunId: 'run-abcd1234-zzz',
            observationMode: 'direct',
          },
        ],
        addedEvidence: [
          {
            id: 'ev1',
            observedAt: '2026-08-17T12:00:00.000Z',
            source: 'nodeResult',
            originatingRunId: 'run-abcd1234-zzz',
            observationMode: 'direct',
          },
        ],
      },
      {
        evaluationId: 'oeval-2',
        inputFingerprint: 'fp-2',
        evaluatedAt: '2026-08-17T12:05:05.000Z',
        verdict: 'yes',
        contractHash: 'contract-a',
        contractSnapshot: { expected: 'Reminder persisted', evidence: [{ kind: 'nodeResult', nodeId: 'create-reminder' }] },
        evaluator: { kind: 'judge', version: 'judge-v1', judge: 'model-a' },
        criteriaEngineVersion: 'criteria-v1',
        evidenceIds: ['ev1', 'ev2'],
        changeReason: ['new evidence'],
        evidence: [
          {
            id: 'ev1',
            observedAt: '2026-08-17T12:00:00.000Z',
            source: 'nodeResult',
            originatingRunId: 'run-abcd1234-zzz',
            observationMode: 'direct',
          },
          {
            id: 'ev2',
            observedAt: '2026-08-17T12:05:00.000Z',
            source: 'tool:apple.apple.reminder-read',
            subject: { type: 'reminder', id: 'rem-2' },
            originatingRunId: 'run-abcd1234-zzz',
            observingRunId: 'observe-run-a',
            observationMode: 'direct',
          },
        ],
        addedEvidence: [
          {
            id: 'ev2',
            observedAt: '2026-08-17T12:05:00.000Z',
            source: 'tool:apple.apple.reminder-read',
            subject: { type: 'reminder', id: 'rem-2' },
            originatingRunId: 'run-abcd1234-zzz',
            observingRunId: 'observe-run-a',
            observationMode: 'direct',
          },
        ],
      },
      {
        evaluationId: 'oeval-3',
        inputFingerprint: 'fp-3',
        evaluatedAt: '2026-08-17T12:10:05.000Z',
        verdict: 'no',
        contractHash: 'contract-b',
        contractSnapshot: { expected: 'Reminder title must mention VIP', evidence: [{ kind: 'nodeResult', nodeId: 'create-reminder' }] },
        evaluator: { kind: 'judge', version: 'judge-v1', judge: 'model-a' },
        criteriaEngineVersion: 'criteria-v1',
        evidenceIds: ['ev1', 'ev2'],
        changeReason: ['contract changed'],
        evidence: [
          {
            id: 'ev1',
            observedAt: '2026-08-17T12:00:00.000Z',
            source: 'nodeResult',
            originatingRunId: 'run-abcd1234-zzz',
            observationMode: 'direct',
          },
          {
            id: 'ev2',
            observedAt: '2026-08-17T12:05:00.000Z',
            source: 'tool:apple.apple.reminder-read',
            subject: { type: 'reminder', id: 'rem-2' },
            originatingRunId: 'run-abcd1234-zzz',
            observingRunId: 'observe-run-a',
            observationMode: 'direct',
          },
        ],
        addedEvidence: [],
      },
      {
        evaluationId: 'oeval-4',
        inputFingerprint: 'fp-4',
        evaluatedAt: '2026-08-17T12:15:05.000Z',
        verdict: 'undetermined',
        contractHash: 'contract-b',
        contractSnapshot: { expected: 'Reminder title must mention VIP', evidence: [{ kind: 'nodeResult', nodeId: 'create-reminder' }] },
        evaluator: { kind: 'judge', version: 'judge-v2', judge: 'model-b' },
        criteriaEngineVersion: 'criteria-v1',
        evidenceIds: ['ev1', 'ev2'],
        changeReason: ['evaluator changed'],
        evidence: [
          {
            id: 'ev1',
            observedAt: '2026-08-17T12:00:00.000Z',
            source: 'nodeResult',
            originatingRunId: 'run-abcd1234-zzz',
            observationMode: 'direct',
          },
          {
            id: 'ev2',
            observedAt: '2026-08-17T12:05:00.000Z',
            source: 'tool:apple.apple.reminder-read',
            subject: { type: 'reminder', id: 'rem-2' },
            originatingRunId: 'run-abcd1234-zzz',
            observingRunId: 'observe-run-a',
            observationMode: 'direct',
          },
        ],
        addedEvidence: [],
      },
      {
        evaluationId: 'oeval-5',
        inputFingerprint: 'fp-4',
        evaluatedAt: '2026-08-17T12:16:05.000Z',
        verdict: 'undetermined',
        contractHash: 'contract-b',
        contractSnapshot: { expected: 'Reminder title must mention VIP', evidence: [{ kind: 'nodeResult', nodeId: 'create-reminder' }] },
        evaluator: { kind: 'judge', version: 'judge-v2', judge: 'model-b' },
        criteriaEngineVersion: 'criteria-v1',
        evidenceIds: ['ev1', 'ev2'],
        changeReason: ['identical-input rerun'],
        evidence: [
          {
            id: 'ev1',
            observedAt: '2026-08-17T12:00:00.000Z',
            source: 'nodeResult',
            originatingRunId: 'run-abcd1234-zzz',
            observationMode: 'direct',
          },
          {
            id: 'ev2',
            observedAt: '2026-08-17T12:05:00.000Z',
            source: 'tool:apple.apple.reminder-read',
            subject: { type: 'reminder', id: 'rem-2' },
            originatingRunId: 'run-abcd1234-zzz',
            observingRunId: 'observe-run-a',
            observationMode: 'direct',
          },
        ],
        addedEvidence: [],
      },
    ],
    ...overrides,
  };
}

describe('renderOutcomeRecord', () => {
  it('leads with the verdict, basis and confidence', () => {
    const out = render(renderOutcomeRecord(record({ satisfied: 'no' })));
    expect(out).toContain('Outcome not achieved');
    expect(out).toContain('badge--err');
    expect(out).toContain('confidence high');
  });

  it('uses distinct verdicts for achieved, partial and undetermined', () => {
    expect(render(renderOutcomeRecord(record({ satisfied: 'yes' })))).toContain('Outcome achieved');
    expect(render(renderOutcomeRecord(record({ satisfied: 'partial' })))).toContain('Outcome partly achieved');
    const undet = render(renderOutcomeRecord(record({ satisfied: 'undetermined' })));
    expect(undet).toContain('Outcome undetermined');
    expect(undet).toContain('badge--muted');
  });

  it('shows expectation, failed checks, and the observed evidence', () => {
    const out = render(renderOutcomeRecord(record()));
    expect(out).toContain('A digest listing headlines');
    expect(out).toContain('regexMatch(summarise');
    expect(out).toContain('regex did not match');
    expect(out).toContain('0 headlines loaded.');
    expect(out).toContain('ev1');
  });

  it('marks absent evidence as not found rather than hiding it', () => {
    const out = render(renderOutcomeRecord(record()));
    expect(out).toContain('not found:');
    expect(out).toContain('no structured output');
  });

  // The record's whole value is that a reader can tell observation from
  // inference. If the markup doesn't say which is which, it's just prose.
  it('labels inferred claims as inferred and shows their citations', () => {
    const out = render(renderOutcomeRecord(record({ judged: true })));
    expect(out).toContain('inferred from the evidence below');
    expect(out).toContain('The digest came out empty.');
    expect(out).toContain('cites ev1');
    expect(out).toContain('(observed, not inferred)');
  });

  it('omits the inferred blocks entirely when no judge ran', () => {
    const out = render(renderOutcomeRecord(record()));
    expect(out).not.toContain('inferred from the evidence below');
  });

  it('reports actionable unknowns but not the no-judge default', () => {
    const out = render(renderOutcomeRecord(record()));
    expect(out).toContain('Could not be determined');
    expect(out).toContain('evidence-missing');
    expect(out).not.toContain('not-inferred');
  });

  it('collapses behind a summary in compact form and trims assumptions', () => {
    const out = render(renderOutcomeRecord(record(), { variant: 'compact' }));
    expect(out).toContain('<details');
    expect(out).toContain('<summary>');
    expect(out).not.toContain('Assumed (not verified)');
  });

  it('expands by default in full form and shows assumptions', () => {
    const out = render(renderOutcomeRecord(record()));
    expect(out).not.toContain('<details');
    expect(out).toContain('Assumed (not verified)');
    expect(out).toContain('The source file is valid JSON.');
  });
});

describe('run detail page', () => {
  const run = {
    id: 'run-abcd1234-zzz',
    agentName: 'news-digest',
    status: 'completed' as const,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:05Z',
    triggeredBy: 'schedule' as const,
    result: '0 headlines loaded.',
  };

  it('shows the outcome above the raw output', () => {
    const out = renderRunDetail({ run, outcome: record(), outcomeHistory: history() });
    expect(out).toContain('Outcome partly achieved');
    expect(out).toContain('Outcome history');
    // "did this achieve what it was for" comes before "what did it print".
    expect(out.indexOf('>Outcome<')).toBeLessThan(out.indexOf('>Output<'));
  });

  it('shows the outcome above the result on a multi-node DAG run', () => {
    const agent = {
      id: 'news-digest', name: 'News digest', status: 'active', source: 'examples', version: 2,
      nodes: [{ id: 'summarise', type: 'shell', command: 'echo hi' }],
    } as unknown as Parameters<typeof renderRunDetail>[0]['agent'];
    const out = renderRunDetail({
      run: { ...run, workflowId: 'news-digest' },
      agent,
      nodeExecutions: [{ runId: run.id, nodeId: 'summarise', workflowVersion: 2, status: 'completed', startedAt: run.startedAt, exitCode: 0 }] as never,
      outcome: record(),
      outcomeHistory: history(),
    });
    expect(out).toContain('Outcome partly achieved');
    expect(out).toContain('new evidence added');
    expect(out).toContain('contract changed');
    expect(out).toContain('evaluator changed');
    expect(out).toContain('identical-input rerun');
    expect(out).toContain('observe-run-a');
    expect(out).toContain('fp-4');
    expect(out.indexOf('>Outcome<')).toBeLessThan(out.indexOf('>Result<'));
  });

  it('keeps the latest outcome summary aligned with the newest history evaluation', () => {
    const out = renderRunDetail({
      run,
      outcome: record({ satisfied: 'undetermined' }),
      outcomeHistory: history(),
    });
    expect(out).toContain('Outcome undetermined');
    expect(out).toContain('latest undetermined at 2026-08-17T12:16:05.000Z');
  });

  it('renders unchanged for runs with no outcome record', () => {
    const out = renderRunDetail({ run });
    expect(out).not.toContain('outcome-record');
    expect(out).toContain('Output');
  });
});
