/**
 * Grouping + ordering for the Pulse board.
 *
 * The board rendered every tile into one flat grid in `listAgents()` order,
 * which is effectively arbitrary. On a real install that meant 31 tiles where
 * an agent you have never run sat at identical visual weight, in no particular
 * place, next to one you ran sixteen minutes ago. The ordering carried no
 * information at all.
 *
 * Pulse's job is running things, so the useful sort is *how recently you used
 * it*: what you ran lately is what you are most likely to run again. Tiles that
 * have never produced a successful run get collected at the bottom rather than
 * salted through the board — they are not failures, they are things set up and
 * not yet used, and grouping them makes that legible instead of noisy.
 *
 * This is deliberately a pure function over data the board already has.
 * `buildPulseTile` fetches each tile's last completed run, so grouping needs no
 * extra queries and no schema — see `pulse-tile-builder.ts`.
 */

/** Minimum shape needed to place a tile. Keeps this testable without a store. */
export interface GroupableTile {
  agent: { id: string };
  lastRun?: { completedAt?: string | null; startedAt?: string | null } | null;
}

export interface TileGroup {
  id: string;
  label: string;
  tiles: string[];
}

/** Tiles older than this fall out of "Recent". */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function lastRunMs(tile: GroupableTile): number | null {
  const stamp = tile.lastRun?.completedAt ?? tile.lastRun?.startedAt ?? null;
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Split agent tiles into Recent / Idle / Never run, newest first within each.
 *
 * `systemTileIds` become their own leading group when present — they are
 * synthetic aggregates, always current, and were already pinned to the top.
 *
 * Empty groups are omitted: the layout schema rejects zero-tile containers and
 * a labelled empty band is just noise (same rule the layout planner follows).
 */
export function computeTileGroups(
  tiles: GroupableTile[],
  systemTileIds: string[] = [],
  now: number = Date.now(),
): TileGroup[] {
  const recent: Array<{ id: string; at: number }> = [];
  const idle: Array<{ id: string; at: number }> = [];
  const never: string[] = [];

  for (const tile of tiles) {
    const at = lastRunMs(tile);
    if (at === null) {
      never.push(tile.agent.id);
    } else if (now - at <= RECENT_WINDOW_MS) {
      recent.push({ id: tile.agent.id, at });
    } else {
      idle.push({ id: tile.agent.id, at });
    }
  }

  // Newest first. Ties keep their incoming order, which is the store's — stable
  // enough that the board doesn't reshuffle between reloads.
  const byNewest = (a: { at: number }, b: { at: number }) => b.at - a.at;
  recent.sort(byNewest);
  idle.sort(byNewest);

  const groups: TileGroup[] = [];
  if (systemTileIds.length > 0) {
    groups.push({ id: 'health', label: 'Health', tiles: [...systemTileIds] });
  }
  if (recent.length > 0) {
    groups.push({ id: 'recent', label: 'Recent', tiles: recent.map((r) => r.id) });
  }
  if (idle.length > 0) {
    groups.push({ id: 'idle', label: 'Idle', tiles: idle.map((r) => r.id) });
  }
  if (never.length > 0) {
    // Named for what it is. These tiles are the most interesting ones on a
    // run console — an agent you set up and never used is one click from
    // being useful — so they are collected, not hidden.
    groups.push({ id: 'never-run', label: 'Never run', tiles: never });
  }
  return groups;
}
