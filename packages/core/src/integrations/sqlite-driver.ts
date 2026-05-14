/**
 * SQLite connector driver.
 *
 * Mirrors postgres-driver.ts in shape — `inferSqliteSnapshot` walks
 * `sqlite_master` + `PRAGMA table_info` once at integration-add time,
 * then `findRows` / `findOneRow` / `countRows` are the read paths the
 * generated tools (in `generated-tools.ts`) call at run time.
 *
 * Differences from the postgres driver:
 *   - No DSN / secret indirection: the integration stores a filesystem
 *     `path` directly (same shape as the `csv` kind).
 *   - Synchronous API — `node:sqlite` is sync, same as our other store
 *     modules. The generated-tools layer wraps the calls in an async
 *     `execute()` so the executor interface stays uniform.
 *   - No connection pool: a `DatabaseSync` is cheap to open. We cache
 *     one handle per integration id and close it on
 *     `closeSqliteDatabase(id)` (called on integration delete).
 *   - Schema is implicit (`main`) — attached databases aren't supported.
 *
 * Every query is parameterised — `where` keys are validated against
 * the snapshot's column list before they're spliced into the SQL, so
 * a `where: { '"; DROP TABLE …': 1 }` value can't escape parameter
 * binding. Identifier validation is the gate that keeps SQL injection
 * out (same rule as the pg driver).
 */

import { DatabaseSync, type DatabaseSyncOptions, type SQLInputValue } from 'node:sqlite';

/**
 * SQLite's storage classes (NULL/INTEGER/REAL/TEXT/BLOB) plus the
 * declared column-type affinities you actually see in DDL. We collapse
 * to the same enum as the pg driver so downstream consumers can reason
 * about both kinds uniformly.
 */
export type SqliteColumnType = 'number' | 'string' | 'boolean' | 'object' | 'array';

export interface SqliteColumnSpec {
  name: string;
  /** Declared column type as reported by `PRAGMA table_info`. */
  sqliteType: string;
  /** Mapped JSON-y type — same enum as PgColumnSpec.type. */
  type: SqliteColumnType;
  format?: 'date' | 'timestamp' | 'base64';
  nullable: boolean;
}

export interface SqliteTableSpec {
  /** Always 'main' today — kept for symmetry with PgTableSpec. */
  schema: 'main';
  name: string;
  columns: SqliteColumnSpec[];
  primaryKey?: string;
}

export interface SqliteSnapshot {
  /** Tables keyed by `"main.<table>"` (symmetry with PgSnapshot). */
  tables: Record<string, SqliteTableSpec>;
  introspectedAt: string;
}

export interface SqliteConnectionConfig {
  /** Stable id used as the handle cache key. Match it to the integration id. */
  integrationId: string;
  /** Path to the SQLite file. Must exist. */
  path: string;
  /** Open read-only by default — every generated tool today is a reader. */
  readonly?: boolean;
}

const HANDLES = new Map<string, DatabaseSync>();

// Same identifier rule as the pg driver. SQLite is permissive about table
// names but we deliberately reject anything we'd have to quote so the
// generated tool ids stay safe to splice into SQL.
const IDENT_RE = /^[a-z_][a-z0-9_]*$/i;

