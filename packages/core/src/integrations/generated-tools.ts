/**
 * Synthesises `BuiltinToolEntry` instances from connector-style
 * integrations (CSV today; postgres in PR 4.B). The executor can treat
 * these like any other built-in tool — same lookup contract, same
 * `execute(inputs, ctx)` signature — so no new dispatch branch is
 * needed.
 *
 * Tool ID convention: `csv.<integration-slug>.<verb>`. The slug is the
 * portion of `integration.id` after the `<owner>:` prefix
 * (`user:customers` → `customers`, `pack-foo:orders` → `orders`).
 *
 * Per CSV integration we synthesise:
 *   - `csv.<slug>.read`  → `{ rows: typed[], row_count: number }`
 *   - `csv.<slug>.count` → `{ count: number }`
 *
 * The output `rows[]` schema is built from the snapshot's column
 * specs so the planner / template resolver can introspect downstream
 * `{{upstream.<node>.rows[0].<field>}}` references without runtime
 * sampling.
 */

import type { Integration, IntegrationsStore } from '../integrations-store.js';
import type {
  BuiltinToolEntry,
  ToolDefinition,
  ToolInputField,
  ToolOutputField,
} from '../tool-types.js';
import {
  inferCsvSnapshot,
  readCsvRows,
  countCsvRows,
  type CsvSnapshot,
} from './csv-driver.js';

/**
 * Strip the `<owner>:` prefix from an integration id to get the
 * user-visible slug. `user:customers` → `customers`.
 */
export function integrationSlug(integrationId: string): string {
  const idx = integrationId.indexOf(':');
  return idx >= 0 ? integrationId.slice(idx + 1) : integrationId;
}

/** Tool id helpers — keep formatting in one place so callers stay consistent. */
export function csvReadToolId(integration: Pick<Integration, 'id'>): string {
  return `csv.${integrationSlug(integration.id)}.read`;
}
export function csvCountToolId(integration: Pick<Integration, 'id'>): string {
  return `csv.${integrationSlug(integration.id)}.count`;
}

/**
 * Walk every csv integration in the store and synthesise both tools
 * (read + count) for each. Returns a map keyed by tool id so the
 * executor lookup is O(1).
 *
 * Cheap to call — no file I/O happens here. The snapshot read at
 * tool execute time is the only disk hit.
 */
export function listGeneratedTools(store: IntegrationsStore): Map<string, BuiltinToolEntry> {
  const out = new Map<string, BuiltinToolEntry>();
  for (const integ of store.listIntegrations()) {
    if (integ.kind !== 'csv') continue;
    const snapshot = readSnapshotFromIntegration(integ);
    if (!snapshot) continue;
    const path = typeof integ.config.path === 'string' ? (integ.config.path as string) : undefined;
    if (!path) continue;
    const readEntry = buildReadEntry(integ, path, snapshot);
    const countEntry = buildCountEntry(integ, path, snapshot);
    out.set(readEntry.definition.id, readEntry);
    out.set(countEntry.definition.id, countEntry);
  }
  return out;
}

/**
 * Single-tool resolver — used by the executor on the hot path. Avoids
 * synthesising every integration's tools just to look up one.
 */
export function getGeneratedTool(
  store: IntegrationsStore,
  toolId: string,
): BuiltinToolEntry | undefined {
  // Tool ids look like `csv.<slug>.<verb>`. Reject anything else fast.
  if (!toolId.startsWith('csv.')) return undefined;
  const rest = toolId.slice(4);
  const lastDot = rest.lastIndexOf('.');
  if (lastDot <= 0) return undefined;
  const slug = rest.slice(0, lastDot);
  const verb = rest.slice(lastDot + 1);
  if (verb !== 'read' && verb !== 'count') return undefined;

  // Try the user namespace first (the only one the dashboard creates today).
  // If pack-installed integrations land later they'd add another lookup.
  const integ = store.getIntegration(`user:${slug}`);
  if (!integ || integ.kind !== 'csv') return undefined;
  const snapshot = readSnapshotFromIntegration(integ);
  if (!snapshot) return undefined;
  const path = typeof integ.config.path === 'string' ? (integ.config.path as string) : undefined;
  if (!path) return undefined;
  return verb === 'read' ? buildReadEntry(integ, path, snapshot) : buildCountEntry(integ, path, snapshot);
}

// ── Snapshot helpers ───────────────────────────────────────────────────

/**
 * Pull the snapshot off an integration row. Returns undefined when
 * absent — the synthesiser silently skips integrations whose snapshot
 * was never recorded (the dashboard runs `inferCsvSnapshot` at
 * add-time, so this should be rare; tolerate it for forward compat).
 */
function readSnapshotFromIntegration(integ: Integration): CsvSnapshot | undefined {
  const raw = integ.config.schema;
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.columns)) return undefined;
  return obj as unknown as CsvSnapshot;
}

// ── Tool synthesis ─────────────────────────────────────────────────────

function buildReadEntry(integ: Integration, path: string, snapshot: CsvSnapshot): BuiltinToolEntry {
  // For now the synthesised tool declares the array/object shapes but
  // not per-item column types — the existing ToolOutputField schema
  // doesn't model item schemas. PR 4.C revisits when we add schema-
  // aware save-time validation; the column list still lives on the
  // integration row so future passes can consult it directly.
  const definition: ToolDefinition = {
    id: csvReadToolId(integ),
    name: `Read ${integ.name}`,
    description: `Read rows from CSV "${integ.id}" (${snapshot.columns.length} columns, ${snapshot.rowCount} rows at last introspection).`,
    source: 'builtin',
    inputs: {
      where: {
        type: 'object',
        description: 'Map of column → expected value. AND-ed across keys. Loose equality (string "1" matches number 1).',
      } as ToolInputField,
      limit: {
        type: 'number',
        description: 'Maximum rows to return. Defaults to 1000.',
        default: 1000,
      } as ToolInputField,
    },
    outputs: {
      rows: {
        type: 'array',
        description: 'Matching rows, coerced to the inferred column types.',
      } as ToolOutputField,
      row_count: { type: 'number', description: 'Number of rows returned.' } as ToolOutputField,
    },
    implementation: { type: 'builtin', builtinName: csvReadToolId(integ) },
  };
  return {
    definition,
    async execute(inputs) {
      const where = (inputs.where as Record<string, unknown> | undefined) ?? {};
      const limit = typeof inputs.limit === 'number' ? inputs.limit : 1000;
      const rows = readCsvRows(path, snapshot.columns, { where, limit });
      return { rows, row_count: rows.length, result: JSON.stringify({ rows, row_count: rows.length }) };
    },
  };
}

function buildCountEntry(integ: Integration, path: string, snapshot: CsvSnapshot): BuiltinToolEntry {
  const definition: ToolDefinition = {
    id: csvCountToolId(integ),
    name: `Count ${integ.name}`,
    description: `Count matching rows in CSV "${integ.id}".`,
    source: 'builtin',
    inputs: {
      where: {
        type: 'object',
        description: 'Map of column → expected value. Empty matches all rows.',
      } as ToolInputField,
    },
    outputs: {
      count: { type: 'number', description: 'Number of matching rows.' } as ToolOutputField,
    },
    implementation: { type: 'builtin', builtinName: csvCountToolId(integ) },
  };
  return {
    definition,
    async execute(inputs) {
      const where = (inputs.where as Record<string, unknown> | undefined) ?? {};
      const count = countCsvRows(path, snapshot.columns, { where });
      return { count, result: JSON.stringify({ count }) };
    },
  };
}

