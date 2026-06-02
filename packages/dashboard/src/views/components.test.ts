import { describe, it, expect } from 'vitest';
import {
  formatExitCode,
  stripEnclosingCodeFence,
  workflowProviderBadge,
  humanizeTimestamps,
  linkifyRefs,
} from './components.js';
import { render } from './html.js';

describe('workflowProviderBadge', () => {
  it('renders a chip only for temporal', () => {
    expect(render(workflowProviderBadge('temporal'))).toContain('temporal');
    expect(render(workflowProviderBadge('temporal'))).toContain('badge');
  });

  it('renders nothing for local or undefined (color stays rare)', () => {
    expect(render(workflowProviderBadge('local'))).toBe('');
    expect(render(workflowProviderBadge(undefined))).toBe('');
  });
});

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

describe('humanizeTimestamps', () => {
  // Derive expected absolute strings with the same (local-time) formatter the
  // implementation uses, so these assertions are timezone-stable across CI hosts.
  const abs = (iso: string): string =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

  it('rewrites a bare ISO timestamp to absolute + relative', () => {
    const iso = '2026-05-30T04:15:41.198Z';
    const out = humanizeTimestamps(`added ${iso} to the catalog`);
    expect(out).toContain(abs(iso));
    expect(out).toMatch(/\(\d+[smhd] ago\)/);
    expect(out).not.toContain(iso);
  });

  it('handles a timestamp without milliseconds and with Z', () => {
    const iso = '2026-01-02T03:04:05Z';
    expect(humanizeTimestamps(iso)).toContain(abs(iso));
    expect(humanizeTimestamps(iso)).not.toContain(iso);
  });

  it('leaves non-timestamp text untouched', () => {
    const text = 'version 1.2.3 shipped on day 2026 of the project';
    expect(humanizeTimestamps(text)).toBe(text);
  });

  it('rewrites multiple timestamps in one string', () => {
    const a = '2026-05-01T12:00:00Z';
    const b = '2026-05-30T12:00:00Z';
    const out = humanizeTimestamps(`from ${a} to ${b}`);
    expect(out).toContain(abs(a));
    expect(out).toContain(abs(b));
    expect(out).not.toContain(a);
  });
});

describe('linkifyRefs', () => {
  it('linkifies a bare /agents ref', () => {
    expect(linkifyRefs('see /agents/foo for details')).toBe('see [/agents/foo](/agents/foo) for details');
  });

  it('linkifies a bare /runs ref', () => {
    expect(linkifyRefs('run /runs/abc-123 failed')).toBe('run [/runs/abc-123](/runs/abc-123) failed');
  });

  it('leaves an existing Markdown link untouched (no double-linking)', () => {
    const md = 'open [the agent](/agents/foo) now';
    expect(linkifyRefs(md)).toBe(md);
  });

  it('does not linkify a ref inside inline code', () => {
    const md = 'the path `/agents/foo` is literal';
    expect(linkifyRefs(md)).toBe(md);
  });

  it('does not match a longer path that merely contains the segment', () => {
    expect(linkifyRefs('/api/agents/foo')).toBe('/api/agents/foo');
  });
});
