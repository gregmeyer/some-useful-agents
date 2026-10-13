/**
 * What the orphan reaper (at boot) and the stuck-run watchdog (every 30s)
 * have cleaned up since this dashboard started, for `/health`. Counts only:
 * `/health` is unauthenticated, so no run ids.
 */
export interface ReapCounts { runs: number; nodes: number; processesKilled: number }

export interface ReaperStats {
  /** The boot reaper's one pass: runs a previous dashboard left unfinished. */
  boot: ReapCounts & { at: string } | null;
  /** The watchdog's totals since boot, and when it last reaped anything. */
  watchdog: ReapCounts & { lastReapedAt: string | null };
}

const stats: ReaperStats = {
  boot: null,
  watchdog: { runs: 0, nodes: 0, processesKilled: 0, lastReapedAt: null },
};

interface ReapResultLike { runsReaped: number; nodesReaped: number; pidsKilled: number }

export function recordBootReap(r: ReapResultLike, at = new Date().toISOString()): void {
  stats.boot = { runs: r.runsReaped, nodes: r.nodesReaped, processesKilled: r.pidsKilled, at };
}

export function recordWatchdogReap(r: ReapResultLike, at = new Date().toISOString()): void {
  if (r.runsReaped === 0 && r.nodesReaped === 0) return;
  stats.watchdog.runs += r.runsReaped;
  stats.watchdog.nodes += r.nodesReaped;
  stats.watchdog.processesKilled += r.pidsKilled;
  stats.watchdog.lastReapedAt = at;
}

export function reaperStats(): ReaperStats {
  return { boot: stats.boot && { ...stats.boot }, watchdog: { ...stats.watchdog } };
}
