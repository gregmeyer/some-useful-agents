/**
 * What changed in a notebook since last time: its latest search against the
 * one before it. New options (first found by it), price and fact changes (an
 * option's latest sighting against the one before), options whose page said
 * they're gone, and ones the latest search didn't find again. Worked out from
 * what the notebook keeps, never by a model, so it says only what happened.
 * The Watch page leads with it. Pure.
 */
import type { Notebook, NotebookField, NotebookFieldValue, NotebookViewOption } from './notebooks.js';

export type NotebookChangeKind = 'new' | 'price' | 'changed' | 'gone' | 'missing';

export interface NotebookChange {
  kind: NotebookChangeKind;
  /** The option it's about. */
  id: string;
  name: string;
  /** price / changed: the fact, before and now. */
  field?: Pick<NotebookField, 'key' | 'label' | 'type' | 'unit'>;
  from?: NotebookFieldValue;
  to?: NotebookFieldValue;
  /** gone: why (what its page said). */
  reason?: string;
}

export interface NotebookChanges {
  /** When the latest search ran (none: nothing searched yet). */
  at?: string;
  /** When the one before it ran (none: the latest was the first). */
  since?: string;
  /** The latest search was its first: everything is new, so it's a first look, not a change. */
  first: boolean;
  /** How many options the latest search found or found again (a first look says this). */
  seen: number;
  changes: NotebookChange[];
}

export interface NotebookChangesHistory {
  sightings(entryId: string): Array<{ at: string; correctedBy?: string; data: Record<string, NotebookFieldValue> }>;
  /** When the latest search that found options started (NotebookStore.lastFindAt). */
  lastFindAt?(notebookId: string): string | undefined;
  /** When the search before `before` ran (NotebookStore.searchBefore). */
  searchBefore?(notebookId: string, before: string): string | undefined;
}

/** Facts that change without meaning anything (where its picture is, its own address). */
const QUIET_ROLES = new Set(['image', 'link']);
const same = (a: NotebookFieldValue | undefined, b: NotebookFieldValue | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const KIND_ORDER: Record<NotebookChangeKind, number> = { new: 0, price: 1, changed: 2, gone: 3, missing: 4 };

export function notebookChanges(nb: Pick<Notebook, 'id' | 'fields'>, options: readonly NotebookViewOption[], history?: NotebookChangesHistory): NotebookChanges {
  const at = history?.lastFindAt?.(nb.id);
  if (!at) return { first: false, seen: 0, changes: [] };
  const since = history?.searchBefore?.(nb.id, at);
  const seen = options.filter((o) => o.lastSeenAt >= at).length;
  if (!since) return { at, first: true, seen, changes: [] };
  const priceKey = nb.fields.find((f) => f.role === 'price')?.key;
  const tracked = nb.fields.filter((f) => !QUIET_ROLES.has(f.role ?? ''));
  const changes: NotebookChange[] = [];
  for (const o of options) {
    // Gone: its page said so since the search before (kept, but out).
    if (o.ruledOut?.gone && o.ruledOut.at >= since) { changes.push({ kind: 'gone', id: o.id, name: o.name, ...(o.ruledOut.reason ? { reason: o.ruledOut.reason } : {}) }); continue; }
    if (o.ruledOut) continue;
    if (o.added === 'new' || o.firstSeenAt >= at) { changes.push({ kind: 'new', id: o.id, name: o.name }); continue; }
    // Not found this time: the latest search found others, and not this one.
    if (o.lastSeenAt < at) {
      if (o.missedSearches > 0) changes.push({ kind: 'missing', id: o.id, name: o.name });
      continue;
    }
    // Seen again: what its latest sighting says against the one before.
    const all = history?.sightings(o.id) ?? [];
    const now = [...all].reverse().find((x) => x.at >= at && !x.correctedBy);
    const was = [...all].reverse().find((x) => x.at < at && !x.correctedBy);
    if (!now || !was) continue;
    for (const f of tracked) {
      const a = was.data[f.key];
      const b = now.data[f.key];
      if (a === undefined || b === undefined || a === '' || b === '' || same(a, b)) continue;
      changes.push({ kind: f.key === priceKey ? 'price' : 'changed', id: o.id, name: o.name, field: { key: f.key, label: f.label, type: f.type, ...(f.unit ? { unit: f.unit } : {}) }, from: a, to: b });
    }
  }
  changes.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return { at, since, first: false, seen, changes };
}
