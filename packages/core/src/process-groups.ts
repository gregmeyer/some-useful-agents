/**
 * A node's process and everything it starts, stopped together.
 *
 * A shell node runs `sh -c '<command>'`. Stopping it used to SIGTERM only the
 * `sh`: a long command the shell had started (`sleep 60`, a build, a curl)
 * was orphaned, kept running, and held the node's output pipe open so the
 * node didn't end until that command did. Each node process now starts its
 * own process group (`detached`, POSIX only), and a stop or a timeout signals
 * the whole group.
 *
 * A detached group no longer gets the terminal's Ctrl+C. So this module also
 * remembers the live groups and, when this process exits, or is sent SIGINT,
 * SIGTERM or SIGHUP that nothing else here handles (plain `sua agent run`),
 * stops them before the process goes. The dashboard, scheduler and worker
 * handle SIGTERM themselves: their shutdown stops their runs first, and the
 * exit sweep catches anything left.
 */

/** Whether node processes get their own process group here (not on Windows). */
export const USE_PROCESS_GROUPS = process.platform !== 'win32';

const live = new Set<number>();
let installed = false;

/** Signal a process group (falls back to the process alone). Returns false when neither was there. */
export function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  if (USE_PROCESS_GROUPS) {
    try { process.kill(-pid, signal); return true; } catch { /* no such group: try the process */ }
  }
  try { process.kill(pid, signal); return true; } catch { return false; }
}

/** Whether anything in the group (or the process) is still running. */
export function groupAlive(pid: number): boolean {
  try { process.kill(USE_PROCESS_GROUPS ? -pid : pid, 0); return true; } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function stopAll(signal: NodeJS.Signals): void {
  for (const pid of live) signalGroup(pid, signal);
}

function install(): void {
  if (installed) return;
  installed = true;
  process.on('exit', () => stopAll('SIGKILL'));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const onSignal = (): void => {
      // Someone else handles this signal (a server's graceful shutdown): leave it to them.
      if (process.listenerCount(sig) > 1) return;
      stopAll('SIGTERM');
      // Then the default: the process ends as it would have without this listener.
      process.removeListener(sig, onSignal);
      process.kill(process.pid, sig);
    };
    process.on(sig, onSignal);
  }
}

/** Remember a node's group until it ends, so it's stopped if this process goes first. */
export function trackGroup(pid: number): void {
  if (!USE_PROCESS_GROUPS) return;
  live.add(pid);
  install();
}

export function untrackGroup(pid: number): void {
  live.delete(pid);
}

/**
 * Stop a group: SIGTERM, then SIGKILL after `graceMs` if anything in it is
 * still running. The timer doesn't keep this process alive.
 */
export function stopGroup(pid: number, graceMs = 5000): void {
  signalGroup(pid, 'SIGTERM');
  const t = setTimeout(() => { if (groupAlive(pid)) signalGroup(pid, 'SIGKILL'); }, graceMs);
  t.unref?.();
}
