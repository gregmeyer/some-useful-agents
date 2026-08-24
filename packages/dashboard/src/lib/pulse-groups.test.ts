/**
 * Board grouping. The Pulse board was one flat grid in `listAgents()` order,
 * so an agent you had never run sat at identical weight, in no meaningful
 * place, beside one you ran minutes ago. These pin the ordering rule that
 * replaced it: most recently used first, never-used collected at the bottom.
 */

import { describe, it, expect } from 'vitest';
import { computeTileGroups, RECENT_WINDOW_MS, type GroupableTile } from './pulse-groups.js';

const NOW = Date.parse('2026-08-22T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function tile(id: string, completedAt?: string | null): GroupableTile {
  return { agent: { id }, lastRun: completedAt === undefined ? null : { completedAt } };
}

const labels = (gs: ReturnType<typeof computeTileGroups>) => gs.map((g) => g.label);
const byId = (gs: ReturnType<typeof computeTileGroups>, id: string) =>
  gs.find((g) => g.id === id)?.tiles ?? [];

describe('computeTileGroups', () => {
  it('puts what you ran most recently first', () => {
    const gs = computeTileGroups(
      [tile('old', ago(3 * DAY)), tile('newest', ago(5 * 60_000)), tile('mid', ago(6 * HOUR))],
      [], NOW,
    );
    expect(byId(gs, 'recent')).toEqual(['newest', 'mid', 'old']);
  });

  it('separates never-run tiles instead of salting them through the board', () => {
    const gs = computeTileGroups(
      [tile('used', ago(HOUR)), tile('fresh-install'), tile('also-unused')],
      [], NOW,
    );
    expect(byId(gs, 'recent')).toEqual(['used']);
    expect(byId(gs, 'never-run')).toEqual(['fresh-install', 'also-unused']);
  });

  it('splits recent from idle at the seven-day line', () => {
    const gs = computeTileGroups(
      [tile('just-inside', ago(RECENT_WINDOW_MS - HOUR)), tile('just-outside', ago(RECENT_WINDOW_MS + HOUR))],
      [], NOW,
    );
    expect(byId(gs, 'recent')).toEqual(['just-inside']);
    expect(byId(gs, 'idle')).toEqual(['just-outside']);
  });

  it('leads with Health when there are system tiles', () => {
    const gs = computeTileGroups([tile('a', ago(HOUR))], ['_system-runs-today'], NOW);
    expect(labels(gs)[0]).toBe('Health');
    expect(byId(gs, 'health')).toEqual(['_system-runs-today']);
  });

  it('omits groups with nothing in them', () => {
    // A labelled empty band is noise, and the layout schema rejects
    // zero-tile containers — the same rule the layout planner follows.
    const onlyNever = computeTileGroups([tile('x')], [], NOW);
    expect(labels(onlyNever)).toEqual(['Never run']);

    const onlyRecent = computeTileGroups([tile('y', ago(HOUR))], [], NOW);
    expect(labels(onlyRecent)).toEqual(['Recent']);

    expect(computeTileGroups([], [], NOW)).toEqual([]);
  });

  it('orders the groups most-actionable first', () => {
    const gs = computeTileGroups(
      [tile('r', ago(HOUR)), tile('i', ago(30 * DAY)), tile('n')],
      ['_system-runs-today'], NOW,
    );
    expect(labels(gs)).toEqual(['Health', 'Recent', 'Idle', 'Never run']);
  });

  it('accounts for every tile exactly once', () => {
    const tiles = [tile('a', ago(HOUR)), tile('b', ago(30 * DAY)), tile('c'), tile('d', ago(2 * DAY))];
    const gs = computeTileGroups(tiles, ['_system-x'], NOW);
    const placed = gs.flatMap((g) => g.tiles);
    expect(placed.slice().sort()).toEqual(['_system-x', 'a', 'b', 'c', 'd']);
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('treats an unparseable or missing timestamp as never run, not as epoch zero', () => {
    // Falling back to 0 would sort a broken timestamp to the very bottom of
    // Idle and quietly imply the agent ran in 1970.
    const gs = computeTileGroups(
      [{ agent: { id: 'bad' }, lastRun: { completedAt: 'not-a-date' } }, tile('none', null)],
      [], NOW,
    );
    expect(byId(gs, 'never-run').sort()).toEqual(['bad', 'none']);
    expect(byId(gs, 'idle')).toEqual([]);
  });

  it('falls back to startedAt when a run has no completedAt', () => {
    const gs = computeTileGroups(
      [{ agent: { id: 'running' }, lastRun: { startedAt: ago(HOUR) } }],
      [], NOW,
    );
    expect(byId(gs, 'recent')).toEqual(['running']);
  });
});
