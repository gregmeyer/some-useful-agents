/**
 * Pure, framework-free helpers for shaping dashboard ids and layouts.
 *
 * Extracted so BOTH the dashboard editor routes and the inbox-triage
 * `dashboard-editor` action mutate layouts through one implementation rather
 * than duplicating slug + section logic. No Express, no store, no context —
 * just data in, data out.
 */
import type { DashboardLayout, DashboardSection } from './dashboards-store.js';

/**
 * Turn a human dashboard name into a url-safe slug. Lowercases, collapses any
 * run of non-alphanumerics to a single hyphen, trims leading/trailing hyphens,
 * caps at 40 chars, and falls back to `dashboard` when nothing survives.
 */
export function slugifyDashboardName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'dashboard'
  );
}

/**
 * Allocate a `user:<slug>` id for a new user dashboard. `exists` reports
 * whether a candidate id is already taken; on collision we append a base-36
 * timestamp suffix so a second "Markets" dashboard becomes
 * `user:markets-<ts>` rather than clobbering the first.
 */
export function allocateUserDashboardId(
  name: string,
  exists: (id: string) => boolean,
): string {
  const base = `user:${slugifyDashboardName(name)}`;
  return exists(base) ? `${base}-${Date.now().toString(36)}` : base;
}

/**
 * Deep-copy a layout's sections, run `fn` over the copy, and return it — so
 * callers can mutate freely without touching the stored layout. Copies each
 * section AND its `agentIds` array (the part that's most often spliced).
 */
export function mutateSections(
  layout: DashboardLayout,
  fn: (arr: DashboardSection[]) => void,
): DashboardSection[] {
  const arr = layout.sections.map((s) => ({ ...s, agentIds: [...s.agentIds] }));
  fn(arr);
  return arr;
}
