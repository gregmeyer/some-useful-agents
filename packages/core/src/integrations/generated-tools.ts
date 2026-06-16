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
import {
  findRows as sqliteFindRows,
  findOneRow as sqliteFindOneRow,
  countRows as sqliteCountRows,
  type SqliteSnapshot,
  type SqliteTableSpec,
  type SqliteConnectionConfig,
} from './sqlite-driver.js';
import { ensureAppleRunner, runAppleSubcommand, type AppleSnapshot } from './apple-runner.js';
import { isAppleIntegrationEnabled } from '../experimental.js';

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
export function sqliteFindToolId(integration: Pick<Integration, 'id'>, table: string): string {
  return `sqlite.${integrationSlug(integration.id)}.${table}.find`;
}
export function sqliteFindOneToolId(integration: Pick<Integration, 'id'>, table: string): string {
  return `sqlite.${integrationSlug(integration.id)}.${table}.find-one`;
}
export function sqliteCountToolId(integration: Pick<Integration, 'id'>, table: string): string {
  return `sqlite.${integrationSlug(integration.id)}.${table}.count`;
}
export function appleToolId(integration: Pick<Integration, 'id'>, verb: string): string {
  return `apple.${integrationSlug(integration.id)}.${verb}`;
}

/**
 * Synthesis options shared by every kind. `secretsStore` is required
 * for kinds that read DSNs from the encrypted store (postgres). CSV
 * doesn't need it — passing undefined just means postgres tools
 * resolve to a "secrets store unavailable" error at execute time.
 */
export interface GeneratedToolDeps {
  secretsStore?: SecretsStore;
  /**
   * Override the compiled Apple runner binary. Tests inject a fake binary
   * here so the apple tools exercise the spawn/JSON-parse path without
   * compiling Swift or touching the developer's real Reminders/Notes.
   */
  appleRunner?: { binaryPath: string };
  /**
   * Run-scoped override for the experimental Apple gate. When set, it wins
   * over the `SUA_EXPERIMENTAL_APPLE` env var so apple-tool availability
   * travels WITH the run instead of depending on the worker process's
   * environment (which varied by launch path and caused intermittent
   * "tool did not resolve" failures on the Temporal worker). Undefined →
   * fall back to the env var (local/CLI runs that bridge config → env).
   */
  experimentalApple?: boolean;
}

