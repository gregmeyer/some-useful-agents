import { describe, it, expect } from 'vitest';
import { resolveExecutionOrder, resolveTemplate, CycleError, MissingDependencyError } from './chain-resolver.js';
import type { AgentDefinition } from './types.js';

function agent(name: string, deps?: string[]): AgentDefinition {
  return { name, type: 'shell', command: `echo ${name}`, dependsOn: deps };
}

describe('resolveExecutionOrder', () => {
  it('returns single agent with no dependencies', () => {
    const agents = new Map([['a', agent('a')]]);
    const order = resolveExecutionOrder(agents);
    expect(order.map(a => a.name)).toEqual(['a']);
  });

  it('resolves linear dependency chain', () => {
    const agents = new Map([
      ['c', agent('c', ['b'])],
      ['b', agent('b', ['a'])],
      ['a', agent('a')],
    ]);
    const order = resolveExecutionOrder(agents);
    const names = order.map(a => a.name);
    expect(names.indexOf('a')).toBeLessThan(names.indexOf('b'));
    expect(names.indexOf('b')).toBeLessThan(names.indexOf('c'));
  });

  it('resolves diamond dependency', () => {
    const agents = new Map([
      ['d', agent('d', ['b', 'c'])],
      ['b', agent('b', ['a'])],
      ['c', agent('c', ['a'])],
      ['a', agent('a')],
    ]);
    const order = resolveExecutionOrder(agents);
    const names = order.map(a => a.name);
    expect(names.indexOf('a')).toBeLessThan(names.indexOf('b'));
    expect(names.indexOf('a')).toBeLessThan(names.indexOf('c'));
    expect(names.indexOf('b')).toBeLessThan(names.indexOf('d'));
    expect(names.indexOf('c')).toBeLessThan(names.indexOf('d'));
  });

  it('throws CycleError on circular dependency', () => {
    const agents = new Map([
      ['a', agent('a', ['b'])],
      ['b', agent('b', ['a'])],
    ]);
    expect(() => resolveExecutionOrder(agents)).toThrow(CycleError);
  });

  it('throws CycleError on self-reference', () => {
    const agents = new Map([['a', agent('a', ['a'])]]);
    expect(() => resolveExecutionOrder(agents)).toThrow(CycleError);
  });

  it('throws MissingDependencyError for nonexistent dependency', () => {
    const agents = new Map([['a', agent('a', ['missing'])]]);
    expect(() => resolveExecutionOrder(agents)).toThrow(MissingDependencyError);
  });

  it('handles agents with no dependsOn field', () => {
    const agents = new Map([
      ['a', { name: 'a', type: 'shell' as const, command: 'echo a' }],
      ['b', { name: 'b', type: 'shell' as const, command: 'echo b' }],
    ]);
    const order = resolveExecutionOrder(agents);
    expect(order.length).toBe(2);
  });
});

describe('resolveTemplate', () => {
  it('resolves result template', () => {
    const outputs = new Map([['fetch', { result: 'hello', exitCode: 0 }]]);
    expect(resolveTemplate('got: {{outputs.fetch.result}}', outputs)).toBe('got: hello');
  });

  it('resolves exitCode template', () => {
    const outputs = new Map([['fetch', { result: '', exitCode: 42 }]]);
    expect(resolveTemplate('code: {{outputs.fetch.exitCode}}', outputs)).toBe('code: 42');
  });

  it('resolves multiple templates', () => {
    const outputs = new Map([
      ['a', { result: 'foo', exitCode: 0 }],
      ['b', { result: 'bar', exitCode: 0 }],
    ]);
    expect(resolveTemplate('{{outputs.a.result}} and {{outputs.b.result}}', outputs)).toBe('foo and bar');
  });

  it('returns empty string for missing agent output', () => {
    const outputs = new Map<string, { result: string; exitCode: number }>();
    expect(resolveTemplate('got: {{outputs.missing.result}}', outputs)).toBe('got: ');
  });

  it('passes through non-template text', () => {
    const outputs = new Map<string, { result: string; exitCode: number }>();
    expect(resolveTemplate('plain text', outputs)).toBe('plain text');
  });
});
