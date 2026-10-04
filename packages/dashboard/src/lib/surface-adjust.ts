/**
 * Changing a surface through sua (goal surfaces S5): sua proposes surface ops
 * as an `adjust-surface` card; this reads them, says what they'd change in
 * plain words (before → after, including what moves to the top), and gives
 * triage a compact picture of Home to propose against.
 */
import {
  applySurfaceOps, compileSurface, surfaceOpSchema,
  type CompiledSurface, type Item, type SurfaceOp,
} from '@some-useful-agents/core';
import type { HomeSurface } from './home-surface.js';

/** OPS as sua sends it: a JSON array (or one op), validated against the op vocabulary. */
export function parseSurfaceOps(raw: string): { ops?: SurfaceOp[]; error?: string } {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { error: 'OPS is not JSON.' }; }
  const list = Array.isArray(v) ? v : [v];
  if (list.length === 0) return { error: 'OPS is empty.' };
  if (list.length > 20) return { error: 'At most 20 ops at a time.' };
  const ops: SurfaceOp[] = [];
  for (const [i, o] of list.entries()) {
    const p = surfaceOpSchema.safeParse(o);
    if (!p.success) return { error: `Op ${String(i + 1)} isn't valid: ${p.error.issues[0]?.message ?? 'unknown shape'}.` };
    ops.push(p.data);
  }
  return { ops };
}

const q = (s: string) => `“${s}”`;

function describeOp(op: SurfaceOp, title: (id: string) => string, goal: string): { what: string; before: string; after: string } {
  switch (op.op) {
    case 'setGoal': return { what: 'Goal', before: goal || '(none)', after: op.goal };
    case 'addRule': {
      const r = op.rule;
      const label = r.label ?? r.id;
      const verb = r.type === 'promote' ? 'first' : r.type === 'hide' ? 'hidden' : r.type === 'collapse' ? 'folded' : r.type === 'group' ? 'grouped' : r.type === 'filter' ? 'only these' : 'drawn differently';
      return { what: 'New rule', before: '—', after: `${label} (${verb})` };
    }
    case 'removeRule': return { what: 'Rule', before: op.ruleId, after: 'removed' };
    case 'pin': return { what: 'Pin', before: '—', after: `${q(title(op.itemId))} at the top` };
    case 'unpin': return { what: 'Unpin', before: '—', after: `${q(title(op.itemId))} back in order` };
    case 'rank': return { what: 'Move', before: '—', after: `${q(title(op.itemId))} to place ${String(op.position + 1)}` };
    case 'hide': return { what: 'Hide', before: '—', after: `${q(title(op.itemId))} hidden from Home` };
    case 'show': return { what: 'Show', before: '—', after: `${q(title(op.itemId))} back on Home` };
    case 'group': return { what: 'Group', before: op.itemIds.map(title).join(', '), after: q(op.label) };
    case 'ungroup': return { what: 'Ungroup', before: q(op.label), after: 'separate again' };
    case 'expand': return { what: 'Unfold', before: '—', after: q(title(op.itemId)) };
    case 'collapse': return { what: 'Fold', before: '—', after: q(title(op.itemId)) };
    case 'represent': return { what: 'Draw as', before: 'default', after: op.primitive };
    case 'addRegion': return { what: 'New section', before: '—', after: op.region.title };
    case 'removeRegion': return { what: 'Remove section', before: op.regionId, after: 'removed' };
    case 'moveRegion': return { what: 'Move section', before: op.regionId, after: `place ${String(op.index + 1)}` };
    case 'renameRegion': return { what: 'Rename section', before: op.regionId, after: op.title };
  }
}

/** The first few of a region, as titles. */
function top(c: CompiledSurface, regionId: string, n = 3): string {
  const r = c.regions.find((x) => x.id === regionId);
  const t = (r?.entries ?? []).filter((e) => !e.collapsed).slice(0, n).map((e) => e.item.title);
  return t.length ? t.join(' · ') : '(nothing)';
}

/**
 * What applying `ops` to Home would change, in plain words: each op, then the
 * effect (what leads Needs you, how many are hidden). Throws on an op the
 * surface refuses (e.g. an unknown region).
 */
export function previewSurfaceChange(home: HomeSurface, ops: SurfaceOp[]): Array<{ what: string; before: string; after: string }> {
  const titles = new Map(home.items.map((i) => [i.id, i.title]));
  const title = (id: string) => titles.get(id) ?? id;
  const next = applySurfaceOps(home.doc, ops, 'user-conversation');
  const after = compileSurface(next, home.items);
  const out = ops.map((op) => describeOp(op, title, home.doc.goal));
  const beforeTop = top(home.compiled, 'needs-you');
  const afterTop = top(after, 'needs-you');
  if (beforeTop !== afterTop) out.push({ what: 'Top of Needs you', before: beforeTop, after: afterTop });
  const hb = home.compiled.hidden.length;
  const ha = after.hidden.length;
  if (hb !== ha) out.push({ what: 'Hidden from Home', before: String(hb), after: String(ha) });
  return out;
}

/** Home as triage sees it: goal, sections, rules, and the items on it (ids to use in ops). */
export function describeHomeForTriage(home: HomeSurface, maxItems = 20): string {
  const items: Array<Pick<Item, 'id' | 'kind' | 'title'> & { region: string; pinned?: true; folded?: true }> = [];
  for (const r of home.compiled.regions) {
    for (const e of r.entries) {
      if (items.length >= maxItems) break;
      items.push({ id: e.item.id, kind: e.item.kind, title: e.item.title.slice(0, 80), region: r.id, ...(e.pinned ? { pinned: true as const } : {}), ...(e.collapsed ? { folded: true as const } : {}) });
    }
  }
  return JSON.stringify({
    surface: 'home',
    version: home.version,
    goal: home.goal,
    regions: home.doc.regions.map((r) => ({ id: r.id, title: r.title })),
    rules: home.doc.rules.map((r) => ({ id: r.id, type: r.type, label: r.label ?? r.id, match: r.match })),
    pins: home.doc.overrides.filter((o) => o.type === 'pin').map((o) => o.itemId),
    hidden: home.compiled.hidden.filter((h) => h.by).map((h) => h.itemId),
    items,
  });
}
