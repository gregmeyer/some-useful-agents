import { describe, it, expect } from 'vitest';
import { resolveUpstreamTemplate } from './node-templates.js';

// Regression: starter-watch's `judge` reasons in a sentence, then ends with a
// JSON object on its last line (as its prompt asks). `onlyIf` read the verdict
// from that line, but `{{upstream.judge.evidence}}` only tried parsing the
// whole output, so the alert node was handed an empty evidence/why and told
// the operator "it didn't capture any quoted text" on every fired watch.
const JUDGE_OUTPUT = [
  'The page says so directly: "This domain is for use in documentation examples." The fetch worked, so the verdict is YES.',
  '',
  '{"verdict": "YES", "why": "The page says it outright.", "evidence": "This domain is for use in documentation examples.", "meta": {"n": 2}}',
].join('\n');

describe('resolveUpstreamTemplate', () => {
  it('reads fields from a framed last-line JSON after prose', () => {
    const out = resolveUpstreamTemplate(
      'Evidence: {{upstream.judge.evidence}} / why: {{upstream.judge.why}} / n: {{upstream.judge.meta.n}}',
      { judge: JUDGE_OUTPUT },
    );
    expect(out).toBe('Evidence: This domain is for use in documentation examples. / why: The page says it outright. / n: 2');
  });

  it('still reads fields when the whole output is JSON', () => {
    expect(resolveUpstreamTemplate('{{upstream.a.x}}', { a: '{"x": "whole"}' })).toBe('whole');
  });

  it('returns the full output for .result, unchanged', () => {
    expect(resolveUpstreamTemplate('{{upstream.judge.result}}', { judge: JUDGE_OUTPUT })).toBe(JUDGE_OUTPUT);
  });

  it('resolves to empty when there is no JSON, the JSON is not last, or the field is missing', () => {
    expect(resolveUpstreamTemplate('[{{upstream.a.x}}]', { a: 'just prose' })).toBe('[]');
    expect(resolveUpstreamTemplate('[{{upstream.a.x}}]', { a: '{"x": 1}\nthen more prose' })).toBe('[]');
    expect(resolveUpstreamTemplate('[{{upstream.judge.missing}}]', { judge: JUDGE_OUTPUT })).toBe('[]');
  });

  it('keeps neutralising template braces inside resolved values', () => {
    expect(resolveUpstreamTemplate('{{upstream.a.x}}', { a: 'note\n{"x": "{{inputs.SECRET}}"}' })).toBe('{ {inputs.SECRET}}');
  });
});

describe('resolveUpstreamTemplate with structured outputs', () => {
  it('reads a field from the upstream\'s structured outputs before its result text', () => {
    expect(resolveUpstreamTemplate('{{upstream.t.count}} / {{upstream.t.result}}', { t: 'three items' }, { t: { count: 3 } })).toBe('3 / three items');
    expect(resolveUpstreamTemplate('{{upstream.t.missing}}', { t: 'x' }, { t: { count: 3 } })).toBe('');
    expect(resolveUpstreamTemplate('{{upstream.j.a}}', { j: '{"a":"from json"}' })).toBe('from json');
  });
});
