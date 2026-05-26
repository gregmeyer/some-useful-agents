import { describe, it, expect } from 'vitest';
import { formatExitCode, stripEnclosingCodeFence } from './components.js';

describe('formatExitCode', () => {
  it('renders a plain exit code', () => {
    expect(formatExitCode(0)).toBe('exit 0 (success)');
    expect(formatExitCode(2)).toBe('exit 2 (misuse of shell command)');
  });

  it('renders an unlabelled code without a paren', () => {
    expect(formatExitCode(42)).toBe('exit 42');
  });

  it('decodes signal exit codes', () => {
    expect(formatExitCode(137)).toBe('exit 137 (killed (SIGKILL / out of memory))');
    expect(formatExitCode(140)).toBe('exit 140 (signal 12)');
  });

  it('returns empty for no exit code — undefined OR null (DAG/multi-node runs)', () => {
    // DAG/multi-node runs carry no run-level exit code; the store returns null.
    // Regression: this used to render the literal "exit null".
    expect(formatExitCode(undefined)).toBe('');
    expect(formatExitCode(null)).toBe('');
  });
});

describe('stripEnclosingCodeFence', () => {
  it('strips a ```json … ``` wrapper', () => {
    expect(stripEnclosingCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a bare ``` … ``` wrapper', () => {
    expect(stripEnclosingCodeFence('```\nhello\nworld\n```')).toBe('hello\nworld');
  });

  it('leaves un-fenced text untouched', () => {
    expect(stripEnclosingCodeFence('just some output')).toBe('just some output');
  });

  it('leaves text with an inline (non-enclosing) fence untouched', () => {
    const mixed = 'Here is code:\n```js\nx()\n```\nand more prose';
    expect(stripEnclosingCodeFence(mixed)).toBe(mixed);
  });
});
