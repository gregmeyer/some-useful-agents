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
import type { SecretsStore } from '../secrets-store.js';
import type {
  BuiltinToolEntry,
  ToolDefinition,
  ToolInputField,
  ToolOutputField,
} from '../tool-types.js';
import {
  readCsvRows,
  countCsvRows,
  type CsvSnapshot,
} from './csv-driver.js';
import {
  findRows,
  findOneRow,
  countRows,
  type PgSnapshot,
  type PgTableSpec,
  type PgConnectionConfig,
} from './postgres-driver.js';

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
export function pgFindToolId(integration: Pick<Integration, 'id'>, schema: string, table: string): string {
  const tablePart = schema === 'public' ? table : `${schema}.${table}`;
  return `postgres.${integrationSlug(integration.id)}.${tablePart}.find`;
}
export function pgFindOneToolId(integration: Pick<Integration, 'id'>, schema: string, table: string): string {
  const tablePart = schema === 'public' ? table : `${schema}.${table}`;
  return `postgres.${integrationSlug(integration.id)}.${tablePart}.find-one`;
}
export function pgCountToolId(integration: Pick<Integration, 'id'>, schema: string, table: string): string {
  const tablePart = schema === 'public' ? table : `${schema}.${table}`;
  return `postgres.${integrationSlug(integration.id)}.${tablePart}.count`;
}

/**
 * Synthesis options shared by every kind. `secretsStore` is required
 * for kinds that read DSNs from the encrypted store (postgres). CSV
 * doesn't need it — passing undefined just means postgres tools
 * resolve to a "secrets store unavailable" error at execute time.
 */
export interface GeneratedToolDeps {
  secretsStore?: SecretsStore;
}

/**
 * Walk every csv integration in the store and synthesise both tools
 * (read + count) for each. Returns a map keyed by tool id so the
 * executor lookup is O(1).
 *
 * Cheap to call — no file I/O happens here. The snapshot read at
 * tool execute time is the only disk hit.
 */
