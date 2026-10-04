/**
 * compileSurface: surface document + items → what to show, in order, and why
 * (ADR-0049, layer 3's input). Deterministic and pure: the same doc and items
 * always give the same result. S3 turns this view model into A2UI.
 *
 * Precedence, within a region: your pins, then your ranks, then rules
 * (promote, in rule order), then the items' own order (most urgent first).
 * Regions never move here: only an op moves a region.
 */
import type { Item } from '../items/types.js';
import type { ItemMatch, Primitive, SurfaceDoc, SurfaceRule } from './schema.js';

export interface CompiledEntry {
  item: Item;
  /** Why it's here and where it is, in plain words, most important first. */
  reasons: string[];
  pinned: boolean;
  collapsed: boolean;
  primitive: Primitive;
  /** Shown together with the other entries carrying the same label. */
  group?: string;
}

export interface CompiledRegion {
  id: string;
  title: string;
  entries: CompiledEntry[];
  /** Items past the region's limit. */
  more: number;
}

export interface CompiledSurface {
  goal: string;
  regions: CompiledRegion[];
  /** Items left out, and why (for "why isn't X here?"). */
  hidden: Array<{ itemId: string; reason: string }>;
}

export function matches(item: Item, m: ItemMatch): boolean {
  return (!m.kinds || m.kinds.includes(item.kind))
    && (!m.urgencies || m.urgencies.includes(item.urgency))
    && (!m.states || m.states.includes(item.state))
    && (!m.sources || m.sources.includes(item.provenance.source))
    && (!m.agentIds || (item.subject.agentId !== undefined && m.agentIds.includes(item.subject.agentId)))
    && (!m.idPrefix || item.id.startsWith(m.idPrefix))
    && (!m.itemIds || m.itemIds.includes(item.id));
}

const DEFAULT_PRIMITIVE: Partial<Record<Item['kind'], Primitive>> = {
  metric: 'metric', status: 'status', alert: 'alert', progress: 'timeline', evidence: 'evidence',
};

const KIND_PLURAL: Record<Item['kind'], string> = {
  fact: 'Facts', metric: 'Numbers', status: 'Status', alert: 'Problems', question: 'Questions',
  decision: 'Decisions', action: 'Actions', progress: 'In progress', evidence: 'Evidence', collection: 'Collections',
};

/** "by you, Oct 3" / "by sua" / "by agent news" / "by default". */
export function whoWhen(by?: string, at?: string, timeZone?: string): string {
  const who = !by ? 'by default'
    : by === 'user' ? 'by you'
      : by === 'user-conversation' ? 'by you, through sua'
        : by === 'system' ? 'by sua'
          : `by ${by.replace(/^agent:/, 'agent ')}`;
  if (!at) return who;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? who : `${who}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(timeZone ? { timeZone } : {}) })}`;
}

const ruleName = (r: SurfaceRule): string => r.label ?? r.id;
const whoWhenIn = whoWhen;

