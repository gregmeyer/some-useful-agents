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
  /** Keys available in the last run's output (for configure modal field picker). */
  outputFields?: string[];
  /**
   * Input values from the most recent run, scoped to keys declared in
   * agent.inputs. Used by interactive widgets to pre-fill the form.
   */
  previousInputs?: Record<string, string>;
}

export interface PulsePageInput {
  systemTiles: PulseTile[];
  tiles: PulseTile[];
  hiddenTiles: PulseTile[];
}

/** Signature for the tile wrapper function, passed to renderers. */
export type TileWrapFn = (tile: PulseTile, content: SafeHtml) => SafeHtml;
