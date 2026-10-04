/**
 * The surface document (ADR-0049, layer 2): what a surface emphasizes now.
 * It names regions (stable anchors: they keep their place unless you move
 * them), declarative rules evaluated against items, and your item-level
 * overrides (pin, rank, group, hide, expand). It never holds item data;
 * items are read fresh each time (items/).
 */
import { z } from 'zod';
import { ITEM_KINDS } from '../items/types.js';

const URGENCIES = ['critical', 'high', 'normal', 'low'] as const;
const STATES = ['open', 'waiting', 'in-progress', 'ok'] as const;
const SOURCES = ['inbox', 'questions', 'runs', 'outcomes', 'scheduler', 'board-builds', 'agents', 'notebooks'] as const;

/** Which items a region or rule applies to. Every given field must match; an empty match is everything. */
export const itemMatchSchema = z.object({
  kinds: z.array(z.enum(ITEM_KINDS)).optional(),
  urgencies: z.array(z.enum(URGENCIES)).optional(),
  states: z.array(z.enum(STATES)).optional(),
  sources: z.array(z.enum(SOURCES)).optional(),
  agentIds: z.array(z.string().min(1)).optional(),
  /** Item id prefix, e.g. `agent:` or `thread:`. */
  idPrefix: z.string().min(1).optional(),
  itemIds: z.array(z.string().min(1)).optional(),
}).strict();
export type ItemMatch = z.infer<typeof itemMatchSchema>;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Who added a rule or override, and when: stamped by applySurfaceOps, used to say why. */
const STAMP = { by: z.string().optional(), at: z.string().optional() };

/** A named place on the surface. Items land in the first region whose match fits. */
export const regionSchema = z.object({
  id: z.string().regex(ID_RE),
  title: z.string().min(1).max(60),
  match: itemMatchSchema,
  /** Show at most this many; the rest are counted as "N more". */
  limit: z.number().int().min(1).max(200).optional(),
}).strict();
export type Region = z.infer<typeof regionSchema>;

/** Primitives the presentation layer knows how to draw (S3 maps them to A2UI). */
export const PRIMITIVES = ['row', 'card', 'metric', 'status', 'alert', 'timeline', 'table', 'evidence'] as const;
export type Primitive = typeof PRIMITIVES[number];

export const ruleSchema = z.discriminatedUnion('type', [
  /** Leave matching items out of the surface (they stay in their stores). */
  z.object({ id: z.string().regex(ID_RE), type: z.literal('hide'), match: itemMatchSchema, label: z.string().max(120).optional(), ...STAMP }).strict(),
  /** Show only matching items in a region (or everywhere). */
  z.object({ id: z.string().regex(ID_RE), type: z.literal('filter'), match: itemMatchSchema, region: z.string().regex(ID_RE).optional(), label: z.string().max(120).optional(), ...STAMP }).strict(),
  /** Matching items first within their region, in rule order. */
  z.object({ id: z.string().regex(ID_RE), type: z.literal('promote'), match: itemMatchSchema, label: z.string().max(120).optional(), ...STAMP }).strict(),
  /** Group matching items in their region by kind, agent or source. */
  z.object({ id: z.string().regex(ID_RE), type: z.literal('group'), match: itemMatchSchema, groupBy: z.enum(['kind', 'agent', 'source']), label: z.string().max(120).optional(), ...STAMP }).strict(),
  /** Matching items show folded until you expand them. */
  z.object({ id: z.string().regex(ID_RE), type: z.literal('collapse'), match: itemMatchSchema, label: z.string().max(120).optional(), ...STAMP }).strict(),
  /** Draw matching items with a given primitive. */
  z.object({ id: z.string().regex(ID_RE), type: z.literal('represent'), match: itemMatchSchema, primitive: z.enum(PRIMITIVES), label: z.string().max(120).optional(), ...STAMP }).strict(),
]);
export type SurfaceRule = z.infer<typeof ruleSchema>;