/** `timeZone` dates the reasons ("by you, Oct 3"); default: this machine's. */
export function compileSurface(doc: SurfaceDoc, items: readonly Item[], opts: { timeZone?: string } = {}): CompiledSurface {
  const whoWhen = (by?: string, at?: string): string => whoWhenIn(by, at, opts.timeZone);
  const hidden: CompiledSurface['hidden'] = [];
  const pins = doc.overrides.filter((o) => o.type === 'pin');
  const ranks = doc.overrides.filter((o) => o.type === 'rank');
  const hides = new Map(doc.overrides.filter((o) => o.type === 'hide').map((o) => [o.itemId, o]));
  const expanded = new Set(doc.overrides.filter((o) => o.type === 'expand').map((o) => o.itemId));
  const collapsedByYou = new Map(doc.overrides.filter((o) => o.type === 'collapse').map((o) => [o.itemId, o]));
  const userGroups = doc.overrides.filter((o) => o.type === 'group');
  const rules = (t: SurfaceRule['type']) => doc.rules.filter((r) => r.type === t);

  // 1. Hidden, then 2. which region.
  const byRegion = new Map<string, Item[]>(doc.regions.map((r) => [r.id, []]));
  for (const item of items) {
    const hide = hides.get(item.id);
    if (hide) { hidden.push({ itemId: item.id, reason: `Hidden ${whoWhen(hide.by, hide.at)}` }); continue; }
    const hideRule = rules('hide').find((r) => matches(item, r.match));
    if (hideRule) { hidden.push({ itemId: item.id, reason: `Hidden by the rule "${ruleName(hideRule)}" (${whoWhen(hideRule.by, hideRule.at)})` }); continue; }
    const pin = pins.find((p) => p.itemId === item.id);
    const region = (pin?.region && doc.regions.find((r) => r.id === pin.region)) || doc.regions.find((r) => matches(item, r.match));
    if (!region) { hidden.push({ itemId: item.id, reason: 'No region shows this kind of item' }); continue; }
    // 3. Filter rules: in a region with any, an item must match one of them.
    const filters = rules('filter').filter((r) => r.type === 'filter' && (!r.region || r.region === region.id));
    if (!pin && filters.length > 0 && !filters.some((r) => matches(item, r.match))) {
      hidden.push({ itemId: item.id, reason: `Not shown in ${region.title}: it doesn't match "${filters.map(ruleName).join('" or "')}"` });
      continue;
    }
    byRegion.get(region.id)!.push(item);
  }

  const regions: CompiledRegion[] = doc.regions.map((region) => {
    const inRegion = byRegion.get(region.id)!;
    const baseIndex = new Map(inRegion.map((it, i) => [it.id, i]));
    const promoteRank = (it: Item): number => {
      const i = rules('promote').findIndex((r) => matches(it, r.match));
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    // 4. Order: pins (in the order made), then the rest by promote rule then own order; then ranks placed.
    const pinned = pins.filter((p) => baseIndex.has(p.itemId)).map((p) => inRegion.find((it) => it.id === p.itemId)!);
    const pinnedIds = new Set(pinned.map((it) => it.id));
    const rankFor = new Map(ranks.filter((r) => baseIndex.has(r.itemId) && !pinnedIds.has(r.itemId)).map((r) => [r.itemId, r]));
    const rest = inRegion
      .filter((it) => !pinnedIds.has(it.id) && !rankFor.has(it.id))
      .sort((a, b) => promoteRank(a) - promoteRank(b) || baseIndex.get(a.id)! - baseIndex.get(b.id)!);
    const ranked = [...rankFor.values()].sort((a, b) => a.position - b.position || baseIndex.get(a.itemId)! - baseIndex.get(b.itemId)!);
    for (const r of ranked) rest.splice(Math.min(r.position, rest.length), 0, inRegion.find((it) => it.id === r.itemId)!);
    let ordered = [...pinned, ...rest];

    // 5. Groups: yours first, then group rules; members gather at the first member's place.
    const groupOf = new Map<string, string>();
    for (const g of userGroups) for (const id of g.itemIds) if (baseIndex.has(id)) groupOf.set(id, g.label);
    for (const r of rules('group')) {
      if (r.type !== 'group') continue;
      for (const it of ordered) {
        if (groupOf.has(it.id) || !matches(it, r.match)) continue;
        const label = r.groupBy === 'kind' ? KIND_PLURAL[it.kind] : r.groupBy === 'agent' ? (it.subject.agentId ?? 'Other') : it.provenance.source;
        groupOf.set(it.id, label);
      }
    }
    // A group needs two members to be a group.
    const counts = new Map<string, number>();
    for (const label of groupOf.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
    for (const [id, label] of groupOf) if ((counts.get(label) ?? 0) < 2) groupOf.delete(id);
    if (groupOf.size > 0) {
      const firstAt = new Map<string, number>();
      ordered.forEach((it, i) => { const g = groupOf.get(it.id); if (g && !firstAt.has(g)) firstAt.set(g, i); });
      ordered = ordered
        .map((it, i) => ({ it, key: groupOf.has(it.id) ? firstAt.get(groupOf.get(it.id)!)! : i, i }))
        .sort((a, b) => a.key - b.key || a.i - b.i)
        .map((x) => x.it);
    }

    // 6–8. Collapse, primitive, reasons; then the region's limit (pins are never cut).
    const entries: CompiledEntry[] = ordered.map((item) => {
      const reasons: string[] = [];
      const pin = pins.find((p) => p.itemId === item.id);
      if (pin) reasons.push(`Pinned ${whoWhen(pin.by, pin.at)}`);
      const rank = rankFor.get(item.id);
      if (rank) reasons.push(`Placed here ${whoWhen(rank.by, rank.at)}`);
      const promote = rules('promote').find((r) => matches(item, r.match));
      if (promote && !pin && !rank) reasons.push(`First because: ${ruleName(promote)} (${whoWhen(promote.by, promote.at)})`);
      const userGroup = userGroups.find((g) => g.itemIds.includes(item.id));
      if (groupOf.has(item.id)) reasons.push(userGroup ? `In your group "${userGroup.label}"` : `Grouped by ${groupOf.get(item.id)}`);
      const collapseRule = rules('collapse').find((r) => matches(item, r.match));
      const collapsed = collapsedByYou.has(item.id) || (!!collapseRule && !expanded.has(item.id));
      if (collapsed && collapseRule && !collapsedByYou.has(item.id)) reasons.push(`Folded by "${ruleName(collapseRule)}"`);
      const represent = [...rules('represent')].reverse().find((r) => matches(item, r.match));
      const primitive: Primitive = represent && represent.type === 'represent' ? represent.primitive : DEFAULT_PRIMITIVE[item.kind] ?? 'row';
      if (reasons.length === 0) reasons.push(`In ${region.title}: ${item.urgency} urgency, ${item.state === 'open' ? 'waiting on you' : item.state}`);
      return { item, reasons, pinned: !!pin, collapsed, primitive, ...(groupOf.has(item.id) ? { group: groupOf.get(item.id)! } : {}) };
    });
    let more = 0;
    let shown = entries;
    if (region.limit && entries.length > region.limit) {
      const keep = Math.max(region.limit, entries.filter((e) => e.pinned).length);
      more = entries.length - keep;
      shown = entries.slice(0, keep);
    }
    return { id: region.id, title: region.title, entries: shown, more };
  });

  return { goal: doc.goal, regions, hidden };
}
