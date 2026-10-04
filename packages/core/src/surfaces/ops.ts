/**
 * applySurfaceOps: the only way a surface changes (ADR-0049). A gesture, sua
 * (after you apply its preview) and an agent all send the same ops; the
 * result is validated and every rule / override it adds is stamped with who
 * and when, so the surface can say why something is where it is.
 *
 * Stable anchors: ops that add, remove, move or rename regions change the
 * surface's structure. You can make them; an agent or the system can only
 * propose them (`SurfaceNeedsApproval`) until you approve.
 */
import {
  surfaceDocSchema, surfaceOpSchema, actorSchema, STRUCTURAL_OPS,
  type SurfaceDoc, type SurfaceOp, type SurfaceActor, type SurfaceOverride,
} from './schema.js';

export class SurfaceOpError extends Error {
  constructor(message: string) { super(message); this.name = 'SurfaceOpError'; }
}

/** Structural ops from an agent or the system: they wait for you. */
export class SurfaceNeedsApproval extends Error {
  constructor(readonly ops: SurfaceOp[], readonly actor: SurfaceActor) {
    super(`${actor} wants to change the surface's regions (${ops.map((o) => o.op).join(', ')}); that waits for your approval.`);
    this.name = 'SurfaceNeedsApproval';
  }
}

/** You, directly or through sua: may change structure. */
export function actsForUser(actor: SurfaceActor): boolean {
  return actor === 'user' || actor === 'user-conversation';
}

export function applySurfaceOps(
  doc: SurfaceDoc,
  rawOps: readonly unknown[],
  rawActor: unknown,
  opts: { approved?: boolean; now?: Date } = {},
): SurfaceDoc {
  const actor = actorSchema.parse(rawActor);
  const ops = rawOps.map((o, i) => {
    const parsed = surfaceOpSchema.safeParse(o);
    if (!parsed.success) throw new SurfaceOpError(`Op ${String(i + 1)} isn't valid: ${parsed.error.issues[0]?.message ?? 'unknown shape'}.`);
    return parsed.data;
  });
  if (ops.length === 0) throw new SurfaceOpError('No ops to apply.');
  const structural = ops.filter((o) => STRUCTURAL_OPS.has(o.op));
  if (structural.length > 0 && !actsForUser(actor) && !opts.approved) throw new SurfaceNeedsApproval(structural, actor);

  const stamp = { by: actor, at: (opts.now ?? new Date()).toISOString() };
  const next: SurfaceDoc = structuredClone(doc);
  const dropOverrides = (pred: (o: SurfaceOverride) => boolean) => { next.overrides = next.overrides.filter((o) => !pred(o)); };
  const regionIndex = (id: string): number => {
    const i = next.regions.findIndex((r) => r.id === id);
    if (i < 0) throw new SurfaceOpError(`There's no region "${id}".`);
    return i;
  };

  for (const op of ops) {
    switch (op.op) {
      case 'setGoal':
        next.goal = op.goal.trim();
        break;
      case 'addRule': {
        if (op.rule.type === 'filter' && op.rule.region) regionIndex(op.rule.region);
        // Same id replaces: re-sending a rule is how you edit it.
        next.rules = next.rules.filter((r) => r.id !== op.rule.id);
        next.rules.push({ ...op.rule, ...stamp });
        break;
      }
      case 'removeRule':
        if (!next.rules.some((r) => r.id === op.ruleId)) throw new SurfaceOpError(`There's no rule "${op.ruleId}".`);
        next.rules = next.rules.filter((r) => r.id !== op.ruleId);
        break;
      case 'pin':
        if (op.region) regionIndex(op.region);
        dropOverrides((o) => (o.type === 'pin' || o.type === 'hide' || o.type === 'rank') && o.itemId === op.itemId);
        next.overrides.push({ type: 'pin', itemId: op.itemId, ...(op.region ? { region: op.region } : {}), ...stamp });
        break;
      case 'unpin':
        dropOverrides((o) => o.type === 'pin' && o.itemId === op.itemId);
        break;
      case 'rank':
        dropOverrides((o) => (o.type === 'rank' || o.type === 'pin' || o.type === 'hide') && o.itemId === op.itemId);
        next.overrides.push({ type: 'rank', itemId: op.itemId, position: op.position, ...stamp });
        break;
      case 'group': {
        const ids = [...new Set(op.itemIds)];
        if (ids.length < 2) throw new SurfaceOpError('A group needs at least two items.');
        // An item is in one of your groups at a time; a group with the same label is replaced.
        next.overrides = next.overrides
          .map((o) => (o.type === 'group' ? { ...o, itemIds: o.itemIds.filter((id) => !ids.includes(id)) } : o))
          .filter((o) => !(o.type === 'group' && (o.label === op.label || o.itemIds.length < 2)));
        next.overrides.push({ type: 'group', label: op.label, itemIds: ids, ...stamp });
        break;
      }
      case 'ungroup':
        if (!next.overrides.some((o) => o.type === 'group' && o.label === op.label)) throw new SurfaceOpError(`There's no group "${op.label}".`);
        dropOverrides((o) => o.type === 'group' && o.label === op.label);
        break;
      case 'hide':
        dropOverrides((o) => (o.type === 'pin' || o.type === 'rank' || o.type === 'hide') && o.itemId === op.itemId);
        next.overrides.push({ type: 'hide', itemId: op.itemId, ...stamp });
        break;
      case 'show':
        dropOverrides((o) => o.type === 'hide' && o.itemId === op.itemId);
        break;
      case 'expand':
      case 'collapse':
        dropOverrides((o) => (o.type === 'expand' || o.type === 'collapse') && o.itemId === op.itemId);
        next.overrides.push({ type: op.op, itemId: op.itemId, ...stamp });
        break;
      case 'represent': {
        const id = op.ruleId ?? `represent-${String(next.rules.filter((r) => r.type === 'represent').length + 1)}`;
        next.rules = next.rules.filter((r) => r.id !== id);
        next.rules.push({ id, type: 'represent', match: op.match, primitive: op.primitive, ...stamp });
        break;
      }
      case 'addRegion': {
        if (next.regions.some((r) => r.id === op.region.id)) throw new SurfaceOpError(`There's already a region "${op.region.id}".`);
        const at = Math.min(op.index ?? next.regions.length, next.regions.length);
        next.regions.splice(at, 0, op.region);
        break;
      }
      case 'removeRegion': {
        const i = regionIndex(op.regionId);
        if (next.regions.length === 1) throw new SurfaceOpError('A surface keeps at least one region.');
        next.regions.splice(i, 1);
        // Pins into it fall back to the item's own region; region filters for it go.
        next.overrides = next.overrides.map((o) => (o.type === 'pin' && o.region === op.regionId ? { type: 'pin', itemId: o.itemId, ...(o.by ? { by: o.by } : {}), ...(o.at ? { at: o.at } : {}) } : o));
        next.rules = next.rules.filter((r) => !(r.type === 'filter' && r.region === op.regionId));
        break;
      }
      case 'moveRegion': {
        const i = regionIndex(op.regionId);
        const [r] = next.regions.splice(i, 1);
        next.regions.splice(Math.min(op.index, next.regions.length), 0, r);
        break;
      }
      case 'renameRegion':
        next.regions[regionIndex(op.regionId)].title = op.title;
        break;
    }
  }

  const checked = surfaceDocSchema.safeParse(next);
  if (!checked.success) throw new SurfaceOpError(checked.error.issues[0]?.message ?? 'The result is not a valid surface.');
  return checked.data;
}
