import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { ensureMcpToken, readMcpToken, rotateMcpToken } from './mcp-token.js';

describe('mcp-token', () => {
  let dir: string;
  let tokenPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-mcp-token-'));
    tokenPath = join(dir, 'mcp-token');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('readMcpToken returns undefined when no file exists', () => {
    expect(readMcpToken(tokenPath)).toBeUndefined();
  });

  it('ensureMcpToken creates a 64-hex-char token on first call', () => {
    const { token, created } = ensureMcpToken(tokenPath);
    expect(created).toBe(true);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(tokenPath)).toBe(true);
    // File contents trimmed equal the returned token
    expect(readFileSync(tokenPath, 'utf-8').trim()).toBe(token);
  });

  it('ensureMcpToken is idempotent on warm runs', () => {
    const first = ensureMcpToken(tokenPath);
    const second = ensureMcpToken(tokenPath);
    expect(first.token).toBe(second.token);
    expect(second.created).toBe(false);
  });

  it('readMcpToken returns the same token written by ensureMcpToken', () => {
    const { token } = ensureMcpToken(tokenPath);
    expect(readMcpToken(tokenPath)).toBe(token);
  });

  it('rotateMcpToken replaces the token with a fresh one', () => {
    const { token: original } = ensureMcpToken(tokenPath);
    const rotated = rotateMcpToken(tokenPath);
    expect(rotated).not.toBe(original);
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(readMcpToken(tokenPath)).toBe(rotated);
  });

  it.skipIf(platform() === 'win32')('writes the token file with mode 0o600', () => {
    ensureMcpToken(tokenPath);
    const mode = statSync(tokenPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
