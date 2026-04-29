import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALL_SERVICES,
  daemonPaths,
  ensureDaemonDirs,
  getServiceStatus,
  isProcessAlive,
  readServicePid,
  rotateLog,
  spawnService,
  stopService,
  waitForServiceSettle,
} from './daemon-supervisor.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sua-daemon-test-'));
});

afterEach(() => {
  // Best-effort cleanup; ignore if any spawned subprocess holds files.
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('daemonPaths', () => {
  it('places pid + logs under <dataDir>/daemon', () => {
    const paths = daemonPaths(dataDir);
    expect(paths.baseDir).toBe(join(dataDir, 'daemon'));
    expect(paths.logsDir).toBe(join(dataDir, 'daemon', 'logs'));
    expect(paths.pidPath('schedule')).toBe(join(dataDir, 'daemon', 'schedule.pid'));
    expect(paths.logPath('mcp')).toBe(join(dataDir, 'daemon', 'logs', 'mcp.log'));
  });

  it('exposes the canonical service list', () => {
    expect(ALL_SERVICES).toEqual(['schedule', 'dashboard', 'mcp']);
  });
});

describe('ensureDaemonDirs', () => {
  it('creates baseDir and logsDir', () => {
    const paths = ensureDaemonDirs(dataDir);
    expect(existsSync(paths.baseDir)).toBe(true);
    expect(existsSync(paths.logsDir)).toBe(true);
  });
});

describe('readServicePid', () => {
  it('returns null when no pid file exists', () => {
    expect(readServicePid(dataDir, 'schedule')).toBeNull();
  });

  it('reads a recorded pid', () => {
    const paths = ensureDaemonDirs(dataDir);
    writeFileSync(paths.pidPath('schedule'), '12345\n');
    expect(readServicePid(dataDir, 'schedule')).toBe(12345);
  });

  it('returns null for malformed pid files', () => {
    const paths = ensureDaemonDirs(dataDir);
    writeFileSync(paths.pidPath('schedule'), 'not-a-pid\n');
    expect(readServicePid(dataDir, 'schedule')).toBeNull();
  });
});

describe('isProcessAlive', () => {
  it('reports the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('reports a clearly dead pid as dead', () => {
    // Pick a high pid extremely unlikely to be live in test environments.
    expect(isProcessAlive(99999999)).toBe(false);
  });
});

describe('rotateLog', () => {
  it('does nothing when the log is below cap', () => {
    const paths = ensureDaemonDirs(dataDir);
    const log = paths.logPath('mcp');
    writeFileSync(log, 'small');
    rotateLog(log, 1024);
    expect(existsSync(log)).toBe(true);
    expect(existsSync(`${log}.1`)).toBe(false);
  });

  it('rotates when over cap', () => {
    const paths = ensureDaemonDirs(dataDir);
    const log = paths.logPath('mcp');
    writeFileSync(log, 'x'.repeat(2048));
    rotateLog(log, 1024);
    expect(existsSync(log)).toBe(false);
    expect(existsSync(`${log}.1`)).toBe(true);
    expect(statSync(`${log}.1`).size).toBe(2048);
  });

  it('drops a prior rotated copy on subsequent rotation', () => {
    const paths = ensureDaemonDirs(dataDir);
    const log = paths.logPath('mcp');
    writeFileSync(`${log}.1`, 'old');
    writeFileSync(log, 'x'.repeat(2048));
    rotateLog(log, 1024);
    expect(readFileSync(`${log}.1`, 'utf-8').length).toBe(2048);
  });

  it('is a no-op when the log does not exist', () => {
    const paths = daemonPaths(dataDir);
    expect(() => rotateLog(paths.logPath('mcp'), 1024)).not.toThrow();
  });
});

describe('getServiceStatus', () => {
  it('returns stopped when no pid file exists', () => {
    const status = getServiceStatus(dataDir, 'schedule');
    expect(status.state).toBe('stopped');
    expect(status.pid).toBeUndefined();
  });

  it('returns running when the pid is alive (using current process pid)', () => {
    const paths = ensureDaemonDirs(dataDir);
    writeFileSync(paths.pidPath('schedule'), `${process.pid}\n`);
    const status = getServiceStatus(dataDir, 'schedule');
    expect(status.state).toBe('running');
    expect(status.pid).toBe(process.pid);
  });

  it('returns stale when the recorded pid is dead', () => {
    const paths = ensureDaemonDirs(dataDir);
    writeFileSync(paths.pidPath('schedule'), '99999999\n');
    const status = getServiceStatus(dataDir, 'schedule');
    expect(status.state).toBe('stale');
  });
});

describe('spawnService + stopService', () => {
  it('spawns a detached child, records its pid, and stops it cleanly', async () => {
    // Spawn `node -e "..."` masquerading as a service. We bypass SERVICE_ARGV
    // by substituting suaBin with a script path, and then post-write the pid
    // ourselves to test stop semantics. Since spawnService re-executes `sua`,
    // we use a different tactic: directly verify the lifecycle via a fake
    // pid that we know is alive (current process), then via stopService.
    const paths = ensureDaemonDirs(dataDir);
    // Simulate "service running" by writing the test pid (the test process
    // itself). stopService will refuse to actually kill it (we'd kill the
    // test runner!), so we use a child-spawned `sleep` instead.
    const { spawn } = await import('node:child_process');
    const child = spawn('node', ['-e', 'setTimeout(() => {}, 60000)'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    expect(typeof child.pid).toBe('number');
    writeFileSync(paths.pidPath('schedule'), `${child.pid}\n`);

    expect(getServiceStatus(dataDir, 'schedule').state).toBe('running');

    const result = stopService(dataDir, 'schedule');
    expect(result.signalled).toBe(true);
    expect(result.pid).toBe(child.pid);
    expect(existsSync(paths.pidPath('schedule'))).toBe(false);

    // Wait briefly for the SIGTERM to take effect.
    await new Promise((r) => setTimeout(r, 100));
    expect(isProcessAlive(child.pid!)).toBe(false);
  });

  it('waitForServiceSettle returns running when the recorded pid stays alive', async () => {
    const paths = ensureDaemonDirs(dataDir);
    writeFileSync(paths.pidPath('schedule'), `${process.pid}\n`);
    const status = await waitForServiceSettle(dataDir, 'schedule', 50);
    expect(status.state).toBe('running');
  });

  it('waitForServiceSettle reports stale when the child dies during the settle window', async () => {
    const { spawn } = await import('node:child_process');
    // Spawn a child that exits after 20ms — we settle for 100ms, so it's
    // dead by the time we check.
    const child = spawn('node', ['-e', 'setTimeout(() => process.exit(0), 20)'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    const paths = ensureDaemonDirs(dataDir);
    writeFileSync(paths.pidPath('mcp'), `${child.pid}\n`);

    const status = await waitForServiceSettle(dataDir, 'mcp', 100);
    expect(status.state).toBe('stale');
    expect(status.pid).toBe(child.pid);
  });

  it('refuses to spawn when a live pid is already recorded', () => {
    const paths = ensureDaemonDirs(dataDir);
    writeFileSync(paths.pidPath('schedule'), `${process.pid}\n`);
    expect(() =>
      spawnService(dataDir, 'schedule', {
        suaBin: '/nonexistent/sua',
        cwd: process.cwd(),
        env: process.env,
      }),
    ).toThrow(/already running/);
  });

  it('clears a stale pid file before spawning', () => {
    const paths = ensureDaemonDirs(dataDir);
    writeFileSync(paths.pidPath('schedule'), '99999999\n');
    // Stale pid present. Calling spawnService should clear it; we use a
    // bogus suaBin so the spawn itself fails after the clear, but we assert
    // the pid file no longer points at the dead pid before the failure.
    try {
      spawnService(dataDir, 'schedule', {
        suaBin: '/nonexistent/sua',
        cwd: process.cwd(),
        env: process.env,
      });
    } catch {
      /* expected — spawn proceeds but the executed script doesn't exist;
         child may still exit with an error, that's fine. */
    }
    // After spawn, the pid file should reference whatever child was started
    // (or be absent if spawn failed). Either way, it must not be 99999999.
    const newPid = readServicePid(dataDir, 'schedule');
    expect(newPid).not.toBe(99999999);
  });
});
