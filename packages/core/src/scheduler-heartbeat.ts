/**
 * Scheduler heartbeat: periodic file-based health signal + PID file
 * for single-instance guard. Zero IPC — any consumer reads the file.
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SchedulerHeartbeat {
  pid: number;
  startedAt: string;
  lastHeartbeat: string;
  agents: string[];
  nextFires: Record<string, string>;
}

const HEARTBEAT_FILE = 'scheduler-heartbeat.json';
const PID_FILE = 'scheduler.pid';
const DEFAULT_STALE_MS = 90_000; // 90 seconds

// ── Heartbeat ───────────────────────────────────────────────────────────

/** Write heartbeat to disk. Called on an interval by the scheduler. */
export function writeHeartbeat(
  dataDir: string,
  data: Omit<SchedulerHeartbeat, 'lastHeartbeat'>,
): void {
  const payload: SchedulerHeartbeat = {
    ...data,
    lastHeartbeat: new Date().toISOString(),
  };
  try {
    writeFileSync(join(dataDir, HEARTBEAT_FILE), JSON.stringify(payload, null, 2) + '\n');
  } catch {
    // Best-effort: don't crash the scheduler if the write fails.
  }
}

/** Read heartbeat from disk. Returns null if missing or unparseable. */
export function readHeartbeat(dataDir: string): SchedulerHeartbeat | null {
  try {
    const raw = readFileSync(join(dataDir, HEARTBEAT_FILE), 'utf-8');
    return JSON.parse(raw) as SchedulerHeartbeat;
  } catch {
    return null;
  }
}

/** Remove the heartbeat file (called on clean shutdown). */
export function clearHeartbeat(dataDir: string): void {
  try {
    unlinkSync(join(dataDir, HEARTBEAT_FILE));
  } catch {
    // Already gone or never written.
  }
}

export type SchedulerStatus = 'running' | 'stale' | 'stopped';

/**
 * Determine scheduler status from the heartbeat file.
 * - 'running': heartbeat is fresh (within staleThresholdMs)
 * - 'stale': heartbeat exists but is older than threshold
 * - 'stopped': no heartbeat file found
 */
export function getSchedulerStatus(
  dataDir: string,
  staleThresholdMs = DEFAULT_STALE_MS,
): { status: SchedulerStatus; heartbeat: SchedulerHeartbeat | null } {
  const heartbeat = readHeartbeat(dataDir);
  if (!heartbeat) return { status: 'stopped', heartbeat: null };

  const age = Date.now() - new Date(heartbeat.lastHeartbeat).getTime();
  const status: SchedulerStatus = age <= staleThresholdMs ? 'running' : 'stale';
  return { status, heartbeat };
}

// ── PID file (single-instance guard) ────────────────────────────────────

/** Write PID file. Returns true if written, false if another instance is alive. */
export function acquirePidFile(dataDir: string): { acquired: boolean; existingPid?: number } {
  const pidPath = join(dataDir, PID_FILE);

  if (existsSync(pidPath)) {
    try {
      const existingPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
      if (!isNaN(existingPid) && isProcessAlive(existingPid)) {
        return { acquired: false, existingPid };
      }
      // Stale PID file — process is dead.
    } catch {
      // Corrupt file, overwrite.
    }
  }

  try {
    writeFileSync(pidPath, String(process.pid) + '\n');
    return { acquired: true };
  } catch {
    return { acquired: false };
  }
}

/** Remove PID file (called on clean shutdown). */
export function releasePidFile(dataDir: string): void {
  try {
    unlinkSync(join(dataDir, PID_FILE));
  } catch {
    // Already gone.
  }
}

/** Check if a process is alive by sending signal 0. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
