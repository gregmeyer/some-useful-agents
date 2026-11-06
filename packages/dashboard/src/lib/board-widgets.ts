/**
 * A board's data model (ADR-0070): what a composed page binds to under
 * `/board/...` (core board-layout.ts BOARD_LAYOUT_DATA): the board's name
 * and date, and, per agent, its latest result's fields, its run, and its
 * numbers shaped for a Lead or a StatStrip. Built from the same tiles the
 * canvas draws, so a part and a tile of one agent always show one run.
 */
import {
  runOutputs,
  boardLayoutFlags,
  BOARD_LEAD_NUMBER,
  type RunStore,
  type BoardAgentShape,
  type BoardAgentOutputShape,
} from '@some-useful-agents/core';
import { formatAge } from '../views/components.js';
import { normalizeSignal, TEMPLATE_REGISTRY } from '../views/pulse-templates.js';
import type { PulseTile } from '../views/pulse-types.js';

export interface BoardStat { value: string; label: string; note: string; href?: string }
export interface BoardStatItem { label: string; value: string; sub?: string }

export interface BoardAgentData {
  title: string;
  icon?: string;
  href: string;
  outputs: Record<string, unknown>;
  run: { id?: string; status?: string; completedAt?: string; age: string; href?: string; running: boolean };
  stats: Record<string, BoardStat>;
  statItems: BoardStatItem[];
}

export interface BoardData {
  name: string;
  date: string;
  updated: string;
  agentIds: string[];
  statItems: BoardStatItem[];
  agents: Record<string, BoardAgentData>;
}

/** A value as a number, when it reads as one ("53", "-8.17", "$1,200", "12%"); never for "53°F". */
export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && /^\s*[-+]?[$€£]?\d[\d,]*(\.\d+)?\s*%?\s*$/.test(v)) {
    const n = Number(v.replace(/[$€£,%\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** "nasdaq_change_pct" → "Nasdaq change pct". */
export const fieldLabel = (name: string): string => name.replace(/[_-]+/g, ' ').trim().replace(/^\w/, (ch) => ch.toUpperCase());

/** The shape of a result's fields: names and kinds, never values. */
export function outputShapes(outputs: Record<string, unknown>): BoardAgentOutputShape[] {
  return Object.entries(outputs).flatMap(([name, v]): BoardAgentOutputShape[] => {
    if (name === 'result' && Object.keys(outputs).length > 1) return [];
    if (Array.isArray(v)) return [{ name, type: 'list' as const, length: v.length }];
    if (asNumber(v) !== undefined) return [{ name, type: 'number' as const }];
    if (typeof v === 'string') return [{ name, type: 'string' as const, length: v.length }];
    if (v && typeof v === 'object') return [{ name, type: 'object' as const }];
    return [];
  });
}

/** The latest result's fields for a tile (its agent's outputs; see a2ui/view.ts runOutputs). */
export function boardAgentOutputs(tile: PulseTile, runStore: RunStore): Record<string, unknown> {
  if (!tile.lastRun) return {};
  try { return runOutputs(tile.lastRun, runStore.listNodeExecutions(tile.lastRun.id)); } catch { return {}; }
}

function isRunning(agentId: string, runStore: RunStore): boolean {
  try {
    return runStore.listRuns({ agentName: agentId, status: 'running', limit: 1 }).length > 0
      || runStore.listRuns({ agentName: agentId, status: 'pending', limit: 1 }).length > 0;
  } catch { return false; }
}

/** A tile's agent as a layout can know it. */
export function boardAgentShape(tile: PulseTile, runStore: RunStore, outputs = boardAgentOutputs(tile, runStore)): BoardAgentShape {
  const size = tile.layoutHint?.size ?? tile.signal.size ?? TEMPLATE_REGISTRY[normalizeSignal(tile.signal).template]?.defaultSize;
  return {
    id: tile.agent.id,
    title: tile.signal.title,
    ...(tile.signal.icon ? { icon: tile.signal.icon } : {}),
    ...(size ? { size } : {}),
    kind: normalizeSignal(tile.signal).template,
    outputs: outputShapes(outputs),
    ran: !!tile.lastRun && Object.keys(outputs).length > 0,
    running: isRunning(tile.agent.id, runStore),
  };
}

/** Today, written out: "Thursday 6 November". */
export function boardDate(now = Date.now()): string {
  return new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export interface BoardPageData {
  data: BoardData;
  shapes: BoardAgentShape[];
  flags: Record<string, boolean>;
  running: Set<string>;
}

/**
 * The board's data, flags and running agents from its tiles, in the order
 * the document places them (`order`; tiles it doesn't name follow).
 */
export function boardPageData(board: { name: string }, tiles: ReadonlyMap<string, PulseTile>, deps: { runStore: RunStore; now?: number }, order: readonly string[] = []): BoardPageData {
  const ids = [...new Set([...order.filter((id) => tiles.has(id)), ...tiles.keys()])].filter((id) => !id.startsWith('_'));
  const agents: Record<string, BoardAgentData> = {};
  const shapes: BoardAgentShape[] = [];
  const statItems: BoardStatItem[] = [];
  let newest: string | undefined;
  for (const id of ids) {
    const tile = tiles.get(id)!;
    const outputs = boardAgentOutputs(tile, deps.runStore);
    const shape = boardAgentShape(tile, deps.runStore, outputs);
    shapes.push(shape);
    const run = tile.lastRun;
    const at = run?.completedAt ?? run?.startedAt;
    if (at && (!newest || at > newest)) newest = at;
    const age = at ? formatAge(at) : 'never';
    const href = run ? `/runs/${encodeURIComponent(run.id)}` : undefined;
    const stats: Record<string, BoardStat> = {};
    const items: BoardStatItem[] = [];
    for (const o of shape.outputs) {
      if (o.type !== 'number') continue;
      const raw = outputs[o.name];
      const value = typeof raw === 'string' ? raw.trim() : String(raw);
      stats[o.name] = { value, label: fieldLabel(o.name), note: `${tile.signal.title} · ${age}`, ...(href ? { href } : {}) };
      items.push({ label: fieldLabel(o.name), value, sub: tile.signal.title });
    }
    // The board's strip keeps the numbers that matter (a change, a price), not every count.
    statItems.push(...items.filter((s) => BOARD_LEAD_NUMBER.test(s.label)).slice(0, 2));
    agents[id] = {
      title: tile.signal.title,
      ...(tile.signal.icon ? { icon: tile.signal.icon } : {}),
      href: `/agents/${encodeURIComponent(id)}`,
      outputs,
      run: { ...(run ? { id: run.id, status: run.status, ...(run.completedAt ? { completedAt: run.completedAt } : {}), href } : {}), age, running: !!shape.running },
      stats,
      statItems: items,
    };
  }
  return {
    data: {
      name: board.name,
      date: boardDate(deps.now),
      updated: newest ? formatAge(newest) : 'never',
      agentIds: ids,
      statItems: statItems.slice(0, 8),
      agents,
    },
    shapes,
    flags: boardLayoutFlags(shapes),
    running: new Set(shapes.filter((s) => s.running).map((s) => s.id)),
  };
}

/** How often the board's data is fetched again: the shortest of its tiles' refreshes (0: never). */
export function boardRefreshMs(entries: Iterable<{ refreshMs?: number }>): number {
  let out = 0;
  for (const e of entries) if (e.refreshMs && e.refreshMs > 0 && (!out || e.refreshMs < out)) out = e.refreshMs;
  return out ? Math.max(out, 10_000) : 0;
}