function assertIdent(name: string, kind: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Unsafe ${kind} "${name}" — must match ${IDENT_RE} (no quoted/mixed-case identifiers in PR 4.E).`);
  }
}

/**
 * Open (or return the cached handle for) this integration's SQLite file.
 * Idempotent — repeated calls return the cached handle. Callers should
 * NOT call `.close()` directly; use `closeSqliteDatabase(id)` so the
 * cache stays in sync.
 */
export function getSqliteDatabase(config: SqliteConnectionConfig): DatabaseSync {
  const cached = HANDLES.get(config.integrationId);
  if (cached) return cached;
  const opts: DatabaseSyncOptions = { readOnly: config.readonly ?? true };
  const db = new DatabaseSync(config.path, opts);
  HANDLES.set(config.integrationId, db);
  return db;
}

/** Close + drop a single integration's handle. Idempotent. */
export function closeSqliteDatabase(integrationId: string): void {
  const db = HANDLES.get(integrationId);
  if (!db) return;
  HANDLES.delete(integrationId);
  try { db.close(); } catch { /* best-effort */ }
}

/** Close every cached handle. Call from process shutdown. */
export function closeAllSqliteDatabases(): void {
  for (const id of Array.from(HANDLES.keys())) closeSqliteDatabase(id);
}

// ── Introspection ──────────────────────────────────────────────────────

/**
 * Walk `sqlite_master` + `PRAGMA table_info` once and build a snapshot
 * the dashboard stores on the integration row. System tables
 * (`sqlite_%`) are excluded. Views are excluded too — only base tables
 * become tools today.
 */
export function inferSqliteSnapshot(config: SqliteConnectionConfig): SqliteSnapshot {
  const db = getSqliteDatabase(config);
  const tableNames = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>;

  const tables: Record<string, SqliteTableSpec> = {};
  for (const { name: tableName } of tableNames) {
    // Skip tables whose names we can't safely splice into SQL. They
    // simply don't get tools generated — the user can rename or quote
    // them at the schema level if they want exposure.
    if (!IDENT_RE.test(tableName)) continue;

    const cols = db
      .prepare(`PRAGMA table_info("${tableName}")`)
      .all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;

    const columns: SqliteColumnSpec[] = [];
    let primaryKey: string | undefined;
    for (const c of cols) {
      if (c.pk === 1 && !primaryKey) primaryKey = c.name;
      columns.push(mapColumnType(c.name, c.type, c.notnull === 0));
    }
    if (columns.length === 0) continue;

    tables[`main.${tableName}`] = {
      schema: 'main',
      name: tableName,
      columns,
      ...(primaryKey ? { primaryKey } : {}),
    };
  }

  return { tables, introspectedAt: new Date().toISOString() };
}

/**
 * Translate a SQLite declared column type into our typed schema.
 * SQLite's type affinity is loose — we match on common DDL spellings,
 * then fall back to TEXT (`string`). The type-affinity rules are:
 * https://www.sqlite.org/datatype3.html#determination_of_column_affinity
 */
export function mapColumnType(name: string, sqliteType: string, nullable: boolean): SqliteColumnSpec {
  const t = sqliteType.toUpperCase();
  if (t.includes('INT')) return { name, sqliteType, type: 'number', nullable };
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB') || t.includes('NUMERIC') || t.includes('DECIMAL')) {
    return { name, sqliteType, type: 'number', nullable };
  }
  if (t.includes('BOOL')) return { name, sqliteType, type: 'boolean', nullable };
  if (t.includes('BLOB')) return { name, sqliteType, type: 'string', format: 'base64', nullable };
  if (t === 'DATE') return { name, sqliteType, type: 'string', format: 'date', nullable };
  if (t.includes('TIMESTAMP') || t.includes('DATETIME')) {
    return { name, sqliteType, type: 'string', format: 'timestamp', nullable };
  }
  if (t.includes('JSON')) return { name, sqliteType, type: 'object', nullable };
  // TEXT, VARCHAR, CHAR, CLOB, or an empty declared type — all string.
  return { name, sqliteType, type: 'string', nullable };
}

// ── Read paths ─────────────────────────────────────────────────────────

export interface SqliteFindOptions {
  where?: Record<string, unknown>;
  limit?: number;
  orderBy?: string;
}

export function findRows(
  config: SqliteConnectionConfig,
  table: SqliteTableSpec,
  opts: SqliteFindOptions = {},
): Record<string, unknown>[] {
  const { sql, values } = buildSelect(table, opts);
  const db = getSqliteDatabase(config);
  return db.prepare(sql).all(...values) as Record<string, unknown>[];
}

export function findOneRow(
  config: SqliteConnectionConfig,
  table: SqliteTableSpec,
  opts: SqliteFindOptions = {},
): Record<string, unknown> | null {
  const rows = findRows(config, table, { ...opts, limit: 1 });
  return rows.length > 0 ? rows[0] : null;
}

export function countRows(
  config: SqliteConnectionConfig,
  table: SqliteTableSpec,
  where: Record<string, unknown> = {},
): number {
  assertIdent(table.name, 'table');
  const { whereClause, values } = buildWhere(table, where);
  const sql = `SELECT COUNT(*) AS n FROM "${table.name}"${whereClause}`;
  const db = getSqliteDatabase(config);
  const row = db.prepare(sql).get(...values) as { n: number | bigint } | undefined;
  const raw = row?.n ?? 0;
  return typeof raw === 'bigint'
    ? (raw > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(raw))
    : Number(raw);
}

// ── SQL builders ───────────────────────────────────────────────────────

interface BuiltSelect {
  sql: string;
  values: SQLInputValue[];
}

function buildSelect(table: SqliteTableSpec, opts: SqliteFindOptions): BuiltSelect {
  assertIdent(table.name, 'table');
  const limit = clampLimit(opts.limit ?? 100);
  const { whereClause, values } = buildWhere(table, opts.where ?? {});
  let orderClause = '';
  if (opts.orderBy && opts.orderBy.trim().length > 0) {
    const m = /^([a-z_][a-z0-9_]*)\s*(asc|desc)?$/i.exec(opts.orderBy.trim());
    if (!m) throw new Error(`Unsafe order_by "${opts.orderBy}" — must be "<column>" or "<column> ASC|DESC".`);
    const col = m[1];
    if (!table.columns.some((c) => c.name === col)) {
      throw new Error(`order_by references unknown column "${col}" on ${table.name}.`);
    }
    const dir = (m[2] ?? 'asc').toUpperCase();
    orderClause = ` ORDER BY "${col}" ${dir}`;
  }
  const sql = `SELECT * FROM "${table.name}"${whereClause}${orderClause} LIMIT ${limit}`;
  return { sql, values };
}

interface BuiltWhere {
  whereClause: string;
  values: SQLInputValue[];
}

function buildWhere(
  table: SqliteTableSpec,
  where: Record<string, unknown>,
): BuiltWhere {
  const knownCols = new Set(table.columns.map((c) => c.name));
  const conditions: string[] = [];
  const values: SQLInputValue[] = [];
  for (const [key, val] of Object.entries(where ?? {})) {
    if (!knownCols.has(key)) {
      throw new Error(`where references unknown column "${key}" on ${table.name}.`);
    }
    if (val === null) {
      conditions.push(`"${key}" IS NULL`);
      continue;
    }
    conditions.push(`"${key}" = ?`);
    values.push(toSqliteBindable(val, key, table.name));
  }
  return {
    whereClause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

/**
 * Coerce a where-value into a type node:sqlite will bind. Booleans
 * become 0/1 (how SQLite actually stores them). Numbers, strings,
 * bigints, and Uint8Arrays pass through. Anything else throws — we'd
 * rather fail loudly than silently stringify a complex value.
 */
function toSqliteBindable(val: unknown, column: string, table: string): SQLInputValue {
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'bigint') return val;
  if (val instanceof Uint8Array) return val;
  throw new Error(`Cannot bind ${typeof val} to where["${column}"] on ${table} — pass string/number/boolean/null/Uint8Array.`);
}

const MAX_LIMIT = 10_000;

function clampLimit(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 100;
  if (v < 1) return 1;
  if (v > MAX_LIMIT) return MAX_LIMIT;
  return v;
}
