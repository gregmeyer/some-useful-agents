/**
 * Apple Foundation Models runner bootstrap tests.
 *
 * Coverage:
 *   - Non-macOS hosts return `unsupported` without raising.
 *   - On macOS with xcrun (real-CLI gated), `ensureAppleRunner` produces
 *     a binary at the cache path and reports `ready` on cache hit.
 *
 * Tests gate on `process.platform === 'darwin'` AND `xcrun` being on
 * PATH — same fixture pattern as `llm-invoker.test.ts` so hosts without
 * Xcode tools skip cleanly instead of hard-failing CI.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  APPLE_RUNNER_SWIFT_SOURCE,
  appleRunnerBinaryPath,
  appleRunnerVersionString,
  appleRunnersDir,
  ensureAppleRunner,
} from './apple-foundationmodels-runner.js';

function xcrunAvailable(): boolean {
  try {
    execFileSync('xcrun', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

describe('appleRunnersDir / appleRunnerBinaryPath', () => {
  it('honors SUA_APPLE_RUNNERS_DIR override', () => {
    const prev = process.env.SUA_APPLE_RUNNERS_DIR;
    process.env.SUA_APPLE_RUNNERS_DIR = '/tmp/sua-runners-test';
    try {
      expect(appleRunnersDir()).toBe('/tmp/sua-runners-test');
      expect(appleRunnerBinaryPath()).toBe('/tmp/sua-runners-test/apple_foundationmodels');
    } finally {
      if (prev === undefined) delete process.env.SUA_APPLE_RUNNERS_DIR;
      else process.env.SUA_APPLE_RUNNERS_DIR = prev;
    }
  });

  it('exports a stable version string', () => {
    expect(appleRunnerVersionString()).toMatch(/^apple-foundationmodels-runner /);
  });

  it('embeds the canImport(FoundationModels) guard', () => {
    expect(APPLE_RUNNER_SWIFT_SOURCE).toContain('canImport(FoundationModels)');
    expect(APPLE_RUNNER_SWIFT_SOURCE).toContain('--version');
  });
});

describe('ensureAppleRunner (non-macOS branch)', () => {
  it('returns status=unsupported on non-macOS', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const handle = ensureAppleRunner();
      expect(handle.status).toBe('unsupported');
      expect(handle.message).toMatch(/macOS-only/);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});

describe('ensureAppleRunner (real compile, macOS-gated)', () => {
  let tmpDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sua-apple-runner-'));
    prevEnv = process.env.SUA_APPLE_RUNNERS_DIR;
    process.env.SUA_APPLE_RUNNERS_DIR = tmpDir;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.SUA_APPLE_RUNNERS_DIR;
    else process.env.SUA_APPLE_RUNNERS_DIR = prevEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'darwin' || !xcrunAvailable())(
    'compiles the runner on first call and reports cache hit on the second',
    () => {
      const first = ensureAppleRunner();
      expect(first.status).toBe('ready');
      expect(first.binaryPath).toBe(join(tmpDir, 'apple_foundationmodels'));
      // Binary should exist + be executable on disk.
      const stat = statSync(first.binaryPath);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(0);

      // Probe the runner's --version branch to confirm we built the
      // right Swift source (vs. a foreign binary at the path).
      const versionOut = execFileSync(first.binaryPath, ['--version'], { encoding: 'utf-8' }).trim();
      expect(versionOut).toBe(appleRunnerVersionString());

      // Second call hits the source-hash cache; status still ready,
      // binary unchanged.
      const second = ensureAppleRunner();
      expect(second.status).toBe('ready');
      expect(second.binaryPath).toBe(first.binaryPath);
    },
    60_000,
  );

  it.skipIf(process.platform !== 'darwin' || !xcrunAvailable())(
    'recompiles when the cached source hash drifts',
    () => {
      const first = ensureAppleRunner();
      expect(first.status).toBe('ready');

      // Corrupt the sidecar hash so the next call sees a mismatch.
      const hashPath = join(tmpDir, 'apple_foundationmodels.source-hash');
      writeFileSync(hashPath, 'deadbeef', 'utf-8');

      const second = ensureAppleRunner();
      expect(second.status).toBe('ready');
      // After recompile the hash should be back to the real value (≠ deadbeef).
      // Recreating exactly is harder to assert without rehashing, but we
      // can confirm the file changed back from the corrupted marker.
      const after = execFileSync('cat', [hashPath], { encoding: 'utf-8' }).trim();
      expect(after).not.toBe('deadbeef');
      expect(after.length).toBe(64); // sha256 hex
    },
    60_000,
  );
});
