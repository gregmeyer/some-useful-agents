/**
 * Pulse tile rules shared with the canvas boards (lib/board-canvas.ts): a
 * tile's automatic palette, and whether its body already offers Run. Pulse
 * itself is a board (routes/boards.ts); template renderers live in
 * pulse-renderers.ts, the registry in pulse-templates.ts.
 */

import { normalizeSignal } from './pulse-templates.js';
export type { PulseTile, PulsePageInput, TileWrapFn } from './pulse-types.js';
import type { PulseTile } from './pulse-types.js';

/** A tile's palette from its value: a threshold it crosses, a status, or a metric's accent. */
export function resolveAutoPalette(tile: PulseTile): string | null {
  const { template } = normalizeSignal(tile.signal);

  if (tile.signal.thresholds && tile.signal.thresholds.length > 0) {
    const numVal = Number(tile.slots.value);
    if (!isNaN(numVal)) {
      for (const t of tile.signal.thresholds) {
        if (t.above !== undefined && numVal > t.above) return t.palette;
        if (t.below !== undefined && numVal < t.below) return t.palette;
      }
    }
  }

  if (template === 'status') {
    const status = tile.slots.status ? String(tile.slots.status).toLowerCase() : '';
    if (status === 'healthy' || status === 'ok' || status === 'up') return 'accent-green';
    if (status === 'degraded' || status === 'warn' || status === 'warning') return 'accent-orange';
    if (status === 'down' || status === 'error' || status === 'critical') return 'accent-red';
  }

  if (template === 'metric') return 'accent-teal';
  return null;
}

/**
 * Does this tile's BODY already render a run control, so the footer must not
 * add a second one?
 *
 * Mirrors the dispatch in `renderTile` (pulse-renderers.ts) exactly:
 *   - an interactive widget is a mini-app and owns its own Run button;
 *   - a `widget` tile with a widget AND a prior run gets a synthesized
 *     "Run again" from `ensureReplayControl`.
 * A `widget` tile with no widget or no prior run renders "No widget output
 * yet." and no control — which is precisely a tile that needs ours.
 */
export function tileRendersOwnRunControl(tile: PulseTile): boolean {
  if (tile.agent.outputWidget?.interactive) return true;
  const { template } = normalizeSignal(tile.signal);
  return template === 'widget' && Boolean(tile.agent.outputWidget) && Boolean(tile.lastRun?.result);
}
