/**
 * Postgres connector driver.
 *
 * Mirrors csv-driver.ts in shape — `inferPostgresSnapshot` walks
 * `information_schema` once at integration-add time, then `findRows`
 * / `findOne` / `countRows` are the read paths the generated tools
 * (in `generated-tools.ts`) call at run time.
 *
 * Every query is parameterised — `where` keys are validated against
 * the snapshot's column list before they're spliced into the SQL, so
 * an attacker controlling a `where: { '"; DROP TABLE …': 1 }` value
 * still can't escape the parameter binding. Identifier validation is
 * the gate that keeps SQL injection out.
 *
 * Connection pooling: one `pg.Pool` per integration id, cached at the
 * module level. The pool persists for the dashboard process's lifetime;
 * on integration delete the caller invokes `closePostgresPool(id)` to
 * drain it. Daemon shutdown calls `closeAllPostgresPools()` to flush
 * everything (TODO once the dashboard wires that hook).
 */

import { Pool, type PoolConfig } from 'pg';

export type PgColumnType = 'number' | 'string' | 'boolean' | 'object' | 'array';

export interface PgColumnSpec {
  name: string;
  /** Source pg type as reported by `information_schema.columns.data_type`. */
  pgType: string;
  /** Mapped JSON-y type the planner / template resolver can reason about. */
  type: PgColumnType;
  format?: 'date' | 'timestamp' | 'uuid' | 'base64';
  nullable: boolean;
}

export interface PgTableSpec {
  schema: string;
  name: string;
  columns: PgColumnSpec[];
  primaryKey?: string;
}

export interface PgSnapshot {
  /** Tables keyed by `"<schema>.<table>"`. */
  tables: Record<string, PgTableSpec>;
  introspectedAt: string;
}

export interface PgConnectionConfig {
  /** Stable id used as the pool cache key. Match it to the integration id. */
  integrationId: string;
  /** Postgres connection string (DSN). */
  connectionString: string;
  /** Schemas to introspect / scope queries to. Defaults to ['public']. */
  schemas?: string[];
  /** Override the default pool sizing per-integration. */
  poolMax?: number;
  /** Idle timeout before pg releases connections, in ms. Defaults to 30s. */
  idleTimeoutMillis?: number;
}

const POOLS = new Map<string, Pool>();

// Identifier regex — must match Postgres unquoted identifier rules
// (lowercase letters, digits, underscores, starting with a letter or
// underscore). Anything fancier (mixed case, reserved words) needs to
// quote at the source; we don't support quoted identifiers here yet.
const IDENT_RE = /^[a-z_][a-z0-9_]*$/i;