export const overrideSchema = z.discriminatedUnion('type', [
  /** Keep this item at the top (of `region`, or its own). Pins keep the order they were made in. */
  z.object({ type: z.literal('pin'), itemId: z.string().min(1), region: z.string().regex(ID_RE).optional(), ...STAMP }).strict(),
  /** Put this item at `position` (0 = first after pins) in its region. */
  z.object({ type: z.literal('rank'), itemId: z.string().min(1), position: z.number().int().min(0).max(999), ...STAMP }).strict(),
  /** Show these items together under `label`. */
  z.object({ type: z.literal('group'), label: z.string().min(1).max(60), itemIds: z.array(z.string().min(1)).min(2), ...STAMP }).strict(),
  z.object({ type: z.literal('hide'), itemId: z.string().min(1), ...STAMP }).strict(),
  z.object({ type: z.literal('expand'), itemId: z.string().min(1), ...STAMP }).strict(),
  z.object({ type: z.literal('collapse'), itemId: z.string().min(1), ...STAMP }).strict(),
]);
export type SurfaceOverride = z.infer<typeof overrideSchema>;

export const surfaceDocSchema = z.object({
  /** e.g. "only things that could change what I do today" */
  goal: z.string().max(280),
  regions: z.array(regionSchema).min(1).max(12),
  rules: z.array(ruleSchema).max(50),
  overrides: z.array(overrideSchema).max(500),
}).strict().superRefine((doc, ctx) => {
  const seen = new Set<string>();
  for (const r of doc.regions) {
    if (seen.has(r.id)) ctx.addIssue({ code: 'custom', message: `Two regions are called "${r.id}".`, path: ['regions'] });
    seen.add(r.id);
  }
  const rules = new Set<string>();
  for (const r of doc.rules) {
    if (rules.has(r.id)) ctx.addIssue({ code: 'custom', message: `Two rules are called "${r.id}".`, path: ['rules'] });
    rules.add(r.id);
  }
});
export type SurfaceDoc = z.infer<typeof surfaceDocSchema>;

/**
 * Who changed a surface. `user` = you, directly (a gesture or a form);
 * `user-conversation` = you, through sua (you applied its preview);
 * `agent:<id>` / `system` = on their own, so structural changes wait for you.
 */
export const actorSchema = z.union([
  z.literal('user'),
  z.literal('user-conversation'),
  z.literal('system'),
  z.string().regex(/^agent:[a-z0-9][a-z0-9-]*$/),
]);
export type SurfaceActor = z.infer<typeof actorSchema>;

/** The one vocabulary for changing a surface: gestures, sua and agents all speak it. */
export const surfaceOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setGoal'), goal: z.string().max(280) }).strict(),
  z.object({ op: z.literal('addRule'), rule: ruleSchema }).strict(),
  z.object({ op: z.literal('removeRule'), ruleId: z.string() }).strict(),
  z.object({ op: z.literal('pin'), itemId: z.string().min(1), region: z.string().regex(ID_RE).optional() }).strict(),
  z.object({ op: z.literal('unpin'), itemId: z.string().min(1) }).strict(),
  z.object({ op: z.literal('rank'), itemId: z.string().min(1), position: z.number().int().min(0).max(999) }).strict(),
  z.object({ op: z.literal('group'), label: z.string().min(1).max(60), itemIds: z.array(z.string().min(1)).min(2) }).strict(),
  z.object({ op: z.literal('ungroup'), label: z.string().min(1) }).strict(),
  z.object({ op: z.literal('hide'), itemId: z.string().min(1) }).strict(),
  z.object({ op: z.literal('show'), itemId: z.string().min(1) }).strict(),
  z.object({ op: z.literal('expand'), itemId: z.string().min(1) }).strict(),
  z.object({ op: z.literal('collapse'), itemId: z.string().min(1) }).strict(),
  z.object({ op: z.literal('represent'), match: itemMatchSchema, primitive: z.enum(PRIMITIVES), ruleId: z.string().regex(ID_RE).optional() }).strict(),
  // Structural: these change the regions themselves (stable anchors).
  z.object({ op: z.literal('addRegion'), region: regionSchema, index: z.number().int().min(0).optional() }).strict(),
  z.object({ op: z.literal('removeRegion'), regionId: z.string() }).strict(),
  z.object({ op: z.literal('moveRegion'), regionId: z.string(), index: z.number().int().min(0) }).strict(),
  z.object({ op: z.literal('renameRegion'), regionId: z.string(), title: z.string().min(1).max(60) }).strict(),
]);
export type SurfaceOp = z.infer<typeof surfaceOpSchema>;

export const STRUCTURAL_OPS: ReadonlySet<SurfaceOp['op']> = new Set(['addRegion', 'removeRegion', 'moveRegion', 'renameRegion']);
