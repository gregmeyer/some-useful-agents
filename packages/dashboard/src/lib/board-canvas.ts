/**
 * Canvas boards (docs/boards.md): a board drawn as ONE A2UI surface. The
 * board's document (core boards.ts) lays out AgentTile / SystemTile leaves;
 * this module assembles what the browser needs to draw them:
 *
 *   - the board surface's messages (the document, plus, on Pulse, an
 *     "Everything else" section holding agents the document doesn't place);
 *   - a tile registry: per tile, its chrome (title, last run, Run control,
 *     configure / hide) and its body as A2UI messages, drawn by AgentTile as
 *     a nested surface (assets/a2ui-sua.js).
 */
import {
  A2UI_PROTOCOL_VERSION,
  SUA_CATALOG_ID,
  boardDocAgentIds,
  boardDocSystemTileIds,
  validateBoardDoc,
  type BoardDoc,
} from '@some-useful-agents/core';
import { tileSurfaceMessages } from '../views/pulse-renderers.js';
import { normalizeSignal, TEMPLATE_REGISTRY } from '../views/pulse-templates.js';
import { resolveAutoPalette, tileRendersOwnRunControl } from '../views/pulse.js';
import { formatAge } from '../views/components.js';
import { computeTileGroups } from './pulse-groups.js';
import type { PulseTile } from '../views/pulse-types.js';

/** What AgentTile / SystemTile draw for one tile. */
export interface CanvasTileEntry {
  title: string;
  icon?: string;
  /** "3h ago" / "never"; `runHref` links it to the last run. */
  age: string;
  runHref?: string;
  /** The Run control in the footer: a button, a link to the run form (required inputs), or none (the body has one). */
  run: 'button' | 'link' | 'none';
  /** The body: A2UI messages, or a short note. */
  messages?: unknown[];
  empty?: string;
  unsupported?: string;
  /** The ⚙ configure modal's data (agents only). */
  configure?: { config: Record<string, unknown>; outputFields: unknown[] };
  /** Pulse: × hides the agent from Pulse (POST here). */
  hideAction?: string;
  /** Re-fetch the tile this often (the signal's `refresh`). */
  refreshMs?: number;
  autoPalette?: string;
  /** signal.accent: a coloured left edge (teal, blue, green, orange, red, purple). */
  accent?: string;
  /** The agent is archived: its tile stays, marked, with no Run (it won't run on a schedule either). */
  archived?: boolean;
}

/** `5m`, `2h`, `30s` → ms (0 = none). Same forms as the classic auto-refresh. */
export function refreshMs(value: string | undefined): number {
  const m = /^(\d+)(s|m|h)$/.exec((value ?? '').trim().toLowerCase());
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
}

/** One tile's registry entry. `isPulse` decides what × means. */
export function canvasTileEntry(tile: PulseTile, opts: { isPulse: boolean }): CanvasTileEntry {
  const isSystem = tile.agent.id.startsWith('_');
  const body = tileSurfaceMessages(tile);
  const needsInput = Object.values(tile.agent.inputs ?? {}).some((spec) => spec.required === true && spec.default === undefined);
  const { template, mapping } = normalizeSignal(tile.signal);
  const autoPalette = resolveAutoPalette(tile);
  const refresh = refreshMs(tile.signal.refresh);
  return {
    title: tile.signal.title,
    ...(tile.signal.icon ? { icon: tile.signal.icon } : {}),
    age: tile.lastRun ? formatAge(tile.lastRun.completedAt ?? tile.lastRun.startedAt) : isSystem ? '' : 'never',
    ...(tile.lastRun ? { runHref: `/runs/${encodeURIComponent(tile.lastRun.id)}` } : {}),
    run: isSystem || tileRendersOwnRunControl(tile) || tile.agent.status === 'archived' ? 'none' : needsInput ? 'link' : 'button',
    ...(tile.agent.status === 'archived' ? { archived: true } : {}),
    ...body,
    ...(isSystem ? {} : {
      configure: {
        config: {
          template,
          mapping,
          title: tile.signal.title,
          icon: tile.signal.icon ?? '',
          size: tile.signal.size ?? TEMPLATE_REGISTRY[template]?.defaultSize ?? '1x1',
          accent: tile.signal.accent ?? '',
          refresh: tile.signal.refresh ?? '',
        },
        outputFields: tile.outputFields ?? [],
      },
    }),
    ...(opts.isPulse && !isSystem ? { hideAction: `/agents/${encodeURIComponent(tile.agent.id)}/signal/toggle` } : {}),
    ...(refresh > 0 ? { refreshMs: Math.max(refresh, 10_000) } : {}),
    ...(autoPalette && autoPalette !== 'default' ? { autoPalette } : {}),
    ...(tile.signal.accent ? { accent: tile.signal.accent } : {}),
  };
}

