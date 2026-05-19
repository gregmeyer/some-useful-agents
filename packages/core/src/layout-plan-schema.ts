/**
 * Schema for the structured plan emitted by the layout-planner agent.
 *
 * The Pulse layout wizard sends current-state + focus → planner returns
 * a LayoutPlan → wizard renders top agents, containers, and clarifying
 * questions → user accepts → client writes the proposed containers to
 * localStorage (`sua-pulse-layout`).
 *
 * Validation runs server-side after extracting the plan JSON from the
 * planner's `<plan>…</plan>` wrapper. Loose enough to absorb LLM noise
 * (optional fields default to []), strict enough to catch obvious
 * structural lies (tiles referencing agents that aren't in topAgents,
 * empty containers, etc.).
 *
 * Parallel to `build-plan-schema.ts`. The two planners share the same
 * `<plan>…</plan>` wrapper convention and the same `extractPlanJson()`
 * helper from `build-plan-schema.ts`.
 */

import { z } from 'zod';

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
/**
 * Tile ids include both real agent ids AND system tiles (Pulse's synthetic
 * widgets: `_system-runs-today`, `_system-failure-rate`, etc.). System
 * tiles use a leading underscore. Containers reference both kinds, so the
 * tile regex permits one optional leading underscore.
 */
const TILE_ID_RE = /^_?[a-z0-9][a-z0-9_-]*$/;

export const SIGNAL_SIZES = ['1x1', '2x1', '1x2', '2x2'] as const;
export type SignalSize = typeof SIGNAL_SIZES[number];

export const layoutPlanSchema = z.object({
  summary: z.string().min(1, 'summary is required'),

  /**
   * Ranked list of agents the planner thinks should be most prominent.
   * Order matters — index 0 is the most important. Each entry has a
   * one-line rationale so the UI can render "why this one".
   */
  topAgents: z.array(z.object({
    id: z.string().regex(AGENT_ID_RE, 'topAgents.id must be lowercase_with_dashes_or_underscores'),
    rationale: z.string().min(1, 'topAgents.rationale is required'),
    suggestedSize: z.enum(SIGNAL_SIZES).optional(),
  })).min(1, 'topAgents must have at least one entry'),

  /**
   * Proposed container layout for `sua-pulse-layout`. Each container
   * groups one or more tiles under a label. Order matters — index 0
   * is the topmost container.
   */
  containers: z.array(z.object({
    label: z.string().min(1, 'containers.label is required'),
    tiles: z.array(z.string().regex(TILE_ID_RE, 'containers.tiles[] must be a valid tile id (agent id, or system tile starting with "_")'))
      .min(1, 'containers.tiles must have at least one entry'),
  })).min(1, 'layout must have at least one container'),

  /**
   * Post-plan clarifying questions. Same shape as build-planner's
   * questions[]. The UI renders them with optional answer textareas;
   * answered questions are appended to the FOCUS context and the
   * planner is re-run.
   */
  questions: z.array(z.object({
    text: z.string().min(1),
    suggestedAnswer: z.string().optional(),
    /** When set, render as a select instead of a free-form textarea. */
    options: z.array(z.string().min(1)).optional(),
  })).default([]),

  /**
   * Installed-but-not-yet-on-this-surface agents the planner is bringing
   * onto the surface. Declarative signal — the commit step also infers
   * the same agents from container membership, so this field is for UI
   * affordance ("Will add N agents") and contract clarity. Every id here
   * MUST also appear in some container's `tiles[]`.
   */
  toAdd: z.array(z.string().regex(AGENT_ID_RE, 'toAdd[] must be a valid agent id'))
    .default([]),
}).superRefine((plan, ctx) => {
  // Tiles must reference agents declared in topAgents OR be marked as
  // additional context (full agent metadata reaches the planner; the
  // planner may include lower-ranked agents in containers without
  // promoting them to topAgents). So we don't enforce containment here.
  // What we DO enforce: no tile appears in two containers (a tile
  // belongs to exactly one container, matching the localStorage shape).
  const seenTiles = new Map<string, number>();
  plan.containers.forEach((c, cIdx) => {
    c.tiles.forEach((tile, tIdx) => {
      const prev = seenTiles.get(tile);
      if (prev !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['containers', cIdx, 'tiles', tIdx],
          message: `tile "${tile}" appears in containers[${prev}] and containers[${cIdx}] — each tile belongs to exactly one container`,
        });
      } else {
        seenTiles.set(tile, cIdx);
      }
    });
  });

  // Container labels must be unique — duplicates would collide in
  // localStorage container ids derived from the label.
  const seenLabels = new Map<string, number>();
  plan.containers.forEach((c, cIdx) => {
    const key = c.label.toLowerCase().trim();
    const prev = seenLabels.get(key);
    if (prev !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['containers', cIdx, 'label'],
        message: `container label "${c.label}" duplicates containers[${prev}].label (case-insensitive)`,
      });
    } else {
      seenLabels.set(key, cIdx);
    }
  });

  // topAgents ids must be unique.
  const seenAgents = new Map<string, number>();
  plan.topAgents.forEach((a, aIdx) => {
    const prev = seenAgents.get(a.id);
    if (prev !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['topAgents', aIdx, 'id'],
        message: `topAgents[${aIdx}].id "${a.id}" duplicates topAgents[${prev}].id`,
      });
    } else {
      seenAgents.set(a.id, aIdx);
    }
  });

  // toAdd entries must be unique AND must be placed in some container —
  // declaring an agent in toAdd but not placing it would leave it
  // unsurfaced even though the planner said it wanted to add it.
  const seenToAdd = new Map<string, number>();
  plan.toAdd.forEach((id, idx) => {
    const prev = seenToAdd.get(id);
    if (prev !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toAdd', idx],
        message: `toAdd[${idx}] "${id}" duplicates toAdd[${prev}]`,
      });
      return;
    }
    seenToAdd.set(id, idx);
    if (!seenTiles.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toAdd', idx],
        message: `toAdd[${idx}] "${id}" is not placed in any container — every added agent must be assigned to a container`,
      });
    }
  });
});

export type LayoutPlanInput = z.input<typeof layoutPlanSchema>;
export type LayoutPlan = z.output<typeof layoutPlanSchema>;
