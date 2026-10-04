import type { SurfaceDoc } from './schema.js';

/**
 * Home before you change anything: three regions (stable anchors), and two
 * rules (unstamped, so they read "by default"): questions and approvals
 * first, and draft agents folded together so they don't bury the rest.
 * Items land by state; within a region they keep their own order (most
 * urgent first).
 */
export const DEFAULT_HOME_SURFACE: SurfaceDoc = {
  goal: 'What needs me, what is happening, and whether everything else is fine',
  regions: [
    { id: 'needs-you', title: 'Needs you', match: { states: ['open'] } },
    { id: 'happening', title: 'Happening now', match: { states: ['in-progress', 'waiting'] } },
    { id: 'all-good', title: 'All good', match: { states: ['ok'] } },
  ],
  rules: [
    { id: 'questions-first', type: 'promote', match: { kinds: ['question', 'decision'], urgencies: ['critical', 'high', 'normal'] }, label: 'questions and approvals first' },
    { id: 'drafts-together', type: 'group', match: { idPrefix: 'agent:', kinds: ['decision'] }, groupBy: 'kind', label: 'drafts together' },
    { id: 'drafts-folded', type: 'collapse', match: { idPrefix: 'agent:', kinds: ['decision'] }, label: 'drafts stay folded' },
  ],
  overrides: [],
};

/**
 * A notebook before you change it: its options, then notes and decisions
 * (decisions first), then evidence. Items are its entries (notebooks.ts).
 */
export const DEFAULT_NOTEBOOK_SURFACE: SurfaceDoc = {
  goal: '',
  regions: [
    { id: 'options', title: 'Options', match: { kinds: ['collection'] } },
    { id: 'notes', title: 'Notes and decisions', match: { kinds: ['fact', 'decision'] } },
    { id: 'evidence', title: 'Evidence', match: { kinds: ['evidence'] } },
  ],
  rules: [
    { id: 'decisions-first', type: 'promote', match: { kinds: ['decision'] }, label: 'decisions first' },
  ],
  overrides: [],
};

/** The default for a surface id, before its first change. */
export function defaultSurface(surfaceId: string): SurfaceDoc {
  if (surfaceId === 'home') return structuredClone(DEFAULT_HOME_SURFACE);
  if (surfaceId.startsWith('notebook:')) return structuredClone(DEFAULT_NOTEBOOK_SURFACE);
  return { goal: '', regions: [{ id: 'main', title: 'Main', match: {} }], rules: [], overrides: [] };
}
