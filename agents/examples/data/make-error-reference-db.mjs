#!/usr/bin/env node
// Regenerate the seed SQLite file behind the `error-troubleshooter` example.
//
// Single source of truth is ERROR_CATALOG in @some-useful-agents/core — this
// script serialises it into `error-reference.db` so the same catalog powers
// both the inbox auto-attach (in-process) and the agent's read-only sqlite
// tool. Run `npm run build` first (imports the compiled catalog), then:
//   node agents/examples/data/make-error-reference-db.mjs
//
// Idempotent: deletes the file first, then re-seeds. Column names are
// lowercase snake_case so the sqlite integration generates tools for them.
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ERROR_CATALOG } from '@some-useful-agents/core';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, 'error-reference.db');

rmSync(dbPath, { force: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE errors (
    kind            TEXT NOT NULL,   -- 'category' | 'exit_code'
    code            TEXT NOT NULL,   -- 'exit_nonzero' | '127' ...
    label           TEXT NOT NULL,   -- terse one-line label
    meaning         TEXT NOT NULL,   -- what actually happened
    common_causes   TEXT NOT NULL,   -- newline-separated
    troubleshooting TEXT NOT NULL,   -- newline-separated, ordered steps
    PRIMARY KEY (kind, code)
  );
`);

const insert = db.prepare(
  `INSERT INTO errors (kind, code, label, meaning, common_causes, troubleshooting)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
for (const e of ERROR_CATALOG) {
  insert.run(e.kind, e.key, e.label, e.meaning, e.commonCauses.join('\n'), e.troubleshooting.join('\n'));
}

const { n } = db.prepare('SELECT count(*) AS n FROM errors').get();
db.close();
console.log(`wrote ${dbPath} with ${n} rows`);
