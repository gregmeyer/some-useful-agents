/**
 * Daemon supervisor: spawn/stop/status for `sua daemon`-managed services.
 *
 * Each sua service (schedule, dashboard, mcp, worker) is invoked by
 * re-executing the current `sua` binary with the corresponding subcommand as
 * a detached subprocess. `model` is the exception: it runs an external
 * command from config (a local model server such as llama-server), so a local
 * provider starts and stops with everything else. PIDs and rotated logs live
 * under `<dataDir>/daemon/`.
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

export type ServiceName = 'schedule' | 'dashboard' | 'mcp' | 'worker' | 'model';

export const ALL_SERVICES: readonly ServiceName[] = ['schedule', 'dashboard', 'mcp', 'worker', 'model'] as const;

/** An external command a service runs instead of re-executing `sua`. */
export interface ServiceCommand {
  command: string;
  args?: string[];
}

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
  /**
   * Per-service external command. Required for `model` (it has no sua
   * subcommand); ignored for the others, which always re-exec `sua`.
   */
  commands?: Partial<Record<ServiceName, ServiceCommand>>;
}

const SERVICE_ARGV: Record<Exclude<ServiceName, 'model'>, string[]> = {
  schedule: ['schedule', 'start'],
  // --replace: the daemon owns this port, so a leftover/orphaned dashboard
  // (e.g. one started by hand with `sua dashboard start` and never stopped)
  // should be reclaimed rather than silently leaving stale code serving.
  // The supervisor spawn is non-interactive, so without --replace it would
  // refuse to clobber and exit; with it, a stale instance is taken over.
  dashboard: ['dashboard', 'start', '--replace'],
  mcp: ['mcp', 'start'],
  // The Temporal worker. Only useful when the provider is `temporal`; it polls
  // the task queue and executes agent/node work on the host (ADR-0004). Opt-in
  // via `daemon.services` or `sua daemon start --service worker`.
  worker: ['worker', 'start'],
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

  const external = name === 'model' ? options.commands?.model : undefined;
  if (name === 'model' && !external?.command) {
    throw new Error(
      'No command configured for the "model" service. Set `daemon.model.command` (and `args`) in sua.config.json.',
    );
  }

  const logPath = paths.logPath(name);
  rotateLog(logPath, options.logRotateBytes ?? DEFAULT_LOG_ROTATE_BYTES);
  // Open log in append mode so subsequent writes accumulate across restarts.
  const logFd = openSync(logPath, 'a');

  const [bin, args] = external
    ? [external.command, [...(external.args ?? []), ...(options.extraArgs?.[name] ?? [])]]
    : [process.execPath, [options.suaBin, ...SERVICE_ARGV[name as Exclude<ServiceName, 'model'>], ...(options.extraArgs?.[name] ?? [])]];
  const child = spawn(bin, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  // A missing external binary surfaces as an async 'error' event (ENOENT);
  // unhandled, it would crash the CLI. The missing pid below reports it.
  child.on('error', () => {});
  child.unref();

  if (typeof child.pid !== 'number') {
    throw new Error(
      external
        ? `Failed to spawn service "${name}" — could not run \`${external.command}\`. Is it installed and on PATH?`
        : `Failed to spawn service "${name}" — no PID assigned.`,
    );
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

/**
 * After spawnService returns, the child may still die on startup (port
 * conflict, missing config, secrets preflight failure). Wait briefly and
 * report whether the recorded pid is still alive. Returns the final
 * ServiceStatus so callers can surface the log path on crash.
 */
export async function waitForServiceSettle(
  dataDir: string,
  name: ServiceName,
  settleMs = 750,
): Promise<ServiceStatus> {
  await new Promise((r) => setTimeout(r, settleMs));
  return getServiceStatus(dataDir, name);
}