/** Apple gate: run-scoped flag wins; otherwise the env-bridged config flag. */
function appleEnabled(deps: GeneratedToolDeps): boolean {
  return deps.experimentalApple ?? isAppleIntegrationEnabled();
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
    } else if (integ.kind === 'sqlite') {
      addSqliteEntries(out, integ);
    } else if (integ.kind === 'apple' && appleEnabled(deps)) {
      addAppleEntries(out, integ, deps);
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
  if (toolId.startsWith('sqlite.')) return resolveSqliteTool(store, toolId);
  if (toolId.startsWith('apple.') && appleEnabled(deps)) return resolveAppleTool(store, toolId, deps);
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

/** Pull the SQLite snapshot off an integration row. Same shape as PgSnapshot. */
function readSqliteSnapshot(integ: Integration): SqliteSnapshot | undefined {
  const raw = integ.config.schema;
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (!obj.tables || typeof obj.tables !== 'object') return undefined;
  return obj as unknown as SqliteSnapshot;
}

function sqliteConnection(integ: Integration): SqliteConnectionConfig | undefined {
  const path = typeof integ.config.path === 'string' ? (integ.config.path as string) : undefined;
  if (!path) return undefined;
  return { integrationId: integ.id, path, readonly: true };
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

function csvRowProperties(snapshot: CsvSnapshot): Record<string, ToolOutputField> {
  const props: Record<string, ToolOutputField> = {};
  for (const col of snapshot.columns) {
    props[col.name] = { type: col.type, description: col.format ? `${col.type} (${col.format})` : undefined };
  }
  return props;
}

function buildReadEntry(integ: Integration, path: string, snapshot: CsvSnapshot): BuiltinToolEntry {
  const rowProps = csvRowProperties(snapshot);
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
        items: { type: 'object', properties: rowProps },
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

function pgRowProperties(table: PgTableSpec): Record<string, ToolOutputField> {
  const props: Record<string, ToolOutputField> = {};
  for (const col of table.columns) {
    props[col.name] = { type: col.type, description: col.format ? `${col.pgType} (${col.format})` : col.pgType };
  }
  return props;
}

function buildPgFindEntry(
  integ: Integration,
  table: PgTableSpec,
  deps: GeneratedToolDeps,
): BuiltinToolEntry {
  const fqn = `${table.schema}.${table.name}`;
  const rowProps = pgRowProperties(table);
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
      rows: {
        type: 'array',
        description: 'Matching rows in source-column order.',
        items: { type: 'object', properties: rowProps },
      } as ToolOutputField,
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
  const rowProps = pgRowProperties(table);
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
      row: { type: 'object', description: 'Matching row, or null when no row matches.', properties: rowProps } as ToolOutputField,
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

// ── SQLite resolution + synthesis ──────────────────────────────────────

function addSqliteEntries(out: Map<string, BuiltinToolEntry>, integ: Integration): void {
  const snapshot = readSqliteSnapshot(integ);
  if (!snapshot) return;
  const conn = sqliteConnection(integ);
  if (!conn) return;
  for (const table of Object.values(snapshot.tables)) {
    const find = buildSqliteFindEntry(integ, conn, table);
    const findOne = buildSqliteFindOneEntry(integ, conn, table);
    const count = buildSqliteCountEntry(integ, conn, table);
    out.set(find.definition.id, find);
    out.set(findOne.definition.id, findOne);
    out.set(count.definition.id, count);
  }
}

function resolveSqliteTool(store: IntegrationsStore, toolId: string): BuiltinToolEntry | undefined {
  // Format: sqlite.<integration-slug>.<table>.<verb>
  const rest = toolId.slice('sqlite.'.length);
  const parts = rest.split('.');
  if (parts.length < 3) return undefined;
  const verb = parts[parts.length - 1];
  if (verb !== 'find' && verb !== 'find-one' && verb !== 'count') return undefined;
  const slug = parts[0];
  const tableParts = parts.slice(1, parts.length - 1);
  if (tableParts.length !== 1) return undefined; // sqlite has no schema prefix
  const integ = store.getIntegration(`user:${slug}`);
  if (!integ || integ.kind !== 'sqlite') return undefined;
  const snapshot = readSqliteSnapshot(integ);
  if (!snapshot) return undefined;
  const conn = sqliteConnection(integ);
  if (!conn) return undefined;
  const table = snapshot.tables[`main.${tableParts[0]}`];
  if (!table) return undefined;
  if (verb === 'find') return buildSqliteFindEntry(integ, conn, table);
  if (verb === 'find-one') return buildSqliteFindOneEntry(integ, conn, table);
  return buildSqliteCountEntry(integ, conn, table);
}

function sqliteRowProperties(table: SqliteTableSpec): Record<string, ToolOutputField> {
  const props: Record<string, ToolOutputField> = {};
  for (const col of table.columns) {
    props[col.name] = { type: col.type, description: col.format ? `${col.sqliteType} (${col.format})` : col.sqliteType };
  }
  return props;
}

function buildSqliteFindEntry(
  integ: Integration,
  conn: SqliteConnectionConfig,
  table: SqliteTableSpec,
): BuiltinToolEntry {
  const rowProps = sqliteRowProperties(table);
  const definition: ToolDefinition = {
    id: sqliteFindToolId(integ, table.name),
    name: `Find rows in ${table.name}`,
    description: `Read rows from SQLite ${table.name} (${table.columns.length} columns).`,
    source: 'builtin',
    inputs: {
      where: { type: 'object', description: 'Map of column → expected value. Keys are validated against the table schema.' } as ToolInputField,
      limit: { type: 'number', description: 'Maximum rows. Defaults to 100. Capped at 10000.', default: 100 } as ToolInputField,
      order_by: { type: 'string', description: 'Column name optionally followed by ASC|DESC.' } as ToolInputField,
    },
    outputs: {
      rows: {
        type: 'array',
        description: 'Matching rows in source-column order.',
        items: { type: 'object', properties: rowProps },
      } as ToolOutputField,
      row_count: { type: 'number', description: 'Number of rows returned.' } as ToolOutputField,
    },
    implementation: { type: 'builtin', builtinName: sqliteFindToolId(integ, table.name) },
  };
  return {
    definition,
    async execute(inputs) {
      const where = (inputs.where as Record<string, unknown> | undefined) ?? {};
      const limit = typeof inputs.limit === 'number' ? inputs.limit : undefined;
      const orderBy = typeof inputs.order_by === 'string' ? inputs.order_by : undefined;
      const rows = sqliteFindRows(conn, table, { where, limit, orderBy });
      return { rows, row_count: rows.length, result: JSON.stringify({ rows, row_count: rows.length }) };
    },
  };
}

function buildSqliteFindOneEntry(
  integ: Integration,
  conn: SqliteConnectionConfig,
  table: SqliteTableSpec,
): BuiltinToolEntry {
  const rowProps = sqliteRowProperties(table);
  const definition: ToolDefinition = {
    id: sqliteFindOneToolId(integ, table.name),
    name: `Find one row in ${table.name}`,
    description: `Read a single row from SQLite ${table.name} (LIMIT 1).`,
    source: 'builtin',
    inputs: {
      where: { type: 'object', description: 'Map of column → expected value.' } as ToolInputField,
      order_by: { type: 'string', description: 'Column name optionally followed by ASC|DESC.' } as ToolInputField,
    },
    outputs: {
      row: { type: 'object', description: 'Matching row, or null when no row matches.', properties: rowProps } as ToolOutputField,
    },
    implementation: { type: 'builtin', builtinName: sqliteFindOneToolId(integ, table.name) },
  };
  return {
    definition,
    async execute(inputs) {
      const where = (inputs.where as Record<string, unknown> | undefined) ?? {};
      const orderBy = typeof inputs.order_by === 'string' ? inputs.order_by : undefined;
      const row = sqliteFindOneRow(conn, table, { where, orderBy });
      return { row, result: JSON.stringify({ row }) };
    },
  };
}

function buildSqliteCountEntry(
  integ: Integration,
  conn: SqliteConnectionConfig,
  table: SqliteTableSpec,
): BuiltinToolEntry {
  const definition: ToolDefinition = {
    id: sqliteCountToolId(integ, table.name),
    name: `Count rows in ${table.name}`,
    description: `COUNT(*) over SQLite ${table.name} with an optional where filter.`,
    source: 'builtin',
    inputs: {
      where: { type: 'object', description: 'Map of column → expected value. Empty matches all rows.' } as ToolInputField,
    },
    outputs: {
      count: { type: 'number', description: 'Number of matching rows.' } as ToolOutputField,
    },
    implementation: { type: 'builtin', builtinName: sqliteCountToolId(integ, table.name) },
  };
  return {
    definition,
    async execute(inputs) {
      const where = (inputs.where as Record<string, unknown> | undefined) ?? {};
      const count = sqliteCountRows(conn, table, where);
      return { count, result: JSON.stringify({ count }) };
    },
  };
}

// ── Apple (Reminders & Notes) resolution + synthesis ───────────────────
//
// Unlike csv/postgres/sqlite (read-only find/count), the apple kind exposes
// WRITE / side-effecting verbs (reminder-create, reminder-update, note-create)
// alongside reads. Each verb maps 1:1 to a subcommand of the compiled Swift
// runner; `execute()` shells to the binary and parses one JSON line. The kind
// is experimental and macOS-only — callers gate on `isAppleIntegrationEnabled()`
// before reaching here.

/** Pull the Apple snapshot (authorized lists/folders) off an integration row. */
function readAppleSnapshot(integ: Integration): AppleSnapshot | undefined {
  const raw = integ.config.schema;
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.reminderLists) || !Array.isArray(obj.noteFolders)) return undefined;
  return obj as unknown as AppleSnapshot;
}

/** Resolve the runner binary — injected fake for tests, else compile-on-demand. */
function resolveAppleBinary(deps: GeneratedToolDeps): string {
  if (deps.appleRunner?.binaryPath) return deps.appleRunner.binaryPath;
  const handle = ensureAppleRunner();
  if (handle.status !== 'ready') {
    throw new Error(`Apple runner unavailable: ${handle.message ?? handle.status}`);
  }
  return handle.binaryPath;
}

interface AppleVerbSpec {
  verb: string;
  subcommand: string;
  name: string;
  description: string;
  inputs: Record<string, ToolInputField>;
  outputs: Record<string, ToolOutputField>;
  /** Map tool inputs → runner stdin payload. May throw on snapshot validation. */
  buildPayload: (inputs: Record<string, unknown>, snapshot: AppleSnapshot) => Record<string, unknown>;
}

function assertReminderList(snapshot: AppleSnapshot, name: unknown): void {
  if (typeof name !== 'string' || name === '') return;
  if (!snapshot.reminderLists.some((l) => l.title === name)) {
    const avail = snapshot.reminderLists.map((l) => l.title).join(', ') || '(none)';
    throw new Error(`No reminder list named "${name}". Authorized lists: ${avail}`);
  }
}
function assertNoteFolder(snapshot: AppleSnapshot, name: unknown): void {
  if (typeof name !== 'string' || name === '') return;
  if (!snapshot.noteFolders.some((f) => f.name === name)) {
    const avail = snapshot.noteFolders.map((f) => f.name).join(', ') || '(none)';
    throw new Error(`No note folder named "${name}". Authorized folders: ${avail}`);
  }
}

const reminderRowProps: Record<string, ToolOutputField> = {
  id: { type: 'string' },
  title: { type: 'string' },
  notes: { type: 'string' },
  completed: { type: 'boolean' },
  dueDate: { type: 'string', description: 'ISO 8601, or null' },
  list: { type: 'string' },
};
const noteRowProps: Record<string, ToolOutputField> = {
  id: { type: 'string' },
  title: { type: 'string' },
  body: { type: 'string', description: 'HTML body (best-effort)' },
  folder: { type: 'string' },
};

const APPLE_VERBS: AppleVerbSpec[] = [
  {
    verb: 'reminder-create',
    subcommand: 'reminder-create',
    name: 'Create a reminder',
    description: 'Create a reminder in macOS Reminders. Side-effecting.',
    inputs: {
      title: { type: 'string', description: 'Reminder title.', required: true },
      notes: { type: 'string', description: 'Optional notes body.' },
      dueDate: { type: 'string', description: 'Optional due date, ISO 8601 (e.g. 2026-06-12T17:00:00Z).' },
      list: { type: 'string', description: 'Reminder list name. Defaults to the system default list.' },
    },
    outputs: {
      id: { type: 'string', description: 'Identifier of the created reminder.' },
      title: { type: 'string' },
      list: { type: 'string' },
    },
    buildPayload: (inputs, snapshot) => {
      assertReminderList(snapshot, inputs.list);
      return {
        title: inputs.title,
        ...(inputs.notes !== undefined ? { notes: inputs.notes } : {}),
        ...(inputs.dueDate !== undefined ? { dueDate: inputs.dueDate } : {}),
        ...(inputs.list !== undefined ? { list: inputs.list } : {}),
      };
    },
  },
  {
    verb: 'reminder-read',
    subcommand: 'reminder-read',
    name: 'Read reminders',
    description: 'List reminders from macOS Reminders, optionally filtered by list and completion.',
    inputs: {
      list: { type: 'string', description: 'Restrict to this reminder list.' },
      completed: { type: 'boolean', description: 'Filter by completion state. Omit for all.' },
      limit: { type: 'number', description: 'Maximum reminders to return. Defaults to 100.', default: 100 },
    },
    outputs: {
      reminders: { type: 'array', description: 'Matching reminders.', items: { type: 'object', properties: reminderRowProps } },
      count: { type: 'number' },
    },
    buildPayload: (inputs, snapshot) => {
      assertReminderList(snapshot, inputs.list);
      return {
        ...(inputs.list !== undefined ? { list: inputs.list } : {}),
        ...(inputs.completed !== undefined ? { completed: inputs.completed } : {}),
        limit: typeof inputs.limit === 'number' ? inputs.limit : 100,
      };
    },
  },
  {
    verb: 'reminder-update',
    subcommand: 'reminder-update',
    name: 'Update a reminder',
    description: 'Mark a reminder complete or edit its fields. Side-effecting.',
    inputs: {
      id: { type: 'string', description: 'Reminder identifier (from reminder-read/create).', required: true },
      completed: { type: 'boolean', description: 'Set completion state.' },
      title: { type: 'string', description: 'New title.' },
      notes: { type: 'string', description: 'New notes body.' },
      dueDate: { type: 'string', description: 'New due date, ISO 8601.' },
    },
    outputs: {
      id: { type: 'string' },
      completed: { type: 'boolean' },
    },
    buildPayload: (inputs) => {
      // Empty-string optional fields mean "leave unchanged", not "blank it".
      // Tool inputs arrive as templated strings (no type coercion), so an
      // edit agent that maps every field would otherwise clobber the ones the
      // operator didn't set — e.g. an unset TITLE would erase the title. Only
      // forward fields that carry a real value.
      const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
      return {
        id: inputs.id,
        ...(inputs.completed !== undefined ? { completed: inputs.completed } : {}),
        ...(nonEmpty(inputs.title) ? { title: inputs.title } : {}),
        ...(nonEmpty(inputs.notes) ? { notes: inputs.notes } : {}),
        ...(nonEmpty(inputs.dueDate) ? { dueDate: inputs.dueDate } : {}),
      };
    },
  },
  {
    verb: 'note-create',
    subcommand: 'note-create',
    name: 'Create a note',
    description: 'Create a note in macOS Notes (via AppleScript, best-effort). Side-effecting.',
    inputs: {
      title: { type: 'string', description: 'Note title.', required: true },
      body: { type: 'string', description: 'Note body (plain text; wrapped as HTML).' },
      folder: { type: 'string', description: 'Notes folder. Defaults to the default account folder.' },
    },
    outputs: {
      id: { type: 'string', description: 'Best-effort note id; may be null.' },
      title: { type: 'string' },
      folder: { type: 'string' },
    },
    buildPayload: (inputs, snapshot) => {
      assertNoteFolder(snapshot, inputs.folder);
      return {
        title: inputs.title,
        body: typeof inputs.body === 'string' ? inputs.body : '',
        ...(inputs.folder !== undefined ? { folder: inputs.folder } : {}),
      };
    },
  },
  {
    verb: 'note-read',
    subcommand: 'note-read',
    name: 'Read notes',
    description: 'List notes from macOS Notes (via AppleScript, best-effort, slow). Side-effecting reads.',
    inputs: {
      folder: { type: 'string', description: 'Restrict to this Notes folder.' },
      limit: { type: 'number', description: 'Maximum notes to return. Defaults to 20.', default: 20 },
    },
    outputs: {
      notes: { type: 'array', description: 'Matching notes (best-effort).', items: { type: 'object', properties: noteRowProps } },
      count: { type: 'number' },
    },
    buildPayload: (inputs, snapshot) => {
      assertNoteFolder(snapshot, inputs.folder);
      return {
        ...(inputs.folder !== undefined ? { folder: inputs.folder } : {}),
        limit: typeof inputs.limit === 'number' ? inputs.limit : 20,
      };
    },
  },
];

function buildAppleEntry(
  integ: Integration,
  snapshot: AppleSnapshot,
  spec: AppleVerbSpec,
  deps: GeneratedToolDeps,
): BuiltinToolEntry {
  const id = appleToolId(integ, spec.verb);
  const definition: ToolDefinition = {
    id,
    name: spec.name,
    description: `${spec.description} (integration "${integ.id}")`,
    source: 'builtin',
    inputs: spec.inputs,
    outputs: spec.outputs,
    implementation: { type: 'builtin', builtinName: id },
  };
  return {
    definition,
    async execute(inputs) {
      const payload = spec.buildPayload(inputs, snapshot); // may throw on validation
      const binaryPath = resolveAppleBinary(deps);
      const res = await runAppleSubcommand(binaryPath, spec.subcommand, payload, { timeoutSec: 30 });
      if (res.status !== 'ok') {
        throw new Error(res.errorMessage ?? `apple ${spec.subcommand} failed (${res.status})`);
      }
      const data = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>;
      return { ...data, result: JSON.stringify(data) };
    },
  };
}

function addAppleEntries(out: Map<string, BuiltinToolEntry>, integ: Integration, deps: GeneratedToolDeps): void {
  const snapshot = readAppleSnapshot(integ);
  if (!snapshot) return;
  for (const spec of APPLE_VERBS) {
    const entry = buildAppleEntry(integ, snapshot, spec, deps);
    out.set(entry.definition.id, entry);
  }
}

function resolveAppleTool(
  store: IntegrationsStore,
  toolId: string,
  deps: GeneratedToolDeps,
): BuiltinToolEntry | undefined {
  // Format: apple.<integration-slug>.<verb>. Slugs have no dots; verbs have
  // no dots (only hyphens), so the verb is everything after the last dot.
  const rest = toolId.slice('apple.'.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const slug = rest.slice(0, dot);
  const verb = rest.slice(dot + 1);
  const spec = APPLE_VERBS.find((v) => v.verb === verb);
  if (!spec) return undefined;
  const integ = store.getIntegration(`user:${slug}`);
  if (!integ || integ.kind !== 'apple') return undefined;
  const snapshot = readAppleSnapshot(integ);
  if (!snapshot) return undefined;
  return buildAppleEntry(integ, snapshot, spec, deps);
}

