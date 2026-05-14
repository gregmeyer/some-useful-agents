import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IntegrationsStore } from '../integrations-store.js';
import { inferCsvSnapshot } from './csv-driver.js';
import { inferSqliteSnapshot, closeAllSqliteDatabases } from './sqlite-driver.js';
import {
  listGeneratedTools,
  getGeneratedTool,
  csvReadToolId,
  csvCountToolId,
  sqliteFindToolId,
  sqliteCountToolId,
  sqliteFindOneToolId,
} from './generated-tools.js';

let dir: string;
let store: IntegrationsStore;
let csvPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-csv-tools-'));
  store = new IntegrationsStore(join(dir, 'runs.db'));
  csvPath = join(dir, 'customers.csv');
  writeFileSync(csvPath, [
    'id,active,email',
    '1,true,a@x.com',
    '2,false,b@x.com',
    '3,true,c@x.com',
  ].join('\n'), 'utf-8');
});

afterEach(() => {
  closeAllSqliteDatabases();
  try { store.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

function seedCustomers() {
  const snapshot = inferCsvSnapshot(csvPath, { cwd: dir });
  store.upsertIntegration({
    id: 'user:customers',
    packId: null,
    kind: 'csv',
    name: 'Customers CSV',
    config: { path: csvPath, schema: snapshot },
    secretRefs: [],
  });
  return snapshot;
}

describe('listGeneratedTools', () => {
  it('synthesises read + count tools per csv integration', () => {
    seedCustomers();
    const tools = listGeneratedTools(store);
    expect(Array.from(tools.keys()).sort()).toEqual([
      'csv.customers.count',
      'csv.customers.read',
    ]);
    const readDef = tools.get('csv.customers.read')!.definition;
    expect(readDef.source).toBe('builtin');
    expect(readDef.outputs.rows.type).toBe('array');
    expect(readDef.outputs.row_count.type).toBe('number');
    // PR 4.C: nested per-row schema declared on `rows.items.properties`
    // so save-time template validation can walk `rows.0.<col>` paths.
    const rowItem = readDef.outputs.rows.items;
    expect(rowItem?.type).toBe('object');
    expect(rowItem?.properties?.email?.type).toBe('string');
    expect(rowItem?.properties?.active?.type).toBe('boolean');
    expect(rowItem?.properties?.id?.type).toBe('number');
    // The column list itself lives on the integration row (consulted at
    // execute time + by future schema-aware validation passes).
    const integ = store.getIntegration('user:customers')!;
    const cols = (integ.config.schema as { columns: Array<{ name: string; type: string }> }).columns;
    expect(cols.find((c) => c.name === 'id')?.type).toBe('number');
    expect(cols.find((c) => c.name === 'active')?.type).toBe('boolean');
  });

  it('skips non-csv integrations', () => {
    store.upsertIntegration({
      id: 'user:not-csv', packId: null, kind: 'slack', name: 'X',
      config: { webhook_secret: 'X' }, secretRefs: ['X'],
    });
    expect(listGeneratedTools(store).size).toBe(0);
  });

  it('skips csv integrations whose snapshot is missing', () => {
    store.upsertIntegration({
      id: 'user:bare', packId: null, kind: 'csv', name: 'Bare CSV',
      config: { path: csvPath /* no schema */ }, secretRefs: [],
    });
    expect(listGeneratedTools(store).size).toBe(0);
  });
});

describe('sqlite generated tools', () => {
  function seedSqlite(): string {
    const dbPath = join(dir, 'churn.db');
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
    `);
    seed.close();
    const snapshot = inferSqliteSnapshot({ integrationId: 'probe', path: dbPath, readonly: true });
    store.upsertIntegration({
      id: 'user:churn', packId: null, kind: 'sqlite', name: 'Churn DB',
      config: { path: dbPath, schema: snapshot }, secretRefs: [],
    });
    return dbPath;
  }

  it('synthesises find + find-one + count per table', () => {
    seedSqlite();
    const tools = listGeneratedTools(store);
    expect(Array.from(tools.keys()).sort()).toEqual([
      'sqlite.churn.customers.count',
      'sqlite.churn.customers.find',
      'sqlite.churn.customers.find-one',
    ]);
    const findDef = tools.get('sqlite.churn.customers.find')!.definition;
    expect(findDef.source).toBe('builtin');
    // PR 4.E mirrors PR 4.B: per-row column schema lives on
    // rows.items.properties so save-time template validation can walk
    // `{{upstream.fetch.rows.0.<col>}}` paths.
    const rowItem = findDef.outputs.rows.items;
    expect(rowItem?.type).toBe('object');
    expect(rowItem?.properties?.email?.type).toBe('string');
    expect(rowItem?.properties?.id?.type).toBe('number');
  });

  it('getGeneratedTool resolves a single sqlite tool by id', () => {
    seedSqlite();
    const entry = getGeneratedTool(store, sqliteCountToolId({ id: 'user:churn' }, 'customers'));
    expect(entry).toBeDefined();
    expect(entry?.definition.id).toBe('sqlite.churn.customers.count');
  });

  it('execute() reads through to the actual SQLite file', async () => {
    seedSqlite();
    const find = getGeneratedTool(store, sqliteFindToolId({ id: 'user:churn' }, 'customers'))!;
    const result = await find.execute({ where: { status: 'churned' }, order_by: 'id ASC' }, {});
    expect((result.rows as Array<{ email: string }>).map((r) => r.email)).toEqual(['b@x.com', 'c@x.com']);
    expect(result.row_count).toBe(2);
  });

  it('find-one returns null on miss, row on hit', async () => {
    seedSqlite();
    const findOne = getGeneratedTool(store, sqliteFindOneToolId({ id: 'user:churn' }, 'customers'))!;
    expect((await findOne.execute({ where: { status: 'unknown' } }, {})).row).toBeNull();
    const hit = await findOne.execute({ where: { status: 'churned' }, order_by: 'id ASC' }, {});
    expect((hit.row as { email: string }).email).toBe('b@x.com');
  });

  it('skips sqlite integrations whose snapshot is missing', () => {
    store.upsertIntegration({
      id: 'user:bare-sqlite', packId: null, kind: 'sqlite', name: 'Bare',
      config: { path: '/nowhere.db' /* no schema */ }, secretRefs: [],
    });
    expect(listGeneratedTools(store).size).toBe(0);
  });
});

describe('getGeneratedTool', () => {
  it('resolves by tool id (O(1) hot path)', () => {
    seedCustomers();
    const read = getGeneratedTool(store, 'csv.customers.read');
    expect(read).toBeDefined();
    expect(read!.definition.id).toBe('csv.customers.read');
  });

  it('returns undefined for unknown tool ids', () => {
    seedCustomers();
    expect(getGeneratedTool(store, 'csv.nope.read')).toBeUndefined();
    expect(getGeneratedTool(store, 'csv.customers.unknown')).toBeUndefined();
    expect(getGeneratedTool(store, 'not-csv.customers.read')).toBeUndefined();
  });
});

describe('execute', () => {
  it('read returns typed rows respecting where + limit', async () => {
    seedCustomers();
    const tool = getGeneratedTool(store, 'csv.customers.read')!;
    const out = await tool.execute({ where: { active: true }, limit: 1 }, {});
    expect(out.rows).toEqual([{ id: 1, active: true, email: 'a@x.com' }]);
    expect(out.row_count).toBe(1);
    // result mirrors the structured fields so notify / chains can read it as JSON.
    expect(JSON.parse(out.result as string)).toEqual({ rows: out.rows, row_count: 1 });
  });

  it('count returns the filtered row count', async () => {
    seedCustomers();
    const tool = getGeneratedTool(store, 'csv.customers.count')!;
    const all = await tool.execute({}, {});
    expect(all.count).toBe(3);
    const active = await tool.execute({ where: { active: true } }, {});
    expect(active.count).toBe(2);
  });
});

describe('tool id helpers', () => {
  it('strips the namespace prefix', () => {
    expect(csvReadToolId({ id: 'user:customers' })).toBe('csv.customers.read');
    expect(csvCountToolId({ id: 'pack-foo:orders' })).toBe('csv.orders.count');
  });
});

describe('postgres tool synthesis', () => {
  function seedPostgres() {
    store.upsertIntegration({
      id: 'user:main-db',
      packId: null,
      kind: 'postgres',
      name: 'Main DB',
      config: {
        url_secret: 'DATABASE_URL',
        schemas: ['public'],
        schema: {
          tables: {
            'public.users': {
              schema: 'public',
              name: 'users',
              primaryKey: 'id',
              columns: [
                { name: 'id', pgType: 'integer', type: 'number', nullable: false },
                { name: 'email', pgType: 'text', type: 'string', nullable: true },
                { name: 'created_at', pgType: 'timestamp with time zone', type: 'string', format: 'timestamp', nullable: false },
              ],
            },
            'public.orders': {
              schema: 'public',
              name: 'orders',
              primaryKey: 'id',
              columns: [
                { name: 'id', pgType: 'bigint', type: 'number', nullable: false },
                { name: 'user_id', pgType: 'integer', type: 'number', nullable: false },
                { name: 'total', pgType: 'numeric', type: 'number', nullable: false },
              ],
            },
          },
          introspectedAt: '2026-05-13T00:00:00Z',
        },
      },
      secretRefs: ['DATABASE_URL'],
    });
  }

  it('synthesises find / find-one / count per table', () => {
    seedPostgres();
    const tools = listGeneratedTools(store);
    const ids = Array.from(tools.keys()).filter((k) => k.startsWith('postgres.')).sort();
    expect(ids).toEqual([
      'postgres.main-db.orders.count',
      'postgres.main-db.orders.find',
      'postgres.main-db.orders.find-one',
      'postgres.main-db.users.count',
      'postgres.main-db.users.find',
      'postgres.main-db.users.find-one',
    ]);
  });

  it('resolves a single postgres tool by id', () => {
    seedPostgres();
    const find = getGeneratedTool(store, 'postgres.main-db.users.find');
    expect(find).toBeDefined();
    expect(find!.definition.source).toBe('builtin');
    expect(find!.definition.outputs.rows.type).toBe('array');
    expect(find!.definition.inputs.where.type).toBe('object');
    expect(find!.definition.inputs.order_by.type).toBe('string');
  });

  it('returns undefined for unknown postgres tool ids', () => {
    seedPostgres();
    expect(getGeneratedTool(store, 'postgres.main-db.nope.find')).toBeUndefined();
    expect(getGeneratedTool(store, 'postgres.unknown.users.find')).toBeUndefined();
    expect(getGeneratedTool(store, 'postgres.main-db.users.unknown')).toBeUndefined();
  });

  it('execute throws a clear error when secretsStore is missing', async () => {
    seedPostgres();
    const find = getGeneratedTool(store, 'postgres.main-db.users.find')!;
    await expect(find.execute({}, {})).rejects.toThrow(/secretsStore/);
  });
});