export function listGeneratedTools(
  store: IntegrationsStore,
  deps: GeneratedToolDeps = {},
): Map<string, BuiltinToolEntry> {
  const out = new Map<string, BuiltinToolEntry>();
  for (const integ of store.listIntegrations()) {
    if (integ.kind === 'csv') {
      addCsvEntries(out, integ);
    } else if (integ.kind === 'postgres') {
      addPostgresEntries(out, integ, deps);
    }
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
  deps: GeneratedToolDeps = {},
): BuiltinToolEntry | undefined {
  if (toolId.startsWith('csv.')) return resolveCsvTool(store, toolId);
  if (toolId.startsWith('postgres.')) return resolvePostgresTool(store, toolId, deps);
  return undefined;
}

// ── CSV resolution ─────────────────────────────────────────────────────

function addCsvEntries(out: Map<string, BuiltinToolEntry>, integ: Integration): void {
  const snapshot = readCsvSnapshot(integ);
  if (!snapshot) return;
  const path = typeof integ.config.path === 'string' ? (integ.config.path as string) : undefined;
  if (!path) return;
  const readEntry = buildReadEntry(integ, path, snapshot);
  const countEntry = buildCountEntry(integ, path, snapshot);
  out.set(readEntry.definition.id, readEntry);
  out.set(countEntry.definition.id, countEntry);
}

function resolveCsvTool(store: IntegrationsStore, toolId: string): BuiltinToolEntry | undefined {
  const rest = toolId.slice(4);
  const lastDot = rest.lastIndexOf('.');
  if (lastDot <= 0) return undefined;
  const slug = rest.slice(0, lastDot);
  const verb = rest.slice(lastDot + 1);
  if (verb !== 'read' && verb !== 'count') return undefined;
  const integ = store.getIntegration(`user:${slug}`);
  if (!integ || integ.kind !== 'csv') return undefined;
  const snapshot = readCsvSnapshot(integ);
  if (!snapshot) return undefined;
  const path = typeof integ.config.path === 'string' ? (integ.config.path as string) : undefined;
  if (!path) return undefined;
  return verb === 'read' ? buildReadEntry(integ, path, snapshot) : buildCountEntry(integ, path, snapshot);
}

// ── Postgres resolution ────────────────────────────────────────────────

function addPostgresEntries(
  out: Map<string, BuiltinToolEntry>,
  integ: Integration,
  deps: GeneratedToolDeps,
): void {
  const snapshot = readPgSnapshot(integ);
  if (!snapshot) return;
  for (const table of Object.values(snapshot.tables)) {
    const find = buildPgFindEntry(integ, table, deps);
    const findOne = buildPgFindOneEntry(integ, table, deps);
    const count = buildPgCountEntry(integ, table, deps);
    out.set(find.definition.id, find);
    out.set(findOne.definition.id, findOne);
    out.set(count.definition.id, count);
  }
}

function resolvePostgresTool(
  store: IntegrationsStore,
  toolId: string,
  deps: GeneratedToolDeps,
): BuiltinToolEntry | undefined {
  // Format: postgres.<integration-slug>.[<schema>.]<table>.<verb>
  // We split on dots from the right: <verb> last, then walk backwards
  // until we find a known integration id.
  const rest = toolId.slice('postgres.'.length);
  const parts = rest.split('.');
  if (parts.length < 3) return undefined;
  const verb = parts[parts.length - 1];
  if (verb !== 'find' && verb !== 'find-one' && verb !== 'count') return undefined;
  // The integration slug is the first part. Everything between
  // [slug] and [verb] is the table reference (with optional schema dot).
  const slug = parts[0];
  const tableParts = parts.slice(1, parts.length - 1);
  if (tableParts.length === 0) return undefined;
  const integ = store.getIntegration(`user:${slug}`);
  if (!integ || integ.kind !== 'postgres') return undefined;
  const snapshot = readPgSnapshot(integ);
  if (!snapshot) return undefined;
  const tableKey = tableParts.length === 1 ? `public.${tableParts[0]}` : tableParts.join('.');
  const table = snapshot.tables[tableKey];
  if (!table) return undefined;
  if (verb === 'find') return buildPgFindEntry(integ, table, deps);
  if (verb === 'find-one') return buildPgFindOneEntry(integ, table, deps);
  return buildPgCountEntry(integ, table, deps);
}

// ── Snapshot helpers ───────────────────────────────────────────────────

/**
 * Pull the CSV snapshot off an integration row. Returns undefined when
 * absent — the synthesiser silently skips integrations whose snapshot
 * was never recorded (the dashboard runs `inferCsvSnapshot` at
 * add-time, so this should be rare; tolerate it for forward compat).
 */
function readCsvSnapshot(integ: Integration): CsvSnapshot | undefined {
  const raw = integ.config.schema;
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.columns)) return undefined;
  return obj as unknown as CsvSnapshot;
}

/** Pull the Postgres snapshot off an integration row. */
function readPgSnapshot(integ: Integration): PgSnapshot | undefined {
  const raw = integ.config.schema;
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (!obj.tables || typeof obj.tables !== 'object') return undefined;
  return obj as unknown as PgSnapshot;
}

/**
 * Resolve the postgres DSN from the integration's `url_secret` via the
 * encrypted secrets store. Returns undefined if anything is missing —
 * caller throws a descriptive error from inside `execute()`.
 */
