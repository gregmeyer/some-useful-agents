import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLlms, invokeLlm } from './llm-invoker.js';

// Every case runs against stand-in `claude` / `codex` scripts on PATH, never
// the real CLIs: a test must not spend a model call (or wait on one) just
// because the machine it runs on has them installed.
let bin: string;
let savedPath: string | undefined;

function fake(name: string, body: string): void {
  const p = join(bin, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), 'sua-llm-invoker-'));
  savedPath = process.env.PATH;
  // Only the stand-ins and the basics they need (sh, sleep).
  process.env.PATH = `${bin}:/bin:/usr/bin`;
});

afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(bin, { recursive: true, force: true });
});

describe('detectLlms', () => {
  it('returns a structure with both provider slots', () => {
    const avail = detectLlms();
    expect(avail).toHaveProperty('claude');
    expect(avail).toHaveProperty('codex');
    expect(avail.claude).toHaveProperty('installed');
    expect(avail.codex).toHaveProperty('installed');
  });
});

describe('invokeLlm', () => {
  it('returns what the CLI printed and its exit code', async () => {
    fake('claude', 'echo "answer to: $*"');
    const result = await invokeLlm({ provider: 'claude', prompt: 'test', timeoutMs: 5000 });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('answer to:');
    expect(result.output).toContain('test');
    expect(result.error).toBeUndefined();
  });

  it('returns exit code 127 with a clear message when the CLI is missing', async () => {
    const result = await invokeLlm({ provider: 'claude', prompt: 'test', timeoutMs: 1000 });
    expect(result.exitCode).toBe(127);
    expect(result.error).toMatch(/not found on PATH/);
  });

  it('respects the timeout option', async () => {
    fake('codex', 'exec sleep 30');
    const start = Date.now();
    const result = await invokeLlm({ provider: 'codex', prompt: 'hang forever please', timeoutMs: 500 });
    expect(result.exitCode).toBe(124);
    expect(result.error).toMatch(/timed out/);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
