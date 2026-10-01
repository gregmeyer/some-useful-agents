/**
 * Build a PulseTile from an agent + run history.
 *
 * Extracted from routes/pulse.ts so other surfaces (the new
 * /dashboards/:id route) can render the same tiles without
 * cross-route imports. Tile rendering itself stays in
 * pulse-renderers.ts.
 */

import type { Agent, AgentSignal, LayoutHintsStore, Run, RunStore } from '@some-useful-agents/core';
import type { PulseTile } from './pulse-types.js';
import { normalizeSignal, extractMappedValues } from './pulse-templates.js';
import type { SafeHtml } from './html.js';
import { renderRunView } from '../lib/a2ui-surface.js';

/**
 * The signal a tile is built from: the agent's own, or, for an agent that
 * only declares an A2UI `view:`, a plain one titled after the agent, so a
 * view alone is enough to be on Pulse and dashboards.
 */
export function tileSignal(agent: Agent): AgentSignal | undefined {
  if (agent.signal) return agent.signal;
  if (agent.view) return { title: agent.name, template: 'widget' };
  return undefined;
}

/** The agent with its tile signal filled in (see tileSignal), for code that gates on `agent.signal`. */
export function withTileSignal<A extends Agent | null | undefined>(agent: A): A {
  if (!agent || agent.signal || !agent.view) return agent;
  return { ...agent, signal: tileSignal(agent) } as A;
}

export interface BuildTileDeps {
  runStore: RunStore;
}

export function buildPulseTile(
  agent: Agent & { signal: AgentSignal },
  deps: BuildTileDeps,
): PulseTile {
  const signal = agent.signal;
  let lastRun: Run | undefined;
  let outputsJson: string | undefined;
  let previousInputs: Record<string, string> | undefined;
  let viewHtml: SafeHtml | undefined;
  try {
    const runs = deps.runStore.listRuns({ agentName: agent.id, status: 'completed', limit: 1 });
    if (runs.length > 0) {
      lastRun = runs[0];
      const execs = deps.runStore.listNodeExecutions(lastRun.id);
      if (agent.view) viewHtml = renderRunView(agent, lastRun, execs, `tile-${agent.id}`);
      const lastExec = execs.filter((e) => e.status === 'completed').pop();
      if (lastExec?.outputsJson) outputsJson = lastExec.outputsJson;

      // Pre-fill the interactive widget form with the most recent run's
      // input values (mirrors buildTile in routes/pulse.ts).
      if (agent.outputWidget?.interactive && agent.inputs && execs.length > 0 && execs[0].inputsJson) {
        try {
          const allEnv = JSON.parse(execs[0].inputsJson) as Record<string, string>;
          const inputNames = new Set(Object.keys(agent.inputs));
          const picked: Record<string, string> = {};
          for (const [k, v] of Object.entries(allEnv)) {
            if (inputNames.has(k) && v !== '') picked[k] = v;
          }
          if (Object.keys(picked).length > 0) previousInputs = picked;
        } catch { /* malformed inputsJson */ }
      }
    }
  } catch { /* no runs */ }

  const { mapping } = normalizeSignal(signal);
  const slots = extractMappedValues(lastRun, mapping, outputsJson);

  // Discover output field keys for the configure modal.
  const outputFields: string[] = [];
  const fieldSet = new Set<string>();
  if (outputsJson) {
    try {
      const parsed = JSON.parse(outputsJson);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const k of Object.keys(parsed)) fieldSet.add(k);
      }
    } catch { /* ignore */ }
  }
  if (lastRun?.result) {
    try {
      const parsed = JSON.parse(lastRun.result);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const k of Object.keys(parsed)) fieldSet.add(k);
      }
    } catch { /* not JSON */ }
  }
  outputFields.push(...Array.from(fieldSet).sort());

  return { agent, signal, lastRun, slots, outputFields, previousInputs, ...(viewHtml ? { viewHtml } : {}) };
}

/**
 * Attach layout hints to a list of already-built tiles in one batch
 * lookup. Tiles whose agent has no hint row are left untouched (the
 * renderer falls back to signal.size / outputWidget.tileFit). System
 * tiles (leading-underscore ids) are skipped — they're synthetic and
 * never have hints. Failures are swallowed: rendering must not break
 * because the hints table is unavailable.
 */
export function attachLayoutHints(
  tiles: PulseTile[],
  store: LayoutHintsStore | undefined,
): void {
  if (!store || tiles.length === 0) return;
  const ids = tiles
    .map((t) => t.agent.id)
    .filter((id) => id && !id.startsWith('_'));
  if (ids.length === 0) return;
  let hints: Map<string, import('@some-useful-agents/core').LayoutHint>;
  try {
    hints = store.getHintsFor(ids);
  } catch {
    return;
  }
  for (const tile of tiles) {
    const hint = hints.get(tile.agent.id);
    if (hint) tile.layoutHint = hint;
  }
}
