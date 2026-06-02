import { DatabaseSync } from 'node:sqlite';

/**
 * Default busy timeout, in milliseconds, applied to every store connection.
 *
 * Without it, `node:sqlite` raises `SQLITE_BUSY` ("database is locked") the
 * instant it can't grab a lock — even though the holder usually releases within
 * milliseconds. That bit us when the daemon restarts schedule + worker +
 * dashboard at once and they race to open the same DB file (the WAL switch and
 * the orphan-reap write both need a brief exclusive lock). A busy timeout makes
 * SQLite block-and-retry for up to this long before giving up, which absorbs the
 * startup contention without any caller-side retry loop.
 */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface OpenStoreDbOptions {
  /** Open the database read-only. */
  readOnly?: boolean;
  /** Override the busy timeout (ms). 0 disables it (immediate SQLITE_BUSY). */
  busyTimeoutMs?: number;
}

/**
 * Open a SQLite store connection with the project-wide contention guard applied.
 *
 * Every store should open through this rather than calling `new DatabaseSync`
 * directly, so the `busy_timeout` is set uniformly and can't drift. The timeout
 * is applied immediately after open and BEFORE callers run `PRAGMA journal_mode
 * = WAL` — the WAL switch itself needs the write lock, so it must already be
 * covered by the busy timeout.
 */
export function openStoreDb(dbPath: string, opts: OpenStoreDbOptions = {}): DatabaseSync {
  // node:sqlite rejects an explicit `undefined` second arg ("options must be an
  // object"), so only pass the options object when we actually have one.
  const db = opts.readOnly
    ? new DatabaseSync(dbPath, { readOnly: true })
    : new DatabaseSync(dbPath);
  const timeout = opts.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (timeout > 0) {
    // PRAGMA busy_timeout is per-connection state and must be set on each handle.
    db.exec(`PRAGMA busy_timeout = ${timeout}`);
  }
  return db;
}
