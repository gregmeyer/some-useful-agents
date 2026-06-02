import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStoreDb, DEFAULT_BUSY_TIMEOUT_MS } from './sqlite-open.js';

const dirs: string[] = [];
function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sua-sqlite-open-'));
  dirs.push(dir);
  return join(dir, 'test.db');
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('openStoreDb', () => {
  it('applies the default busy_timeout to the connection', () => {
    const db = openStoreDb(tmpDb());
    try {
      const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
      expect(row.timeout).toBe(DEFAULT_BUSY_TIMEOUT_MS);
    } finally {
      db.close();
    }
  });

  it('honors a custom busy_timeout', () => {
    const db = openStoreDb(tmpDb(), { busyTimeoutMs: 1234 });
    try {
      const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
      expect(row.timeout).toBe(1234);
    } finally {
      db.close();
    }
  });

  it('leaves the timeout at the SQLite default when set to 0 (opt out)', () => {
    const db = openStoreDb(tmpDb(), { busyTimeoutMs: 0 });
    try {
      const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
      // SQLite's own default is 0 (no wait) — we didn't touch it.
      expect(row.timeout).toBe(0);
    } finally {
      db.close();
    }
  });

  it('returns a usable connection (can create + query a table)', () => {
    const db = openStoreDb(tmpDb());
    try {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      db.prepare('INSERT INTO t (v) VALUES (?)').run('hi');
      const row = db.prepare('SELECT v FROM t WHERE id = 1').get() as { v: string };
      expect(row.v).toBe('hi');
    } finally {
      db.close();
    }
  });
});
