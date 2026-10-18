/**
 * sua's own agents and route-handled actions: never the operator's problems
 * (no "failing" items for them on Home), never offered in catalogs. The
 * dashboard's inbox uses the same set (routes/inbox-shared.ts).
 */
export const SYSTEM_AGENT_IDS: ReadonlySet<string> = new Set([
  'inbox-triage',
  'inbox-learning-extractor',
  'agent-analyzer',
  'agent-editor',
  'agent-settings',
  'adjust-surface',
  'arrange-board',
  'notebook-add',
  'notebook-pipeline',
  'notebook-create',
  'notebook-keeper',
  'brand-maker',
  'view-designer',
  'notebook-drafter',
  'notebook-suggester',
  'notebook-picture',
  'notebook-facets',
  'notebook-checker',
  'notebook-finder',
  'notebook-find-one',
  'research-one',
  'agent-catalog-search',
  'agent-catalog-sorter',
  'agent-builder',
]);
