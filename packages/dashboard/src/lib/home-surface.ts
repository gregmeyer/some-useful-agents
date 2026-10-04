/**
 * Home's surface (goal surfaces, S3): the item index compiled through Home's
 * surface document. Read fresh per request; the list's Today tab and the
 * item pane both use it.
 */
import {
  collectItems, itemSourcesFromHandle, compileSurface, SurfaceStore,
  type CompiledSurface, type CompiledEntry, type Item, type SurfaceDoc,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';

export interface HomeSurface {
  compiled: CompiledSurface;
  /** The surface document's version (0 = the defaults). */
  version: number;
  goal: string;
  /** What the Today tab counts: entries waiting on you in Needs you. */
  needsCount: number;
  /** The document and items it was compiled from (for previews of a change). */
  doc: SurfaceDoc;
  items: Item[];
}

export const HOME_SURFACE_ID = 'home';

export function readHomeSurface(ctx: ReturnType<typeof getContext>): HomeSurface {
  const db = ctx.runStore.databaseHandle();
  const items = collectItems(itemSourcesFromHandle(db, ctx.agentStore, ctx.runStore, ctx.dataDir));
  const cur = SurfaceStore.fromHandle(db).current(HOME_SURFACE_ID);
  const compiled = compileSurface(cur.doc, items);
  const needs = compiled.regions.find((r) => r.id === 'needs-you');
  return {
    compiled,
    version: cur.version,
    goal: cur.doc.goal,
    needsCount: needs ? needs.entries.filter((e) => !e.collapsed).length + needs.more : 0,
    doc: cur.doc,
    items,
  };
}

/** One item and why it's where it is, or undefined when it's no longer there. */
export function findSurfaceEntry(home: HomeSurface, itemId: string): CompiledEntry | { item: Item; reasons: string[] } | undefined {
  for (const r of home.compiled.regions) {
    const e = r.entries.find((x) => x.item.id === itemId);
    if (e) return e;
  }
  return undefined;
}
