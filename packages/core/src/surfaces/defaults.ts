import type { SurfaceDoc } from './schema.js';

/**
 * Home before you change anything: three regions (stable anchors) and no
 * rules. Items land by state; within a region they keep their own order
 * (most urgent first).
 */
export const DEFAULT_HOME_SURFACE: SurfaceDoc = {
  goal: 'What needs me, what is happening, and whether everything else is fine',
  regions: [
    { id: 'needs-you', title: 'Needs you', match: { states: ['open'] } },
    { id: 'happening', title: 'Happening now', match: { states: ['in-progress', 'waiting'] } },
    { id: 'all-good', title: 'All good', match: { states: ['ok'] } },
  ],
  rules: [],
  overrides: [],
};

/** The default for a surface id, before its first change. */
export function defaultSurface(surfaceId: string): SurfaceDoc {
  if (surfaceId === 'home') return structuredClone(DEFAULT_HOME_SURFACE);
  return { goal: '', regions: [{ id: 'main', title: 'Main', match: {} }], rules: [], overrides: [] };
}
