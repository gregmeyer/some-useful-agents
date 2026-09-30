import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { addColumnIfMissing } from './sqlite-open.js';
import { RunStore } from './run-store.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sua-migrate-race-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('addColumnIfMissing', () => {
  it('treats a column another process just added as done, and still throws other errors', () => {
    const a = new DatabaseSync(join(dir, 'x.db'));
    const b = new DatabaseSync(join(dir, 'x.db'));
    a.exec('CREATE TABLE t (id TEXT)');
    // Both "checked" before either altered: the second ALTER used to crash.
    addColumnIfMissing(a, 'ALTER TABLE t ADD COLUMN extra TEXT');
    expect(() => addColumnIfMissing(b, 'ALTER TABLE t ADD COLUMN extra TEXT')).not.toThrow();
    expect(() => addColumnIfMissing(b, 'ALTER TABLE nope ADD COLUMN extra TEXT')).toThrow(/no such table/);
    a.close();
    b.close();
  });

  it('lets two stores migrate the same old database at once', () => {
    const path = join(dir, 'runs.db');
    const old = new DatabaseSync(path);
    // A runs table from before most columns existed.
    old.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, agentName TEXT NOT NULL, status TEXT NOT NULL, startedAt TEXT NOT NULL,
      completedAt TEXT, result TEXT, exitCode INTEGER, error TEXT, triggeredBy TEXT NOT NULL)`);
    old.close();
    const first = new RunStore(path);
    const second = new RunStore(path);
    first.close();
    second.close();
  });
});
