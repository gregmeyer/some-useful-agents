import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IntegrationsStore } from '../integrations-store.js';
import { ERROR_CATALOG } from '../error-catalog.js';
import {
  writeErrorReferenceDb,
  ensureErrorReferenceIntegration,
  ERROR_REFERENCE_INTEGRATION_ID,
} from './error-reference.js';
import { listGeneratedTools, getGeneratedTool } from './generated-tools.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-error-ref-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeErrorReferenceDb', () => {
  it('writes one row per catalog entry with the expected columns', () => {
    const dbFile = join(dir, 'error-reference.db');
    writeErrorReferenceDb(dbFile);
    expect(existsSync(dbFile)).toBe(true);

    const db = new DatabaseSync(dbFile, { readOnly: true });
    const { n } = db.prepare('SELECT count(*) AS n FROM errors').get() as { n: number };
    expect(n).toBe(ERROR_CATALOG.length);

    const row = db.prepare("SELECT * FROM errors WHERE kind='exit_code' AND code='127'").get() as Record<string, string>;
    expect(row.label).toContain('command not found');
    expect(row.troubleshooting).toContain('$PATH');
    db.close();
  });
});

describe('ensureErrorReferenceIntegration', () => {
  it('registers a sqlite integration that yields the errors.find tool', () => {
    const dbPath = join(dir, 'store.db');
    const store = new IntegrationsStore(dbPath);

    const generated = ensureErrorReferenceIntegration(store, dbPath);
    expect(existsSync(generated)).toBe(true);

    const integ = store.getIntegration(ERROR_REFERENCE_INTEGRATION_ID);
    expect(integ?.kind).toBe('sqlite');
    expect((integ?.config as { path?: string }).path).toBe(generated);

    // The read-only find tool must now be synthesised for the errors table.
    const toolIds = Array.from(listGeneratedTools(store).keys());
    expect(toolIds).toContain('sqlite.error-reference.errors.find');

    // ...and it must RESOLVE at runtime (getGeneratedTool reverse-looks-up the
    // integration by `user:<slug>` — a bare id would list but never resolve).
    const tool = getGeneratedTool(store, 'sqlite.error-reference.errors.find');
    expect(tool, 'find tool must resolve for the agent to use it').toBeDefined();

    store.close();
  });

  it('the find tool returns the catalog row for a queried code', async () => {
    const dbPath = join(dir, 'store.db');
    const store = new IntegrationsStore(dbPath);
    ensureErrorReferenceIntegration(store, dbPath);
    const tool = getGeneratedTool(store, 'sqlite.error-reference.errors.find')!;
    const out = await tool.execute({ where: { code: '127' }, limit: 1 }, {});
    const rows = (out as { rows?: Array<Record<string, string>> }).rows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toContain('command not found');
    store.close();
  });

  it('is idempotent — a second call keeps a single integration', () => {
    const dbPath = join(dir, 'store.db');
    const store = new IntegrationsStore(dbPath);
    ensureErrorReferenceIntegration(store, dbPath);
    ensureErrorReferenceIntegration(store, dbPath);
    const sqliteIntegs = store.listByKind('sqlite');
    expect(sqliteIntegs.filter((i) => i.id === ERROR_REFERENCE_INTEGRATION_ID)).toHaveLength(1);
    store.close();
  });
});
