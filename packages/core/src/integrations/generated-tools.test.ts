import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegrationsStore } from '../integrations-store.js';
import { inferCsvSnapshot } from './csv-driver.js';
import {
  listGeneratedTools,
  getGeneratedTool,
  csvReadToolId,
  csvCountToolId,
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
