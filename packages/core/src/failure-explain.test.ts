import { describe, it, expect } from 'vitest';
import {
  explainNodeFailure,
  formatErrorCategory,
  formatExitCode,
  ERROR_CATEGORY_LABELS,
} from './failure-explain.js';

// Keep in sync with NodeErrorCategory in agent-v2-types.ts. The exhaustiveness
// test below fails loudly if a new category is added without a label.
const NODE_ERROR_CATEGORIES = [
  'setup',
  'input_resolution',
  'spawn_failure',
  'exit_nonzero',
  'timeout',
  'cancelled',
  'abandoned',
  'upstream_failed',
  'condition_not_met',
  'flow_ended',
  'invalid_output',
  'policy_denied',
] as const;

describe('formatExitCode', () => {
  it('labels known codes', () => {
    expect(formatExitCode(127)).toBe('exit 127 (command not found)');
    expect(formatExitCode(126)).toBe('exit 126 (permission denied)');
    expect(formatExitCode(137)).toBe('exit 137 (killed (SIGKILL / out of memory))');
  });
  it('expands the signal range', () => {
    expect(formatExitCode(131)).toBe('exit 131 (signal 3)');
  });
  it('renders a bare unknown code without a parenthetical', () => {
    expect(formatExitCode(42)).toBe('exit 42');
  });
  it('renders nothing for a null/undefined code', () => {
    expect(formatExitCode(null)).toBe('');
    expect(formatExitCode(undefined)).toBe('');
  });
});

describe('formatErrorCategory', () => {
  it('maps every NodeErrorCategory to a non-raw label', () => {
    for (const cat of NODE_ERROR_CATEGORIES) {
      expect(ERROR_CATEGORY_LABELS[cat], `missing label for ${cat}`).toBeTruthy();
      expect(formatErrorCategory(cat)).not.toBe(cat);
    }
  });
  it('falls back to the raw code for unknown categories', () => {
    expect(formatErrorCategory('binary_missing')).toBe('binary_missing');
  });
});

describe('explainNodeFailure', () => {
  it('explains exit_nonzero with code, meaning, and stderr tail', () => {
    expect(
      explainNodeFailure({
        nodeId: 'fetch',
        category: 'exit_nonzero',
        exitCode: 127,
        error: 'running command\nnonexistent-cmd-xyz: command not found',
      }),
    ).toBe('Node "fetch" exited with code 127 (command not found): nonexistent-cmd-xyz: command not found');
  });

  it('explains a bare exit code with no known meaning', () => {
    expect(explainNodeFailure({ nodeId: 'step', category: 'exit_nonzero', exitCode: 3 }))
      .toBe('Node "step" exited with code 3 (cannot execute (curl: URL malformed))');
    expect(explainNodeFailure({ nodeId: 'step', category: 'exit_nonzero', exitCode: 42 }))
      .toBe('Node "step" exited with code 42');
  });

  it('skips the synthetic "Process exited with code N" fallback as a tail', () => {
    expect(
      explainNodeFailure({ nodeId: 'x', category: 'exit_nonzero', exitCode: 1, error: 'Process exited with code 1' }),
    ).toBe('Node "x" exited with code 1 (general error)');
  });

  it('handles exit_nonzero with no exit code', () => {
    expect(explainNodeFailure({ nodeId: 'x', category: 'exit_nonzero' }))
      .toBe('Node "x" exited with a non-zero code');
  });

  it('explains timeout and spawn_failure', () => {
    expect(explainNodeFailure({ nodeId: 'slow', category: 'timeout' })).toBe('Node "slow" timed out');
    expect(explainNodeFailure({ nodeId: 'run', category: 'spawn_failure' }))
      .toBe('Node "run" could not start (missing binary or command not found)');
  });

  it('uses the prose label for other categories, prefixed with the node', () => {
    expect(explainNodeFailure({ nodeId: 'plan', category: 'invalid_output' }))
      .toBe('Node "plan": Output failed the task contract');
    expect(explainNodeFailure({ nodeId: 'gate', category: 'policy_denied' }))
      .toBe('Node "gate": Blocked by tool policy');
  });

  it('drops the Node prefix at run level (no nodeId)', () => {
    expect(explainNodeFailure({ category: 'exit_nonzero', exitCode: 1 }))
      .toBe('exited with code 1 (general error)');
    expect(explainNodeFailure({ category: 'invalid_output' })).toBe('Output failed the task contract');
  });

  it('truncates a very long stderr tail', () => {
    const long = 'e'.repeat(300);
    const out = explainNodeFailure({ nodeId: 'x', category: 'exit_nonzero', exitCode: 1, error: long });
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });
});
