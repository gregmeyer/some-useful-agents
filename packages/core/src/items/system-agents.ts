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
  'notebook-keeper',
  'brand-maker',
  'notebook-picture',
  'agent-catalog-search',
  'agent-builder',
]);
