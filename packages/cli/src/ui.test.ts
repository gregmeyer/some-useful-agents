import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SYMBOLS,
  STATUS_COLORS,
  colorStatus,
  ok,
  fail,
  warn,
  info,
  step,
  section,
  banner,
  outputFrame,
  kv,
  agent,
  cmd,
  dim,
  id,
} from './ui.js';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function lastStdout(): string {
  const calls = stdoutSpy.mock.calls;
  return calls.length > 0 ? String(calls[calls.length - 1][0]) : '';
}

function lastStderr(): string {
  const calls = stderrSpy.mock.calls;
  return calls.length > 0 ? String(calls[calls.length - 1][0]) : '';
}

describe('SYMBOLS', () => {
  it('exposes the five symbols used across the CLI', () => {
    expect(SYMBOLS.ok).toBe('✅');
    expect(SYMBOLS.fail).toBe('❌');
    expect(SYMBOLS.warn.trim()).toBe('⚠️');
    expect(SYMBOLS.info).toBe('💡');
    expect(SYMBOLS.step).toBe('🚀');
  });
});

describe('STATUS_COLORS + colorStatus', () => {
  it('covers every RunStatus value', () => {
    expect(STATUS_COLORS.completed).toBeTypeOf('function');
    expect(STATUS_COLORS.running).toBeTypeOf('function');
    expect(STATUS_COLORS.pending).toBeTypeOf('function');
    expect(STATUS_COLORS.failed).toBeTypeOf('function');
    expect(STATUS_COLORS.cancelled).toBeTypeOf('function');
  });

  it('colorStatus returns a wrapped string for known statuses', () => {
    const out = colorStatus('completed');
    // The wrapped string contains the literal status text somewhere.
    expect(out).toMatch(/completed/);
  });
});

describe('line-level helpers', () => {
  it('ok writes to stdout with the ✅ symbol and the message', () => {
    ok('file created');
    const line = lastStdout();
    expect(line).toContain(SYMBOLS.ok);
    expect(line).toContain('file created');
  });

  it('fail writes to stderr with the ❌ symbol', () => {
    fail('boom');
    const line = lastStderr();
    expect(line).toContain(SYMBOLS.fail);
    expect(line).toContain('boom');
    // and nothing was printed on stdout
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('warn writes to stderr with ⚠️', () => {
    warn('take note');
    const line = lastStderr();
    expect(line).toContain('⚠️');
    expect(line).toContain('take note');
  });

  it('info writes to stdout with 💡', () => {
    info('psst');
    const line = lastStdout();
    expect(line).toContain(SYMBOLS.info);
    expect(line).toContain('psst');
  });

  it('step prints a padded command + optional description', () => {
    step('sua agent run hello', 'run it once');
    const line = lastStdout();
    expect(line).toContain(SYMBOLS.step);
    expect(line).toContain('sua agent run hello');
    expect(line).toContain('run it once');
  });

  it('step works with no description', () => {
    step('sua doctor');
    const line = lastStdout();
    expect(line).toContain('sua doctor');
    expect(line).toContain(SYMBOLS.step);
  });
});

describe('structural helpers', () => {
  it('section prints a title with blank lines around', () => {
    section('Next steps');
    // three log calls: blank, title, blank
    const calls = stdoutSpy.mock.calls.map(c => String(c[0] ?? ''));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.some(l => l.includes('Next steps'))).toBe(true);
  });

  it('banner prints a boxed multi-line region containing the title', () => {
    banner('MCP server', ['Host: 127.0.0.1', 'Port: 3003']);
    const line = lastStdout();
    expect(line).toContain('MCP server');
    expect(line).toContain('Host: 127.0.0.1');
    expect(line).toContain('Port: 3003');
    // boxen uses round border characters
    expect(line).toMatch(/[╭╮╰╯─│]/);
  });

  it('banner works with just a title and no body', () => {
    banner('Scheduler');
    const line = lastStdout();
    expect(line).toContain('Scheduler');
  });

  it('outputFrame wraps body lines with frame characters', () => {
    outputFrame('hello\nworld');
    const calls = stdoutSpy.mock.calls.map(c => String(c[0] ?? ''));
    const joined = calls.join('\n');
    expect(joined).toContain('output');
    expect(joined).toContain('hello');
    expect(joined).toContain('world');
    expect(joined).toMatch(/[╭╰│]/);
  });

  it('outputFrame prints "(no output)" for empty input', () => {
    outputFrame('');
    const line = lastStdout();
    expect(line).toContain('(no output)');
  });

  it('outputFrame prints "(no output)" for whitespace-only input', () => {
    outputFrame('   \n\n  ');
    const line = lastStdout();
    expect(line).toContain('(no output)');
  });

  it('kv prints label padded to column and value', () => {
    kv('description', 'my agent');
    const line = lastStdout();
    expect(line).toContain('description');
    expect(line).toContain('my agent');
  });
});

describe('inline helpers', () => {
  it('agent wraps a name (non-empty output)', () => {
    const out = agent('my-agent');
    expect(out).toContain('my-agent');
  });

  it('cmd wraps a command (non-empty output)', () => {
    const out = cmd('sua tutorial');
    expect(out).toContain('sua tutorial');
  });

  it('dim wraps text', () => {
    const out = dim('quiet');
    expect(out).toContain('quiet');
  });

  it('id wraps a short reference', () => {
    const out = id('abc12345');
    expect(out).toContain('abc12345');
  });
});