function assertIdent(name: string, kind: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Unsafe ${kind} "${name}" — must match ${IDENT_RE} (no quoted/mixed-case identifiers in PR 4.B).`);
  }
}

/**
 * Get a `pg.Pool` for this integration, creating it on first use.
 * Idempotent — repeated calls return the cached pool. Callers should
 * NOT call `pool.end()` directly; use `closePostgresPool(id)` so the
 * cache stays in sync.
 */
export function getPostgresPool(config: PgConnectionConfig): Pool {
  const cached = POOLS.get(config.integrationId);
  if (cached) return cached;
  const pgConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: config.poolMax ?? 2,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    // Connection-level statement timeout so a runaway query doesn't
    // tie up the pool indefinitely. Generous default (60s) — the
    // notify dispatcher's own timeout is shorter.
    statement_timeout: 60_000,
  };
  const pool = new Pool(pgConfig);
  POOLS.set(config.integrationId, pool);
  return pool;
}

/** Drain + drop a single integration's pool. Idempotent. */
export async function closePostgresPool(integrationId: string): Promise<void> {
  const pool = POOLS.get(integrationId);
  if (!pool) return;
  POOLS.delete(integrationId);
  try { await pool.end(); } catch { /* best-effort */ }
}

/** Drain every cached pool. Call from process shutdown. */
export async function closeAllPostgresPools(): Promise<void> {
  const pools = Array.from(POOLS.values());
  POOLS.clear();
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
}

// ── Introspection ──────────────────────────────────────────────────────

/**
 * Walk `information_schema.columns` (+ table-level primary-key lookup)
 * once and build a snapshot the dashboard stores on the integration row.
 *
 * Only tables in the requested `schemas` list are returned. Anything in
 * `pg_catalog` / `information_schema` is filtered out at the query
 * level — we never expose system catalogs as tools.
 */
export async function inferPostgresSnapshot(config: PgConnectionConfig): Promise<PgSnapshot> {
  const schemas = (config.schemas && config.schemas.length > 0 ? config.schemas : ['public']);
  for (const s of schemas) assertIdent(s, 'schema');

  const pool = getPostgresPool(config);
  const colsRes = await pool.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: 'YES' | 'NO';
  }>(
    `SELECT table_schema, table_name, column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = ANY($1::text[])
       AND table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name, ordinal_position`,
    [schemas],
  );

  const pkRes = await pool.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
  }>(
    `SELECT kcu.table_schema, kcu.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = ANY($1::text[])`,
    [schemas],
  );

  const pkByTable = new Map<string, string>();
  for (const row of pkRes.rows) {
    pkByTable.set(`${row.table_schema}.${row.table_name}`, row.column_name);
  }

  const tables: Record<string, PgTableSpec> = {};
  for (const row of colsRes.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    let table = tables[key];
    if (!table) {
      table = { schema: row.table_schema, name: row.table_name, columns: [] };
      const pk = pkByTable.get(key);
      if (pk) table.primaryKey = pk;
      tables[key] = table;
    }
    table.columns.push(mapColumnType(row.column_name, row.data_type, row.is_nullable === 'YES'));
  }

  return { tables, introspectedAt: new Date().toISOString() };
}

/**
 * Translate a `pg_type` name into our typed schema. Conservative — for
 * exotic types (intervals, ranges, custom types) we collapse to
 * `string` and let downstream consumers stringify whatever pg returns.
 */
export function mapColumnType(name: string, pgType: string, nullable: boolean): PgColumnSpec {
  switch (pgType) {
    case 'smallint': case 'integer': case 'bigint':
      return { name, pgType, type: 'number', nullable };
    case 'real': case 'double precision': case 'numeric': case 'decimal':
      return { name, pgType, type: 'number', nullable };
    case 'boolean':
      return { name, pgType, type: 'boolean', nullable };
    case 'timestamp without time zone': case 'timestamp with time zone':
      return { name, pgType, type: 'string', format: 'timestamp', nullable };
    case 'date':
      return { name, pgType, type: 'string', format: 'date', nullable };
    case 'uuid':
      return { name, pgType, type: 'string', format: 'uuid', nullable };
    case 'bytea':
      return { name, pgType, type: 'string', format: 'base64', nullable };
    case 'json': case 'jsonb':
      return { name, pgType, type: 'object', nullable };
    case 'ARRAY':
      // information_schema.data_type reports ARRAY for any array column;
      // the element type lives in udt_name (e.g. _text). We collapse to
      // generic `array` for now — the read tools return whatever pg gives.
      return { name, pgType, type: 'array', nullable };
    default:
      // text, varchar, character, name, citext, intervals, ranges, …
      return { name, pgType, type: 'string', nullable };
  }
}

// ── Read paths ─────────────────────────────────────────────────────────

export interface FindOptions {
  where?: Record<string, unknown>;
  limit?: number;
  orderBy?: string;
}

/**
 * `SELECT * FROM <schema>.<table> WHERE …` with parameterised bindings.
 * Returns rows as plain objects keyed by column name. pg's default JSON
 * encoders give us numbers / booleans / Date instances; we leave those
 * as-is (downstream consumers either JSON.stringify them or read them
 * directly).
 */
export async function findRows(
  config: PgConnectionConfig,
  table: PgTableSpec,
  opts: FindOptions = {},
): Promise<Record<string, unknown>[]> {
  const { sql, values } = buildSelect(table, opts);
  const pool = getPostgresPool(config);
  const res = await pool.query(sql, values);
  return res.rows;
}

export async function findOneRow(
  config: PgConnectionConfig,
  table: PgTableSpec,
  opts: FindOptions = {},
): Promise<Record<string, unknown> | null> {
  const rows = await findRows(config, table, { ...opts, limit: 1 });
  return rows.length > 0 ? rows[0] : null;
}

export async function countRows(
  config: PgConnectionConfig,
  table: PgTableSpec,
  where: Record<string, unknown> = {},
): Promise<number> {
  assertIdent(table.schema, 'schema');
  assertIdent(table.name, 'table');
  const { whereClause, values } = buildWhere(table, where, 1);
  const sql = `SELECT COUNT(*)::bigint AS n FROM "${table.schema}"."${table.name}"${whereClause}`;
  const pool = getPostgresPool(config);
  const res = await pool.query<{ n: string }>(sql, values);
  // bigint returns as string from pg; cap at MAX_SAFE_INTEGER for the
  // typed `number` output. Counts past 2^53 are exotic enough to call
  // out via the upstream UI rather than try to support generically.
  const raw = res.rows[0]?.n ?? '0';
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

// ── SQL builders ───────────────────────────────────────────────────────

interface BuiltSelect {
  sql: string;
  values: unknown[];
}

function buildSelect(table: PgTableSpec, opts: FindOptions): BuiltSelect {
  assertIdent(table.schema, 'schema');
  assertIdent(table.name, 'table');
  const limit = clampLimit(opts.limit ?? 100);
  const { whereClause, values } = buildWhere(table, opts.where ?? {}, 1);
  let orderClause = '';
  if (opts.orderBy && opts.orderBy.trim().length > 0) {
    // Allow "col asc", "col desc"; reject anything else.
    const m = /^([a-z_][a-z0-9_]*)\s*(asc|desc)?$/i.exec(opts.orderBy.trim());
    if (!m) throw new Error(`Unsafe order_by "${opts.orderBy}" — must be "<column>" or "<column> ASC|DESC".`);
    const col = m[1];
    if (!table.columns.some((c) => c.name === col)) {
      throw new Error(`order_by references unknown column "${col}" on ${table.schema}.${table.name}.`);
    }
    const dir = (m[2] ?? 'asc').toUpperCase();
    orderClause = ` ORDER BY "${col}" ${dir}`;
  }
  const sql = `SELECT * FROM "${table.schema}"."${table.name}"${whereClause}${orderClause} LIMIT ${limit}`;
  return { sql, values };
}

interface BuiltWhere {
  whereClause: string;
  values: unknown[];
}

/**
 * Builds a `WHERE col1 = $1 AND col2 = $2 …` clause from the `where`
 * map. Validates every key against the snapshot's column list — an
 * unknown key throws *before* the SQL is sent. Values are bound, never
 * interpolated.
 */
function buildWhere(
  table: PgTableSpec,
  where: Record<string, unknown>,
  startIndex: number,
): BuiltWhere {
  const knownCols = new Set(table.columns.map((c) => c.name));
  const conditions: string[] = [];
  const values: unknown[] = [];
  let n = startIndex;
  for (const [key, val] of Object.entries(where ?? {})) {
    if (!knownCols.has(key)) {
      throw new Error(`where references unknown column "${key}" on ${table.schema}.${table.name}.`);
    }
    if (val === null) {
      conditions.push(`"${key}" IS NULL`);
      continue;
    }
    conditions.push(`"${key}" = $${n}`);
    values.push(val);
    n++;
  }
  return {
    whereClause: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

const MAX_LIMIT = 10_000;

function clampLimit(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 100;
  if (v < 1) return 1;
  if (v > MAX_LIMIT) return MAX_LIMIT;
  return v;
}
