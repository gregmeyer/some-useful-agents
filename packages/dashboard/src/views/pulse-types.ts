/**
 * Shared Pulse types. Extracted from pulse.ts to break the circular
 * type import between pulse.ts and pulse-renderers.ts.
 */

import type { Agent, AgentSignal, Run } from '@some-useful-agents/core';
import type { SafeHtml } from './html.js';

export interface PulseTile {
  agent: Agent;
  signal: AgentSignal;
  lastRun?: Run;
  slots: Record<string, unknown>;
}

export interface PulsePageInput {
  systemTiles: PulseTile[];
  tiles: PulseTile[];
  hiddenTiles: PulseTile[];
}

/** Signature for the tile wrapper function, passed to renderers. */
export type TileWrapFn = (tile: PulseTile, content: SafeHtml) => SafeHtml;
