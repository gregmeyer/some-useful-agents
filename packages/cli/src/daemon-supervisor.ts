/**
 * Daemon supervisor: spawn/stop/status for `sua daemon`-managed services.
 *
 * Each service (schedule, dashboard, mcp) is invoked by re-executing the
 * current `sua` binary with the corresponding subcommand as a detached
 * subprocess. PIDs and rotated logs live under `<dataDir>/daemon/`.
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export type ServiceName = 'schedule' | 'dashboard' | 'mcp';

export const ALL_SERVICES: readonly ServiceName[] = ['schedule', 'dashboard', 'mcp'] as const;

export interface SpawnedService {
  name: ServiceName;
  pid: number;
  logPath: string;
}

export interface ServiceStatus {
  name: ServiceName;
  state: 'running' | 'stopped' | 'stale';
  pid?: number;
  logPath: string;
}

export interface DaemonPaths {
  baseDir: string;   // <dataDir>/daemon
  logsDir: string;   // <dataDir>/daemon/logs
  pidPath: (name: ServiceName) => string;
  logPath: (name: ServiceName) => string;
}

const DEFAULT_LOG_ROTATE_BYTES = 10 * 1024 * 1024; // 10 MB

export function daemonPaths(dataDir: string): DaemonPaths {
  const baseDir = join(dataDir, 'daemon');
  const logsDir = join(baseDir, 'logs');
  return {
    baseDir,
    logsDir,
    pidPath: (name) => join(baseDir, `${name}.pid`),
    logPath: (name) => join(logsDir, `${name}.log`),
  };
}

export function ensureDaemonDirs(dataDir: string): DaemonPaths {
  const paths = daemonPaths(dataDir);
  mkdirSync(paths.logsDir, { recursive: true });
  return paths;
}

// ── PID helpers ─────────────────────────────────────────────────────────

export function readServicePid(dataDir: string, name: ServiceName): number | null {
  const path = daemonPaths(dataDir).pidPath(name);
  if (!existsSync(path)) return null;
  try {
    const pid = parseInt(readFileSync(path, 'utf-8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePid(path: string, pid: number): void {
  writeFileSync(path, String(pid) + '\n');
}

function clearPid(path: string): void {
  try { unlinkSync(path); } catch { /* already gone */ }
}

// ── Log rotation (rotate-on-start) ──────────────────────────────────────

/**
 * Rotate the log if it's over the size cap. Renames `<svc>.log` → `<svc>.log.1`,
 * dropping any prior `.log.1`. Simple, no gzip — keeps last 1.
 */
export function rotateLog(logPath: string, capBytes: number): void {
  if (!existsSync(logPath)) return;
  let size = 0;
  try {
    size = statSync(logPath).size;
  } catch {
    return;
  }
  if (size <= capBytes) return;
  const rotated = `${logPath}.1`;
  try { unlinkSync(rotated); } catch { /* ignore */ }
  try { renameSync(logPath, rotated); } catch { /* best effort */ }
}

// ── Spawn / stop ────────────────────────────────────────────────────────

export interface SpawnOptions {
  /** Binary path of the `sua` CLI (typically `process.argv[1]`). */
  suaBin: string;
  /** Working directory for the child (typically `process.cwd()`). */
  cwd: string;
  /** Environment variables to pass through (typically `process.env`). */
  env: NodeJS.ProcessEnv;
  /** Log rotation threshold in bytes. */
  logRotateBytes?: number;
  /** Per-service extra args. */
  extraArgs?: Partial<Record<ServiceName, string[]>>;
}

const SERVICE_ARGV: Record<ServiceName, string[]> = {
  schedule: ['schedule', 'start'],
  dashboard: ['dashboard', 'start'],
  mcp: ['mcp', 'start'],
};

/**
 * Spawn a service as a detached subprocess. Refuses if a live PID is already
 * recorded for the service. Returns the spawned PID + log path on success.
 */
export function spawnService(
  dataDir: string,
  name: ServiceName,
  options: SpawnOptions,
): SpawnedService {
  const paths = ensureDaemonDirs(dataDir);
  const existingPid = readServicePid(dataDir, name);
  if (existingPid !== null && isProcessAlive(existingPid)) {
    throw new Error(`Service "${name}" is already running (PID ${existingPid}).`);
  }
  // Stale PID — clear it.
  if (existingPid !== null) clearPid(paths.pidPath(name));

  const logPath = paths.logPath(name);
  rotateLog(logPath, options.logRotateBytes ?? DEFAULT_LOG_ROTATE_BYTES);
  // Open log in append mode so subsequent writes accumulate across restarts.
  const logFd = openSync(logPath, 'a');

  const args = [options.suaBin, ...SERVICE_ARGV[name], ...(options.extraArgs?.[name] ?? [])];
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  if (typeof child.pid !== 'number') {
    throw new Error(`Failed to spawn service "${name}" — no PID assigned.`);
  }
  writePid(paths.pidPath(name), child.pid);
  return { name, pid: child.pid, logPath };
}

/**
 * Stop a service by SIGTERM-ing its recorded PID. Cleans up the PID file
 * regardless of outcome. Returns true if a process was alive and signalled.
 */
export function stopService(dataDir: string, name: ServiceName): { signalled: boolean; pid?: number } {
  const paths = daemonPaths(dataDir);
  const pid = readServicePid(dataDir, name);
  if (pid === null) return { signalled: false };
  let signalled = false;
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      signalled = true;
    } catch {
      signalled = false;
    }
  }
  clearPid(paths.pidPath(name));
  return { signalled, pid };
}

export function getServiceStatus(dataDir: string, name: ServiceName): ServiceStatus {
  const paths = daemonPaths(dataDir);
  const pid = readServicePid(dataDir, name);
  if (pid === null) {
    return { name, state: 'stopped', logPath: paths.logPath(name) };
  }
  if (isProcessAlive(pid)) {
    return { name, state: 'running', pid, logPath: paths.logPath(name) };
  }
  // PID file points at a dead process.
  return { name, state: 'stale', pid, logPath: paths.logPath(name) };
}
