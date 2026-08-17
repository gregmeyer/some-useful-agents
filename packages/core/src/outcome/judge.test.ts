import { describe, it, expect } from 'vitest';
import { buildJudgePrompt, llmJudge, parseJudgeResponse } from './judge.js';
import type { EvidenceItem } from './types.js';

const EVIDENCE: EvidenceItem[] = [
  {
    id: 'ev1',
    kind: 'node-result',
    label: 'The digest text',
    source: { runId: 'run-1', nodeId: 'summarise', selector: 'nodeResult' },
    value: '10 headlines loaded.',
    truncated: false,
    capturedAt: '2026-08-15T12:00:00.000Z',
  },
  {
    id: 'ev2',
    kind: 'absent',
    source: { runId: 'run-1', path: '/tmp/digest.txt', selector: 'file' },
    value: 'path "/tmp/digest.txt" does not exist',
    truncated: false,
    capturedAt: '2026-08-15T12:00:00.000Z',
  },
];

describe('buildJudgePrompt', () => {
  it('shows every evidence id with its provenance', () => {
    const prompt = buildJudgePrompt({
      expected: 'A digest was written to disk.',
      assumptions: [],
      unobservable: [],
      evidence: EVIDENCE,
    });
    expect(prompt).toContain('[ev1] kind=node-result node=summarise label="The digest text"');
    expect(prompt).toContain('10 headlines loaded.');
    expect(prompt).toContain('[ev2] kind=absent path=/tmp/digest.txt');
    expect(prompt).toContain('NOT FOUND: path "/tmp/digest.txt" does not exist');
  });

  // The judge must not be able to cite anything it wasn't shown, so it is
  // never given the run, the node records, or the agent definition.
  it('does not leak the raw run or agent definition into the prompt', () => {
    const prompt = buildJudgePrompt({
      expected: 'x',
      assumptions: [],
      unobservable: [],
      evidence: EVIDENCE,
    });
    expect(prompt).not.toContain('nodeExecutions');
    expect(prompt).not.toContain('outputsJson');
    expect(prompt).not.toContain('workflowVersion');
  });

  it('tells the model that undetermined is an acceptable answer', () => {
    const prompt = buildJudgePrompt({ expected: 'x', assumptions: [], unobservable: [], evidence: [] });
    expect(prompt).toContain('"undetermined" is a correct answer');
    expect(prompt).toContain('finishing without error is NOT the same as the outcome being');
  });

  it('surfaces declared assumptions and blind spots separately', () => {
    const prompt = buildJudgePrompt({
      expected: 'x',
      assumptions: ['the source file is valid JSON'],
      unobservable: ['whether anyone read it'],
      evidence: [],
    });
    expect(prompt).toContain('Assumptions the author declared (unverified)');
    expect(prompt).toContain('- the source file is valid JSON');
    expect(prompt).toContain('Known blind spots');
    expect(prompt).toContain('- whether anyone read it');
  });

  it('includes already-evaluated deterministic criteria as authoritative', () => {
    const prompt = buildJudgePrompt({
      expected: 'x',
      assumptions: [],
      unobservable: [],
      evidence: [],
      criteriaResults: [{ description: 'regexMatch(summarise, /\\d+/)', passed: false, reason: 'regex did not match' }],
    });
    expect(prompt).toContain('authoritative');
    expect(prompt).toContain('FAILED (regex did not match)');
  });
});

describe('parseJudgeResponse', () => {
  const valid = JSON.stringify({
    observedOutcome: { text: 'a digest was produced', citedEvidenceIds: ['ev1'] },
    expectedVsObserved: { text: 'matches', citedEvidenceIds: ['ev1'] },
    satisfied: 'yes',
  });

  it('parses a tagged block', () => {
    const v = parseJudgeResponse(`chatter before\n<outcome>${valid}</outcome>\nchatter after`);
    expect(v?.satisfied).toBe('yes');
    expect(v?.observedOutcome.citedEvidenceIds).toEqual(['ev1']);
  });

  it('parses a fenced block (models drop the tag constantly)', () => {
    const v = parseJudgeResponse('```json\n' + valid + '\n```');
    expect(v?.satisfied).toBe('yes');
  });

  it('defaults citedEvidenceIds to an empty array so detect can reject it', () => {
    const v = parseJudgeResponse(`<outcome>${JSON.stringify({
      observedOutcome: { text: 'a' },
      expectedVsObserved: { text: 'b' },
      satisfied: 'yes',
    })}</outcome>`);
    expect(v?.observedOutcome.citedEvidenceIds).toEqual([]);
  });

  it('returns null on prose, broken JSON, and an invalid verdict value', () => {
    expect(parseJudgeResponse('I think it worked fine!')).toBeNull();
    expect(parseJudgeResponse('<outcome>{ not json </outcome>')).toBeNull();
    expect(parseJudgeResponse(`<outcome>${JSON.stringify({
      observedOutcome: { text: 'a', citedEvidenceIds: [] },
      expectedVsObserved: { text: 'b', citedEvidenceIds: [] },
      satisfied: 'probably',
    })}</outcome>`)).toBeNull();
  });
});

describe('llmJudge', () => {
  it('returns a verdict from a successful invocation', async () => {
    const judge = llmJudge({
      provider: 'claude',
      invoke: async () => ({
        output: `<outcome>{"observedOutcome":{"text":"ok","citedEvidenceIds":["ev1"]},"expectedVsObserved":{"text":"ok","citedEvidenceIds":["ev1"]},"satisfied":"yes"}</outcome>`,
        exitCode: 0,
      }),
    });
    const v = await judge({ expected: 'x', assumptions: [], unobservable: [], evidence: EVIDENCE });
    expect(v?.satisfied).toBe('yes');
  });

  it('returns null when the provider fails, so detect records not-inferred', async () => {
    const judge = llmJudge({
      provider: 'claude',
      invoke: async () => ({ output: '', error: 'binary not found', exitCode: 127 }),
    });
    expect(await judge({ expected: 'x', assumptions: [], unobservable: [], evidence: [] })).toBeNull();
  });
});
