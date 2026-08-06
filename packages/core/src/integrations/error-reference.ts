/**
 * Provision the read-only `error-reference` SQLite integration that backs the
 * `error-troubleshooter` example agent.
 *
 * The catalog (`ERROR_CATALOG`) is the single source of truth. Rather than
 * commit a binary `.db` that can drift from it, we generate the file fresh
 * from the catalog at provision time (boot / install) into the sua data dir,
 * then register a `sqlite` integration pointing at it. That materialises the
 * `sqlite.error-reference.errors.find` tool the agent calls — so the agent
 * works out of the box with no manual Settings → Integrations step.
 *
 * Idempotent: safe to call on every boot. The file is tiny (~two dozen rows)
 * so regenerating it keeps the catalog current across upgrades for free.
 */

import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ERROR_CATALOG } from '../error-catalog.js';
import { inferSqliteSnapshot } from './sqlite-driver.js';
import type { IntegrationsStore } from '../integrations-store.js';

/**
 * Integration row id. The `user:` prefix is required: the generated-tool
 * resolver (`resolveSqliteTool`) reverse-looks-up the integration by
 * `user:<slug>`, so a bare id would be listed but never resolve at runtime.
 * The slug (prefix stripped) is `error-reference`, giving the tool id
 * `sqlite.error-reference.errors.find`.
 */
export const ERROR_REFERENCE_INTEGRATION_ID = 'user:error-reference';
/** The single table in the generated DB. */
export const ERROR_REFERENCE_TABLE = 'errors';

/**
 * (Re)write the error-reference SQLite file from ERROR_CATALOG. Column names
 * are lowercase snake_case so the sqlite integration generates tools for them.
 */
export function writeErrorReferenceDb(dbFile: string): void {
  rmSync(dbFile, { force: true });
  const db = new DatabaseSync(dbFile);
  try {
    db.exec(`
      CREATE TABLE ${ERROR_REFERENCE_TABLE} (
        kind            TEXT NOT NULL,
        code            TEXT NOT NULL,
        label           TEXT NOT NULL,
        meaning         TEXT NOT NULL,
        common_causes   TEXT NOT NULL,
        troubleshooting TEXT NOT NULL,
        PRIMARY KEY (kind, code)
      );
    `);
    const insert = db.prepare(
      `INSERT INTO ${ERROR_REFERENCE_TABLE} (kind, code, label, meaning, common_causes, troubleshooting)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const e of ERROR_CATALOG) {
      insert.run(e.kind, e.key, e.label, e.meaning, e.commonCauses.join('\n'), e.troubleshooting.join('\n'));
    }
  } finally {
    db.close();
  }
}

/**
 * Ensure the `error-reference` integration exists and points at a freshly
 * generated catalog DB. Returns the DB path. Non-throwing callers should wrap
 * in try/catch — a failure here must never block boot/install.
 *
 * The DB lives next to the runtime store (`dirname(dbPath)`), a stable,
 * writable, per-install location that does not depend on the repo layout or
 * the process working directory.
 */
export function ensureErrorReferenceIntegration(store: IntegrationsStore, dbPath: string): string {
  const dbFile = join(dirname(dbPath), 'error-reference.db');
  writeErrorReferenceDb(dbFile);
  const schema = inferSqliteSnapshot({ integrationId: ERROR_REFERENCE_INTEGRATION_ID, path: dbFile });
  store.upsertIntegration({
    id: ERROR_REFERENCE_INTEGRATION_ID,
    packId: null,
    kind: 'sqlite',
    name: 'Error reference',
    config: { path: dbFile, schema },
    secretRefs: [],
  });
  return dbFile;
}
