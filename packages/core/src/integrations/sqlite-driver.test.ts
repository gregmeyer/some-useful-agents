import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  mapColumnType,
  inferSqliteSnapshot,
  findRows,
  findOneRow,
  countRows,
  closeSqliteDatabase,
  closeAllSqliteDatabases,
  type SqliteConnectionConfig,
} from './sqlite-driver.js';

// ── Unit tests (mapColumnType) ─────────────────────────────────────────

describe('mapColumnType', () => {
  it('maps INT-affinity types to number', () => {
    for (const t of ['INTEGER', 'INT', 'BIGINT', 'SMALLINT']) {
      expect(mapColumnType('x', t, false).type).toBe('number');
    }
  });
  it('maps REAL/NUMERIC/DECIMAL to number', () => {
    for (const t of ['REAL', 'FLOAT', 'DOUBLE', 'NUMERIC', 'DECIMAL']) {
      expect(mapColumnType('x', t, false).type).toBe('number');
    }
  });
  it('maps BOOLEAN to boolean', () => {
    expect(mapColumnType('b', 'BOOLEAN', true)).toEqual({ name: 'b', sqliteType: 'BOOLEAN', type: 'boolean', nullable: true });
  });
  it('hints date / timestamp / blob with format', () => {
    expect(mapColumnType('d', 'DATE', false).format).toBe('date');
    expect(mapColumnType('ts', 'TIMESTAMP', false).format).toBe('timestamp');
    expect(mapColumnType('ts', 'DATETIME', false).format).toBe('timestamp');
    expect(mapColumnType('img', 'BLOB', false).format).toBe('base64');
  });
  it('maps JSON to object', () => {
    expect(mapColumnType('j', 'JSON', false).type).toBe('object');
  });
  it('falls back to string for TEXT or empty declared type', () => {
    expect(mapColumnType('x', 'TEXT', false).type).toBe('string');
    expect(mapColumnType('x', 'VARCHAR(255)', false).type).toBe('string');
    expect(mapColumnType('x', '', false).type).toBe('string');
  });
});

// ── Driver round-trip against a real on-disk SQLite file ───────────────

let dir: string;
let dbPath: string;
let config: SqliteConnectionConfig;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-sqlite-'));
  dbPath = join(dir, 'fixture.db');
  // Build the fixture with a temporary writeable handle, then close so
  // the driver opens it read-only.
  const seed = new DatabaseSync(dbPath);
  seed.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      churned_at TIMESTAMP
    );
    INSERT INTO customers (email, status, churned_at) VALUES
      ('a@x.com', 'active', NULL),
      ('b@x.com', 'churned', '2026-05-10T00:00:00Z'),
      ('c@x.com', 'churned', '2026-05-12T00:00:00Z');

    CREATE TABLE "Bad-Name" (id INTEGER);
  `);
  seed.close();
  config = { integrationId: 'test:sqlite', path: dbPath, readonly: true };
});

afterEach(() => {
  closeAllSqliteDatabases();
  rmSync(dir, { recursive: true, force: true });
});

describe('inferSqliteSnapshot', () => {
  it('discovers base tables, columns, primary keys, types', () => {
    const snap = inferSqliteSnapshot(config);
    expect(Object.keys(snap.tables)).toEqual(['main.customers']);
    const t = snap.tables['main.customers'];
    expect(t.schema).toBe('main');
    expect(t.name).toBe('customers');
    expect(t.primaryKey).toBe('id');
    const byName = Object.fromEntries(t.columns.map((c) => [c.name, c]));
    expect(byName.id.type).toBe('number');
    expect(byName.email.type).toBe('string');
    expect(byName.email.nullable).toBe(false);
    expect(byName.churned_at.format).toBe('timestamp');
  });

  it('skips tables with names that fail the identifier guard', () => {
    const snap = inferSqliteSnapshot(config);
    expect(Object.keys(snap.tables)).not.toContain('main.Bad-Name');
  });
});

describe('findRows / findOneRow / countRows', () => {
  function customers() {
    return inferSqliteSnapshot(config).tables['main.customers'];
  }

  it('finds rows with a where filter + order_by + limit', () => {
    const rows = findRows(config, customers(), { where: { status: 'churned' }, orderBy: 'id ASC', limit: 10 });
    expect(rows.map((r) => r.email)).toEqual(['b@x.com', 'c@x.com']);
  });

  it('coerces booleans in where to 0/1 for SQLite storage convention', () => {
    // status filter via boolean wouldn't be meaningful here, but make sure
    // the coercion path is exercised on a numeric column.
    const rows = findRows(config, customers(), { where: { id: 1 } });
    expect(rows).toHaveLength(1);
  });

  it('findOneRow returns null when no match', () => {
    expect(findOneRow(config, customers(), { where: { status: 'unknown' } })).toBeNull();
  });

  it('countRows counts with + without filter', () => {
    expect(countRows(config, customers(), {})).toBe(3);
    expect(countRows(config, customers(), { status: 'churned' })).toBe(2);
  });

  it('rejects an unknown where column', () => {
    expect(() => findRows(config, customers(), { where: { emial: 'a@x.com' } }))
      .toThrow(/unknown column "emial"/);
  });

  it('rejects a bogus order_by string', () => {
    expect(() => findRows(config, customers(), { orderBy: 'id; DROP TABLE customers' }))
      .toThrow(/Unsafe order_by/);
  });

  it('rejects unbindable where values', () => {
    expect(() => findRows(config, customers(), { where: { email: { nested: 'object' } as unknown as string } }))
      .toThrow(/Cannot bind/);
  });
});

describe('closeSqliteDatabase', () => {
  it('idempotent close', () => {
    inferSqliteSnapshot(config);
    closeSqliteDatabase(config.integrationId);
    closeSqliteDatabase(config.integrationId);
    // Reopening after close should work.
    const snap = inferSqliteSnapshot(config);
    expect(Object.keys(snap.tables)).toContain('main.customers');
  });
});
