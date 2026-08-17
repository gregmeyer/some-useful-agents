import { describe, it, expect } from 'vitest';
import { buildOutcomeFeedback, withOutcomeFeedback, OUTCOME_FEEDBACK_INPUT, type OutcomeFeedbackSource } from './feedback.js';
import type { OutcomeRecord, OutcomeVerdict } from './types.js';

function record(satisfied: OutcomeVerdict, runId = 'run-abcd1234'): OutcomeRecord {
  return {
    version: 1,
    runId,
    agentId: 'news-digest',
    agentVersion: 1,
    detectedAt: '2026-01-01T00:01:00Z',
    intent: {
      expected: 'A digest with a non-zero count line.',
      assumptions: [],
      unobservable: [],
    },
    execution: {
      actor: { agentId: 'news-digest', agentVersion: 1, triggeredBy: 'schedule' },
      runStatus: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      nodes: [],
    },
    observation: {
      evidence: [
        {
          id: 'ev1',
          kind: 'node-result',
          source: { runId, nodeId: 'summarise', selector: 'nodeResult' },
          value: '0 headlines loaded.',
          truncated: false,
          capturedAt: '2026-01-01T00:01:00Z',
        },
        {
          id: 'ev2',
          kind: 'absent',
          source: { runId, nodeId: 'fetch', field: 'bytes', selector: 'nodeOutputField' },
          value: 'no structured output',
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
        { description: 'regexMatch(summarise, /[1-9]/)', passed: false, reason: 'regex did not match' },
      ],
    },
    unknowns: [],
  };
}

function source(...records: OutcomeRecord[]): OutcomeFeedbackSource {
  return { list: ({ limit }) => records.slice(0, limit ?? records.length).map((r) => ({ record: r })) };
}

describe('buildOutcomeFeedback', () => {
  it('reports what the previous run failed to achieve, with evidence', () => {
    const fb = buildOutcomeFeedback(source(record('no')), 'news-digest')!;
    expect(fb).toContain('did not achieve its declared outcome');
    expect(fb).toContain('A digest with a non-zero count line.');
    expect(fb).toContain('regexMatch(summarise');
    expect(fb).toContain('regex did not match');
    // The next run needs to see what was actually produced, not just be told
    // it was wrong.
    expect(fb).toContain('0 headlines loaded.');
    expect(fb).toContain('(NOT FOUND)');
  });

  it('describes a partial miss as partial', () => {
    expect(buildOutcomeFeedback(source(record('partial')), 'news-digest')).toContain('only partly achieved');
  });

  it('says nothing when the previous run achieved its outcome', () => {
    expect(buildOutcomeFeedback(source(record('yes')), 'news-digest')).toBeUndefined();
  });

  // Telling an agent it failed when we simply couldn't tell would be a
  // fabrication — the exact thing this capability exists to avoid.
  it('says nothing when the previous outcome was undetermined', () => {
    expect(buildOutcomeFeedback(source(record('undetermined')), 'news-digest')).toBeUndefined();
  });

  it('says nothing when there are no records or no store', () => {
    expect(buildOutcomeFeedback(source(), 'news-digest')).toBeUndefined();
    expect(buildOutcomeFeedback(undefined, 'news-digest')).toBeUndefined();
  });

  // A miss from three weeks ago is noise, not context — it would quietly bias
  // every future run of an agent that has since been fixed.
  it('reads only the immediately-previous run', () => {
    let askedLimit: number | undefined;
    const store: OutcomeFeedbackSource = {
      list: (q) => { askedLimit = q.limit; return [{ record: record('yes') }]; },
    };
    expect(buildOutcomeFeedback(store, 'news-digest')).toBeUndefined();
    expect(askedLimit).toBe(1);
  });

  it('degrades to undefined when the store throws', () => {
    const store: OutcomeFeedbackSource = { list: () => { throw new Error('db locked'); } };
    expect(buildOutcomeFeedback(store, 'news-digest')).toBeUndefined();
  });
});

describe('withOutcomeFeedback', () => {
  it('adds the input when the previous run missed', () => {
    const merged = withOutcomeFeedback({ ZIP: '94110' }, source(record('no')), 'news-digest')!;
    expect(merged.ZIP).toBe('94110');
    expect(merged[OUTCOME_FEEDBACK_INPUT]).toContain('did not achieve');
  });

  it('passes inputs through untouched when there is nothing to say', () => {
    const inputs = { ZIP: '94110' };
    expect(withOutcomeFeedback(inputs, source(record('yes')), 'news-digest')).toBe(inputs);
    expect(withOutcomeFeedback(undefined, source(), 'news-digest')).toBeUndefined();
  });
});