export interface CanvasInput {
  boardId: string;
  doc: BoardDoc;
  tiles: Map<string, PulseTile>;
  /** Pulse: tiles the document doesn't place, shown in an "Everything else" section. */
  unplaced?: PulseTile[];
  systemTileIds?: string[];
}

/**
 * The board surface's messages and the tile registry. On Pulse, agents the
 * document doesn't place are added under "Everything else", grouped by recent
 * use in tabs (only the open tab draws, so a big Pulse stays cheap).
 */
export function assembleCanvas(input: CanvasInput): { messages: unknown[]; tiles: Record<string, CanvasTileEntry>; errors: string[] } {
  const isPulse = input.unplaced !== undefined;
  const components = input.doc.components.map((c) => ({ ...c }));
  const placed = new Set([...boardDocAgentIds(input.doc), ...boardDocSystemTileIds(input.doc)]);
  if (isPulse) {
    const rest = (input.unplaced ?? []).filter((t) => !placed.has(t.agent.id));
    if (rest.length) {
      const systemIds = (input.systemTileIds ?? []).filter((id) => rest.some((t) => t.agent.id === id));
      const groups = computeTileGroups(rest.filter((t) => !systemIds.includes(t.agent.id)), systemIds);
      const tabs = groups.map((g) => {
        const gridId = `rest_grid_${g.id}`;
        components.push({
          id: gridId,
          component: 'Grid',
          children: g.tiles.map((tileId) => {
            const leaf = `rest_tile_${tileId}`;
            components.push(tileId.startsWith('_')
              ? { id: leaf, component: 'SystemTile', tileId }
              : { id: leaf, component: 'AgentTile', agentId: tileId });
            // A tile that prefers two columns (2x1 / 2x2) gets them here too.
            const t = input.tiles.get(tileId);
            const size = t ? (t.layoutHint?.size ?? t.signal.size ?? TEMPLATE_REGISTRY[normalizeSignal(t.signal).template]?.defaultSize) : undefined;
            if (!size?.startsWith('2')) return leaf;
            components.push({ id: `rest_cell_${tileId}`, component: 'Cell', child: leaf, span: 2 });
            return `rest_cell_${tileId}`;
          }),
        });
        return { title: `${g.label} (${g.tiles.length})`, child: gridId };
      });
      components.push({ id: 'rest_tabs', component: 'Tabs', tabs });
      components.push({ id: 'rest', component: 'Section', title: 'Everything else', child: 'rest_tabs' });
      const root = components.find((c) => c.id === 'root');
      if (root && Array.isArray(root.children)) root.children = [...(root.children as string[]), 'rest'];
    }
  }
  const v = validateBoardDoc({ components });
  const final = v.ok ? v.doc.components : input.doc.components;
  const tiles: Record<string, CanvasTileEntry> = {};
  for (const c of final) {
    const id = c.component === 'AgentTile' ? c.agentId : c.component === 'SystemTile' ? c.tileId : undefined;
    if (typeof id !== 'string' || tiles[id]) continue;
    const tile = input.tiles.get(id);
    if (tile) tiles[id] = canvasTileEntry(tile, { isPulse });
  }
  const surfaceId = `board-${input.boardId}`;
  return {
    messages: [
      { version: A2UI_PROTOCOL_VERSION, createSurface: { surfaceId, catalogId: SUA_CATALOG_ID } },
      { version: A2UI_PROTOCOL_VERSION, updateComponents: { surfaceId, components: final } },
    ],
    tiles,
    errors: v.ok ? [] : v.errors,
  };
}
