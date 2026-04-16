import { describe, it, expect } from 'vitest';
import { getBuiltinTool, listBuiltinTools, isBuiltinTool } from './builtin-tools.js';

describe('Builtin tool registry', () => {
  it('lists all 9 built-in tools', () => {
    const tools = listBuiltinTools();
    expect(tools.length).toBe(9);
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual([
      'claude-code', 'file-read', 'file-write', 'http-get', 'http-post',
      'json-parse', 'json-path', 'shell-exec', 'template',
    ]);
  });

  it('retrieves shell-exec by id', () => {
    const entry = getBuiltinTool('shell-exec');
    expect(entry).toBeDefined();
    expect(entry!.definition.source).toBe('builtin');
    expect(entry!.definition.implementation.type).toBe('builtin');
  });

  it('isBuiltinTool returns true for known ids', () => {
    expect(isBuiltinTool('shell-exec')).toBe(true);
    expect(isBuiltinTool('claude-code')).toBe(true);
    expect(isBuiltinTool('http-get')).toBe(true);
  });

  it('isBuiltinTool returns false for unknown ids', () => {
    expect(isBuiltinTool('not-a-tool')).toBe(false);
  });

  it('shell-exec executes a simple command', async () => {
    const entry = getBuiltinTool('shell-exec')!;
    const result = await entry.execute({ command: 'echo hello-tools' }, {});
    expect(result.stdout).toContain('hello-tools');
    expect(result.exit_code).toBe(0);
    expect(result.result).toContain('hello-tools');
  });

  it('json-parse parses valid JSON', async () => {
    const entry = getBuiltinTool('json-parse')!;
    const result = await entry.execute({ text: '{"a":1}' }, {});
    expect(result.value).toEqual({ a: 1 });
    expect(result.result).toBe('{"a":1}');
  });

  it('json-path extracts a nested value', async () => {
    const entry = getBuiltinTool('json-path')!;
    const result = await entry.execute({
      data: { items: [{ title: 'hello' }] },
      path: 'items.0.title',
    }, {});
    expect(result.value).toBe('hello');
    expect(result.result).toBe('hello');
  });

  it('template returns the text as-is', async () => {
    const entry = getBuiltinTool('template')!;
    const result = await entry.execute({ text: 'Hello {{name}}' }, {});
    expect(result.result).toBe('Hello {{name}}');
  });

  it('file-read reads a file', async () => {
    const entry = getBuiltinTool('file-read')!;
    const result = await entry.execute({ path: 'package.json' }, {});
    expect(result.content).toContain('some-useful-agents');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('http-get fetches a URL (skipped without network)', async () => {
    // This test validates the function shape; real HTTP is tested in
    // integration. We just check it doesn't throw on construction.
    const entry = getBuiltinTool('http-get')!;
    expect(entry.definition.inputs.url.required).toBe(true);
    expect(entry.definition.outputs.status.type).toBe('number');
  });
});
