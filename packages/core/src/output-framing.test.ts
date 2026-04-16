import { describe, it, expect } from 'vitest';
import { extractFramedOutput, buildToolOutput } from './output-framing.js';

describe('extractFramedOutput', () => {
  it('extracts a JSON object from the last line', () => {
    const stdout = 'some debug output\n{"status": 200, "body": {"ok": true}}\n';
    const result = extractFramedOutput(stdout);
    expect(result).toEqual({ status: 200, body: { ok: true } });
  });

  it('skips trailing empty lines', () => {
    const stdout = '{"count": 3}\n\n\n';
    const result = extractFramedOutput(stdout);
    expect(result).toEqual({ count: 3 });
  });

  it('returns undefined when last line is not JSON', () => {
    const stdout = 'just plain text\n';
    expect(extractFramedOutput(stdout)).toBeUndefined();
  });

  it('returns undefined for empty stdout', () => {
    expect(extractFramedOutput('')).toBeUndefined();
  });

  it('extracts a JSON array from the last line', () => {
    const stdout = 'header\n[1, 2, 3]\n';
    const result = extractFramedOutput(stdout);
    expect(result).toEqual([1, 2, 3]);
  });

  it('returns undefined when the last line starts with a non-JSON char', () => {
    const stdout = 'hello world\n';
    expect(extractFramedOutput(stdout)).toBeUndefined();
  });

  it('handles a single JSON line with no prefix', () => {
    const stdout = '{"result": "done"}';
    const result = extractFramedOutput(stdout);
    expect(result).toEqual({ result: 'done' });
  });
});

describe('buildToolOutput', () => {
  it('uses framed output when present', () => {
    const stdout = 'debug\n{"status": 200}\n';
    const output = buildToolOutput(stdout);
    expect(output.status).toBe(200);
    expect(output.result).toBe(stdout);
  });

  it('wraps plain stdout when no framed output is found', () => {
    const stdout = 'just text\n';
    const output = buildToolOutput(stdout);
    expect(output.result).toBe(stdout);
    expect(output.status).toBeUndefined();
  });
});
