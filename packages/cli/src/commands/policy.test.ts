/**
 * `sua policy` end to end: runs the built CLI in a temp project whose data
 * dir holds (or lacks) `.sua/policies.json`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(__dirname, '../../dist/index.js');

function runCli(cwd: string, args: string[]): { out: string; status: number } {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    return { out, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, status: e.status ?? 1 };
  }
}

let cwd: string;
const writePolicy = (content: string) => {
  mkdirSync(join(cwd, 'data', '.sua'), { recursive: true });
  writeFileSync(join(cwd, 'data', '.sua', 'policies.json'), content);
};

beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'sua-policy-cli-')); });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

describe('sua policy', () => {
  it('reports "everything allowed" when there is no file', () => {
    expect(runCli(cwd, ['policy', 'show']).out).toContain('not present');
    const v = runCli(cwd, ['policy', 'validate']);
    expect(v.status).toBe(0);
    expect(v.out).toContain('everything is allowed');
    expect(runCli(cwd, ['policy', 'check', 'shell-exec', 'rm -rf /']).status).toBe(0);
  });

  it('shows rules and answers check with the deciding rule (exit 0 allow, 1 deny)', () => {
    writePolicy(JSON.stringify({ version: 1, rules: [
      { tool: 'http-post', effect: 'deny', conditions: { source: ['community'] }, reason: 'community agents may not POST' },
    ] }));
    const show = runCli(cwd, ['policy', 'show']);
    expect(show.out).toMatch(/#0\s+deny\s+http-post on any resource \[source: community\]/);

    const denied = runCli(cwd, ['policy', 'check', 'http-post', 'https://x', '--source', 'community']);
    expect(denied.status).toBe(1);
    expect(denied.out).toContain('deny   (rule #0) — community agents may not POST');

    const allowed = runCli(cwd, ['policy', 'check', 'http-post', 'https://x', '--source', 'local']);
    expect(allowed.status).toBe(0);
    expect(allowed.out).toContain('allow  (default action)');
  });

  it('flags an invalid file: validate fails, and check reports the fail-closed deny', () => {
    writePolicy('{ nope');
    const v = runCli(cwd, ['policy', 'validate']);
    expect(v.status).toBe(1);
    expect(v.out).toContain('Invalid JSON');
    const c = runCli(cwd, ['policy', 'check', 'json-parse']);
    expect(c.status).toBe(1);
    expect(c.out).toContain('invalid policy file');
  });

  it('rejects an unknown --source', () => {
    expect(runCli(cwd, ['policy', 'check', 'x', '--source', 'bogus']).status).toBe(2);
  });
});
