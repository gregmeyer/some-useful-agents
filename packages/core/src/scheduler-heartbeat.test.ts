import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeHeartbeat,
  readHeartbeat,
  clearHeartbeat,
  getSchedulerStatus,
  acquirePidFile,
  releasePidFile,
} from './scheduler-heartbeat.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sua-heartbeat-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('writeHeartbeat / readHeartbeat', () => {
  it('writes and reads back heartbeat data', () => {
    writeHeartbeat(dataDir, {
      pid: 12345,
      startedAt: '2026-04-22T10:00:00Z',
      agents: ['daily-greeting'],
      nextFires: { 'daily-greeting': '2026-04-23T09:00:00Z' },
    });

    const hb = readHeartbeat(dataDir);
    expect(hb).not.toBeNull();
    expect(hb!.pid).toBe(12345);
    expect(hb!.agents).toEqual(['daily-greeting']);
    expect(hb!.lastHeartbeat).toBeTruthy();
    expect(hb!.nextFires['daily-greeting']).toBe('2026-04-23T09:00:00Z');
  });

  it('returns null when no heartbeat file exists', () => {
    expect(readHeartbeat(dataDir)).toBeNull();
  });
});

describe('clearHeartbeat', () => {
  it('removes the heartbeat file', () => {
    writeHeartbeat(dataDir, {
      pid: 1,
      startedAt: new Date().toISOString(),
      agents: [],
      nextFires: {},
    });
    expect(readHeartbeat(dataDir)).not.toBeNull();
    clearHeartbeat(dataDir);
    expect(readHeartbeat(dataDir)).toBeNull();
  });

  it('does not throw when file does not exist', () => {
    expect(() => clearHeartbeat(dataDir)).not.toThrow();
  });
});

describe('getSchedulerStatus', () => {
  it('returns stopped when no heartbeat file exists', () => {
    const { status, heartbeat } = getSchedulerStatus(dataDir);
    expect(status).toBe('stopped');
    expect(heartbeat).toBeNull();
  });

  it('returns running for a fresh heartbeat', () => {
    writeHeartbeat(dataDir, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      agents: ['a'],
      nextFires: {},
    });
    const { status } = getSchedulerStatus(dataDir);
    expect(status).toBe('running');
  });

  it('returns stale for an old heartbeat', () => {
    const old = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
    writeFileSync(
      join(dataDir, 'scheduler-heartbeat.json'),
      JSON.stringify({
        pid: 99999,
        startedAt: old,
        lastHeartbeat: old,
        agents: ['a'],
        nextFires: {},
      }),
    );
    const { status } = getSchedulerStatus(dataDir);
    expect(status).toBe('stale');
  });
});

describe('acquirePidFile / releasePidFile', () => {
  it('acquires when no PID file exists', () => {
    const { acquired } = acquirePidFile(dataDir);
    expect(acquired).toBe(true);
    expect(existsSync(join(dataDir, 'scheduler.pid'))).toBe(true);
    releasePidFile(dataDir);
  });

  it('refuses when another process holds the PID file', () => {
    // Write our own PID (which IS alive).
    writeFileSync(join(dataDir, 'scheduler.pid'), String(process.pid));
    const { acquired, existingPid } = acquirePidFile(dataDir);
    expect(acquired).toBe(false);
    expect(existingPid).toBe(process.pid);
  });

  it('overwrites stale PID file (dead process)', () => {
    // PID 99999999 is almost certainly not alive.
    writeFileSync(join(dataDir, 'scheduler.pid'), '99999999');
    const { acquired } = acquirePidFile(dataDir);
    expect(acquired).toBe(true);
    const content = readFileSync(join(dataDir, 'scheduler.pid'), 'utf-8').trim();
    expect(content).toBe(String(process.pid));
    releasePidFile(dataDir);
  });

  it('releasePidFile removes the file', () => {
    acquirePidFile(dataDir);
    releasePidFile(dataDir);
    expect(existsSync(join(dataDir, 'scheduler.pid'))).toBe(false);
  });
});
