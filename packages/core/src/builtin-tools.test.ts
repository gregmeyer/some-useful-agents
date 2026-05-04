import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBuiltinTool, listBuiltinTools, isBuiltinTool, assertSafeUrl } from './builtin-tools.js';

describe('Builtin tool registry', () => {
  it('lists all 10 built-in tools', () => {
    const tools = listBuiltinTools();
    expect(tools.length).toBe(10);
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual([
      'claude-code', 'csv-to-chart-json', 'file-read', 'file-write', 'http-get',
      'http-post', 'json-parse', 'json-path', 'shell-exec', 'template',
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

  describe('file-write', () => {
    let tmp: string;
    beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sua-fw-')); });
    afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

    it('writes content to a file (overwrite default)', async () => {
      const entry = getBuiltinTool('file-write')!;
      const result = await entry.execute(
        { path: 'out.txt', content: 'hello' },
        { workingDirectory: tmp },
      );
      expect(result.bytes).toBe(5);
      expect(result.append).toBe(false);
      expect(readFileSync(join(tmp, 'out.txt'), 'utf-8')).toBe('hello');
    });

    it('overwrites by default on second write', async () => {
      const entry = getBuiltinTool('file-write')!;
      await entry.execute({ path: 'out.txt', content: 'first' }, { workingDirectory: tmp });
      await entry.execute({ path: 'out.txt', content: 'second' }, { workingDirectory: tmp });
      expect(readFileSync(join(tmp, 'out.txt'), 'utf-8')).toBe('second');
    });

    it('appends when append: true', async () => {
      const entry = getBuiltinTool('file-write')!;
      await entry.execute({ path: 'log.txt', content: 'one\n' }, { workingDirectory: tmp });
      const result = await entry.execute(
        { path: 'log.txt', content: 'two\n', append: true },
        { workingDirectory: tmp },
      );
      expect(result.append).toBe(true);
      expect(readFileSync(join(tmp, 'log.txt'), 'utf-8')).toBe('one\ntwo\n');
    });

    it('refuses paths that escape the working directory', async () => {
      const entry = getBuiltinTool('file-write')!;
      await expect(
        entry.execute({ path: '../escape.txt', content: 'x' }, { workingDirectory: tmp }),
      ).rejects.toThrow(/escapes the working directory/);
    });
  });

  it('http-get fetches a URL (skipped without network)', async () => {
    // This test validates the function shape; real HTTP is tested in
    // integration. We just check it doesn't throw on construction.
    const entry = getBuiltinTool('http-get')!;
    expect(entry.definition.inputs.url.required).toBe(true);
    expect(entry.definition.outputs.status.type).toBe('number');
  });
});

describe('assertSafeUrl (SSRF guard)', () => {
  it('rejects non-HTTP schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow('Blocked URL scheme');
    await expect(assertSafeUrl('ftp://example.com')).rejects.toThrow('Blocked URL scheme');
  });

  it('rejects invalid URLs', async () => {
    await expect(assertSafeUrl('not-a-url')).rejects.toThrow('Invalid URL');
  });

  it('rejects loopback addresses', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/secret')).rejects.toThrow('private/reserved');
    await expect(assertSafeUrl('http://127.0.0.2:8080')).rejects.toThrow('private/reserved');
  });

  it('rejects RFC 1918 private ranges', async () => {
    await expect(assertSafeUrl('http://10.0.0.1/')).rejects.toThrow('private/reserved');
    await expect(assertSafeUrl('http://192.168.1.1/')).rejects.toThrow('private/reserved');
    await expect(assertSafeUrl('http://172.16.0.1/')).rejects.toThrow('private/reserved');
    await expect(assertSafeUrl('http://172.31.255.255/')).rejects.toThrow('private/reserved');
  });

  it('rejects link-local / cloud metadata (169.254.x.x)', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('private/reserved');
  });

  it('rejects 0.0.0.0', async () => {
    await expect(assertSafeUrl('http://0.0.0.0/')).rejects.toThrow('private/reserved');
  });

  it('allows public URLs (dns must resolve)', async () => {
    // example.com is IANA-reserved and resolves to a public IP
    await expect(assertSafeUrl('https://example.com')).resolves.toBeUndefined();
  });

  it('rejects localhost by name', async () => {
    await expect(assertSafeUrl('http://localhost:3000')).rejects.toThrow('private/reserved');
  });
});

describe('csv-to-chart-json', () => {
  const run = async (inputs: Record<string, unknown>) => {
    const tool = getBuiltinTool('csv-to-chart-json')!;
    return tool.execute(inputs, {});
  };

  it('parses simple shape (labels + values)', async () => {
    const out = await run({
      csv: 'month,revenue\nJan,100\nFeb,150\nMar,180',
      shape: 'simple',
    });
    expect(out.labels).toEqual(['Jan', 'Feb', 'Mar']);
    expect(out.values).toEqual([100, 150, 180]);
    expect(JSON.parse(String(out.data_json))).toEqual({ labels: ['Jan', 'Feb', 'Mar'], values: [100, 150, 180] });
  });

  it('parses series shape (labels + named series)', async () => {
    const out = await run({
      csv: 'quarter,org,paid\nQ1,10,5\nQ2,20,8\nQ3,35,14',
      shape: 'series',
    });
    expect(out.labels).toEqual(['Q1', 'Q2', 'Q3']);
    expect(out.series).toEqual([
      { name: 'org', values: [10, 20, 35] },
      { name: 'paid', values: [5, 8, 14] },
    ]);
  });

  it('parses cohort shape', async () => {
    const out = await run({
      csv: 'date,size,m1,m2\nSep 17,7262,95.6,33.5\nOct 17,8100,94.2,31.0',
      shape: 'cohort',
    });
    expect(out.cohorts).toEqual([
      { date: 'Sep 17', size: 7262, values: [95.6, 33.5] },
      { date: 'Oct 17', size: 8100, values: [94.2, 31.0] },
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', async () => {
    const out = await run({
      csv: 'label,value\n"Jones, Inc.",42\n"Smith ""Co""",7',
      shape: 'simple',
    });
    expect(out.labels).toEqual(['Jones, Inc.', 'Smith "Co"']);
    expect(out.values).toEqual([42, 7]);
  });

  it('throws on non-numeric values', async () => {
    await expect(run({
      csv: 'label,value\nA,not-a-number',
      shape: 'simple',
    })).rejects.toThrow(/not a number/);
  });

  it('throws on empty input', async () => {
    await expect(run({ csv: '', shape: 'simple' })).rejects.toThrow(/non-empty/);
  });

  it('throws on unknown shape', async () => {
    await expect(run({ csv: 'a,b\n1,2', shape: 'bogus' })).rejects.toThrow(/unknown shape/);
  });
});
