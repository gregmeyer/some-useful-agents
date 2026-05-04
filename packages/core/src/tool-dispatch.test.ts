import { describe, it, expect } from 'vitest';
import { resolveToolId, resolveToolInputs } from './tool-dispatch.js';
import type { AgentNode } from './agent-v2-types.js';

function node(overrides: Partial<AgentNode>): AgentNode {
  return { id: 'x', type: 'shell', ...overrides } as AgentNode;
}

describe('resolveToolId', () => {
  it('returns explicit tool: when set', () => {
    expect(resolveToolId(node({ tool: 'http-get' }))).toBe('http-get');
  });

  it('desugars type: file-write to the file-write tool', () => {
    expect(resolveToolId(node({ type: 'file-write' }))).toBe('file-write');
  });

  it('returns undefined for plain shell/claude-code (legacy spawn path)', () => {
    expect(resolveToolId(node({ type: 'shell', command: 'echo' }))).toBeUndefined();
    expect(resolveToolId(node({ type: 'claude-code', prompt: 'hi' }))).toBeUndefined();
  });

  it('returns undefined for control-flow node types', () => {
    expect(resolveToolId(node({ type: 'conditional' }))).toBeUndefined();
    expect(resolveToolId(node({ type: 'branch' }))).toBeUndefined();
  });

  it('explicit tool: wins over file-write desugaring', () => {
    // edge case: someone sets both type: file-write AND tool: my-custom
    expect(resolveToolId(node({ type: 'file-write', tool: 'custom-writer' }))).toBe('custom-writer');
  });
});

describe('resolveToolInputs', () => {
  it('passes through toolInputs when set', () => {
    expect(resolveToolInputs(node({ toolInputs: { url: 'https://x.com' } }), {}))
      .toEqual({ url: 'https://x.com' });
  });

  it('folds shell command into toolInputs.command', () => {
    expect(resolveToolInputs(node({ type: 'shell', command: 'echo hi' }), {}))
      .toEqual({ command: 'echo hi' });
  });

  it('folds claude-code fields into toolInputs', () => {
    expect(resolveToolInputs(node({
      type: 'claude-code', prompt: 'p', model: 'm', maxTurns: 3, allowedTools: ['x'],
    }), {})).toEqual({ prompt: 'p', model: 'm', maxTurns: 3, allowedTools: ['x'] });
  });

  it('desugars file-write top-level path/content/append', () => {
    expect(resolveToolInputs(node({
      type: 'file-write', path: 'out.md', content: 'hi', append: true,
    }), {})).toEqual({ path: 'out.md', content: 'hi', append: true });
  });

  it('omits append when not specified on file-write', () => {
    expect(resolveToolInputs(node({
      type: 'file-write', path: 'out.md', content: 'hi',
    }), {})).toEqual({ path: 'out.md', content: 'hi' });
  });
});