async function resolvePgConnection(
  integ: Integration,
  deps: GeneratedToolDeps,
): Promise<PgConnectionConfig | { error: string }> {
  const urlSecret = typeof integ.config.url_secret === 'string' ? (integ.config.url_secret as string) : 'DATABASE_URL';
  if (!deps.secretsStore) {
    return { error: `postgres tool needs a secretsStore to resolve "${urlSecret}".` };
  }
  let dsn: string | undefined;
  try {
    const all = await deps.secretsStore.getAll();
    dsn = all[urlSecret];
  } catch (err) {
    return { error: `Could not read secrets store: ${(err as Error).message}` };
  }
  if (!dsn) {
    return { error: `Secret "${urlSecret}" is not set — add it via Settings → Secrets.` };
  }
  const schemas = Array.isArray(integ.config.schemas) ? (integ.config.schemas as string[]) : ['public'];
  return { integrationId: integ.id, connectionString: dsn, schemas };
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

// ── Postgres tool synthesis ────────────────────────────────────────────

function buildPgFindEntry(
  integ: Integration,
  table: PgTableSpec,
  deps: GeneratedToolDeps,
): BuiltinToolEntry {
  const fqn = `${table.schema}.${table.name}`;
  const definition: ToolDefinition = {
    id: pgFindToolId(integ, table.schema, table.name),
    name: `Find rows in ${fqn}`,
    description: `Read rows from Postgres ${fqn} (${table.columns.length} columns).`,
    source: 'builtin',
    inputs: {
      where: { type: 'object', description: 'Map of column → expected value. Keys are validated against the table schema.' } as ToolInputField,
      limit: { type: 'number', description: 'Maximum rows. Defaults to 100. Capped at 10000.', default: 100 } as ToolInputField,
      order_by: { type: 'string', description: 'Column name optionally followed by ASC|DESC.' } as ToolInputField,
    },
    outputs: {
      rows: { type: 'array', description: 'Matching rows in source-column order.' } as ToolOutputField,
      row_count: { type: 'number', description: 'Number of rows returned.' } as ToolOutputField,
    },
    implementation: { type: 'builtin', builtinName: pgFindToolId(integ, table.schema, table.name) },
  };
  return {
    definition,
    async execute(inputs) {
      const conn = await resolvePgConnection(integ, deps);
      if ('error' in conn) throw new Error(conn.error);
      const where = (inputs.where as Record<string, unknown> | undefined) ?? {};
      const limit = typeof inputs.limit === 'number' ? inputs.limit : undefined;
      const orderBy = typeof inputs.order_by === 'string' ? inputs.order_by : undefined;
      const rows = await findRows(conn, table, { where, limit, orderBy });
      return { rows, row_count: rows.length, result: JSON.stringify({ rows, row_count: rows.length }) };
    },
  };
}

function buildPgFindOneEntry(
  integ: Integration,
  table: PgTableSpec,
  deps: GeneratedToolDeps,
): BuiltinToolEntry {
  const fqn = `${table.schema}.${table.name}`;
  const definition: ToolDefinition = {
    id: pgFindOneToolId(integ, table.schema, table.name),
    name: `Find one row in ${fqn}`,
    description: `Read a single row from Postgres ${fqn} (LIMIT 1).`,
    source: 'builtin',
    inputs: {
      where: { type: 'object', description: 'Map of column → expected value.' } as ToolInputField,
      order_by: { type: 'string', description: 'Column name optionally followed by ASC|DESC.' } as ToolInputField,
    },
    outputs: {
      row: { type: 'object', description: 'Matching row, or null when no row matches.' } as ToolOutputField,
    },
    implementation: { type: 'builtin', builtinName: pgFindOneToolId(integ, table.schema, table.name) },
  };
  return {
    definition,
    async execute(inputs) {
      const conn = await resolvePgConnection(integ, deps);
      if ('error' in conn) throw new Error(conn.error);
      const where = (inputs.where as Record<string, unknown> | undefined) ?? {};
      const orderBy = typeof inputs.order_by === 'string' ? inputs.order_by : undefined;
      const row = await findOneRow(conn, table, { where, orderBy });
      return { row, result: JSON.stringify({ row }) };
    },
  };
}

function buildPgCountEntry(
  integ: Integration,
  table: PgTableSpec,
  deps: GeneratedToolDeps,
): BuiltinToolEntry {
  const fqn = `${table.schema}.${table.name}`;
  const definition: ToolDefinition = {
    id: pgCountToolId(integ, table.schema, table.name),
    name: `Count rows in ${fqn}`,
    description: `COUNT(*) over Postgres ${fqn} with an optional where filter.`,
    source: 'builtin',
    inputs: {
      where: { type: 'object', description: 'Map of column → expected value. Empty matches all rows.' } as ToolInputField,
    },
    outputs: {
      count: { type: 'number', description: 'Number of matching rows.' } as ToolOutputField,
    },
    implementation: { type: 'builtin', builtinName: pgCountToolId(integ, table.schema, table.name) },
  };
  return {
    definition,
    async execute(inputs) {
      const conn = await resolvePgConnection(integ, deps);
      if ('error' in conn) throw new Error(conn.error);
      const where = (inputs.where as Record<string, unknown> | undefined) ?? {};
      const count = await countRows(conn, table, where);
      return { count, result: JSON.stringify({ count }) };
    },
  };
}

