import { describe, it, expect } from 'vitest';
import { extractField } from './output-widgets.js';

describe('extractField', () => {
  // Whole-output JSON (the fast path)
  it('reads a top-level key from pure JSON output', () => {
    expect(extractField('{"total":4,"label":"hi"}', 'total')).toBe('4');
    expect(extractField('{"total":4,"label":"hi"}', 'label')).toBe('hi');
  });

  it('falls back to deep search for branch-node merged shape', () => {
    const out = '{"merged":{"node-a":{"answer":"yes"}}}';
    expect(extractField(out, 'answer')).toBe('yes');
  });

  it('serialises non-string values as pretty JSON', () => {
    const out = '{"items":[1,2,3]}';
    expect(extractField(out, 'items')).toBe('[\n  1,\n  2,\n  3\n]');
  });

  // XML-tag mode (legacy agent-analyzer pattern)
  it('reads <tag>value</tag> markers', () => {
    expect(extractField('text <answer>42</answer> more', 'answer')).toBe('42');
  });

  it('XML-tag mode beats whole-output JSON when both match', () => {
    const out = '<answer>tag wins</answer>{"answer":"json"}';
    expect(extractField(out, 'answer')).toBe('tag wins');
  });

  // The bug this commit fixes: prose followed by a JSON object.
  // claude-code summarisers commonly produce this shape — human-readable
  // narrative for `run.result`, plus a final JSON line that drives the
  // widget. Before this fix, `JSON.parse(entire output)` failed and the
  // widget rendered empty.
  it('extracts a trailing JSON object after human prose', () => {
    const out = [
      '**Churn Brief — 2026-05-14**',
      '',
      '- iris@example.com (pro)',
      '- henry@example.com (team)',
      '',
      '{"total_churned": 4, "recent_count": 4, "summary": "..."}',
    ].join('\n');
    expect(extractField(out, 'total_churned')).toBe('4');
    expect(extractField(out, 'recent_count')).toBe('4');
    expect(extractField(out, 'summary')).toBe('...');
  });

  it('prefers the rightmost / smallest trailing object when multiple exist', () => {
    // Agent wrote `{"draft":1}` mid-output, then the final widget JSON.
    // The rightmost balanced object is what counts as the agent's verdict.
    const out = 'draft attempt {"draft":1}\nfinal {"answer":"yes"}';
    expect(extractField(out, 'answer')).toBe('yes');
    // The earlier `draft` key isn't visible because we stop at the
    // smallest trailing object — that's the intended contract.
    expect(extractField('alone {"draft":1}', 'draft')).toBe('1');
  });

  it('handles strings that contain `{` or `}` inside values', () => {
    const out = 'preface {"raw":"a{b}c","ok":true}';
    expect(extractField(out, 'raw')).toBe('a{b}c');
    expect(extractField(out, 'ok')).toBe('true');
  });

  it('returns undefined when no JSON or tag is present', () => {
    expect(extractField('just plain prose, no markers', 'anything')).toBeUndefined();
  });

  it('returns undefined when the trailing brace is unmatched', () => {
    // `}` exists but no preceding `{` parses → no rescue.
    expect(extractField('text } end', 'x')).toBeUndefined();
  });

  it('ignores primitive JSON at root', () => {
    // A bare quoted string parses as JSON but has no fields to extract.
    expect(extractField('"just a string"', 'x')).toBeUndefined();
    expect(extractField('42', 'x')).toBeUndefined();
  });
});
