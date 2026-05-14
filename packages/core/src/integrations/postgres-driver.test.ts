import { describe, it, expect, afterAll } from 'vitest';
import {
  mapColumnType,
  inferPostgresSnapshot,
  findRows,
  findOneRow,
  countRows,
  closePostgresPool,
  closeAllPostgresPools,
  type PgConnectionConfig,
} from './postgres-driver.js';

// ── Unit tests (no DB) ─────────────────────────────────────────────────

describe('mapColumnType', () => {
  it('maps numeric pg types to number', () => {
    for (const t of ['smallint', 'integer', 'bigint', 'real', 'double precision', 'numeric']) {
      expect(mapColumnType('x', t, false).type).toBe('number');
    }
  });

  it('maps boolean → boolean', () => {
    expect(mapColumnType('b', 'boolean', true)).toEqual({ name: 'b', pgType: 'boolean', type: 'boolean', nullable: true });
  });

  it('maps date / timestamp / uuid / bytea with format hints', () => {
    expect(mapColumnType('d', 'date', false).format).toBe('date');
    expect(mapColumnType('ts', 'timestamp without time zone', false).format).toBe('timestamp');
    expect(mapColumnType('tsz', 'timestamp with time zone', false).format).toBe('timestamp');
    expect(mapColumnType('u', 'uuid', false).format).toBe('uuid');
    expect(mapColumnType('img', 'bytea', false).format).toBe('base64');
  });

  it('maps json + jsonb to object', () => {
    expect(mapColumnType('j', 'json', false).type).toBe('object');
    expect(mapColumnType('jb', 'jsonb', false).type).toBe('object');
  });

  it('maps ARRAY to array', () => {
    expect(mapColumnType('tags', 'ARRAY', false).type).toBe('array');
  });

  it('falls back to string for unknown types', () => {
    expect(mapColumnType('x', 'cidr', false).type).toBe('string');
    expect(mapColumnType('x', 'interval', false).type).toBe('string');
    expect(mapColumnType('x', 'text', false).type).toBe('string');
  });
});

// ── Live DB tests (gated by PG_TEST_URL) ───────────────────────────────

const PG_TEST_URL = process.env.PG_TEST_URL;
const liveDescribe = PG_TEST_URL ? describe : describe.skip;

liveDescribe('postgres driver (live)', () => {
  const config: PgConnectionConfig = {
    integrationId: 'test:driver',
    connectionString: PG_TEST_URL ?? '',
    schemas: ['public'],
  };

  afterAll(async () => {
    await closeAllPostgresPools();
  });

  it('introspects information_schema and returns typed columns', async () => {
    // Set up a tiny test table for the run.
    const { getPostgresPool } = await import('./postgres-driver.js');
    const pool = getPostgresPool(config);
    await pool.query('CREATE SCHEMA IF NOT EXISTS public');
    await pool.query('DROP TABLE IF EXISTS sua_driver_test');
    await pool.query(`
      CREATE TABLE sua_driver_test (
        id integer PRIMARY KEY,
        active boolean NOT NULL,
        created_at timestamp with time zone NOT NULL,
        email text
      )
    `);
    await pool.query(`INSERT INTO sua_driver_test (id, active, created_at, email) VALUES
      (1, true, now(), 'a@x.com'),
      (2, false, now(), 'b@x.com'),
      (3, true, now(), null)`);

    const snap = await inferPostgresSnapshot(config);
    const tbl = snap.tables['public.sua_driver_test'];
    expect(tbl).toBeDefined();
    expect(tbl.primaryKey).toBe('id');
    const cols = Object.fromEntries(tbl.columns.map((c) => [c.name, c]));
    expect(cols.id.type).toBe('number');
    expect(cols.active.type).toBe('boolean');
    expect(cols.created_at.type).toBe('string');
    expect(cols.created_at.format).toBe('timestamp');
    expect(cols.email.nullable).toBe(true);

    const rows = await findRows(config, tbl, { where: { active: true }, orderBy: 'id ASC' });
    expect(rows.map((r) => r.id)).toEqual([1, 3]);

    const one = await findOneRow(config, tbl, { where: { id: 2 } });
    expect(one?.email).toBe('b@x.com');

    expect(await countRows(config, tbl)).toBe(3);
    expect(await countRows(config, tbl, { active: true })).toBe(2);

    await pool.query('DROP TABLE sua_driver_test');
    await closePostgresPool(config.integrationId);
  });

  it('rejects where keys that aren\'t in the schema', async () => {
    const { getPostgresPool } = await import('./postgres-driver.js');
    const pool = getPostgresPool({ ...config, integrationId: 'test:driver-2' });
    await pool.query('CREATE TABLE IF NOT EXISTS sua_reject_test (id integer)');
    const snap = await inferPostgresSnapshot({ ...config, integrationId: 'test:driver-2' });
    const tbl = snap.tables['public.sua_reject_test'];
    await expect(
      findRows({ ...config, integrationId: 'test:driver-2' }, tbl, { where: { '"; DROP TABLE foo;': 1 } }),
    ).rejects.toThrow(/unknown column/);
    await pool.query('DROP TABLE sua_reject_test');
    await closePostgresPool('test:driver-2');
  });

  it('rejects unsafe order_by expressions', async () => {
    const { getPostgresPool } = await import('./postgres-driver.js');
    const pool = getPostgresPool({ ...config, integrationId: 'test:driver-3' });
    await pool.query('CREATE TABLE IF NOT EXISTS sua_order_test (id integer)');
    const snap = await inferPostgresSnapshot({ ...config, integrationId: 'test:driver-3' });
    const tbl = snap.tables['public.sua_order_test'];
    await expect(
      findRows({ ...config, integrationId: 'test:driver-3' }, tbl, { orderBy: 'id; DROP TABLE foo' }),
    ).rejects.toThrow(/Unsafe order_by/);
    await pool.query('DROP TABLE sua_order_test');
    await closePostgresPool('test:driver-3');
  });
});
