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
  /** Optional one-shot banner from a redirect (?ok=… / ?error=…). */
  flash?: { kind: 'ok' | 'error' | 'info'; message: string };
  /**
   * Installed dashboards (from DashboardsStore) used to populate the
   * dashboards dropdown above the Pulse header. Empty/undefined when
   * the dashboards store isn't wired (tests, older daemons).
   */
  installedDashboards?: import('@some-useful-agents/core').Dashboard[];
  /**
   * Packs registered but not yet installed, used to populate the
   * "Install from Packs" modal opened from the dashboards dropdown.
   * Empty/undefined when the packs store isn't wired.
   */
  availablePacks?: import('@some-useful-agents/core').Pack[];
}

/** Signature for the tile wrapper function, passed to renderers. */
export type TileWrapFn = (tile: PulseTile, content: SafeHtml) => SafeHtml;
