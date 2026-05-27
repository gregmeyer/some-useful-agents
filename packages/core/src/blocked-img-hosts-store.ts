import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { chmod600Safe } from './fs-utils.js';

/**
 * One row per (agent, blocked-host) pair. `count` accumulates across
 * repeated blocks; `lastSeenAt` is updated on each report. Surfaces in
 * the agent config page as "Recently blocked" pills with one-click
 * add-to-permissions buttons.
 */
export interface BlockedImgHost {
  agentId: string;
  host: string;
  lastSeenAt: number;
  count: number;
}

// Require at least one alpha character in the final label to reject IP
// literals (127.0.0.1) and similar all-numeric strings. CSP img-src can
// technically accept IPs, but the UI flow is for users adding DNS host
// names — and accepting raw IPs widens the attack surface for typos.
const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]([a-z0-9-]{0,61}[a-z0-9])?(:\d{1,5})?$/i;
const HOST_MAX_LEN = 253;

/**
 * Validates a CSP-violation blocked-URI hostname before we accept it
 * into the store. Rejects schemes, paths, IP literals, and anything
 * non-DNS-looking. Hostname-only (optionally with port), as that's what
 * the CSP `img-src` directive expects.
 */
export function isValidImgHost(host: string): boolean {
  if (!host || host.length > HOST_MAX_LEN) return false;
  return HOST_RE.test(host);
}

/**
 * SQLite-backed store for blocked image hosts. Sized small (one row per
 * agent × host) and durable across daemon restarts so users don't lose
 * their "recently blocked" suggestions on each restart.
 *
 * `agent_id` is not a SQL foreign key — coupling boot order with
 * AgentStore is more brittle than the cleanup cost (orphans are
 * harmless; agent config pages just don't query for them).
 */
export class BlockedImgHostsStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;
  public readonly dataRoot: string;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.ownsConnection = true;
    chmod600Safe(dbPath);
    this.dataRoot = dir;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): BlockedImgHostsStore {
    const store = Object.create(BlockedImgHostsStore.prototype) as BlockedImgHostsStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    (store as unknown as { dataRoot: string }).dataRoot = '';
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_img_hosts (
        agent_id TEXT NOT NULL,
        host TEXT NOT NULL,
        last_seen_at INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (agent_id, host)
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_blocked_img_hosts_agent_seen
        ON blocked_img_hosts(agent_id, last_seen_at DESC)
    `);
  }

  /**
   * Record one blocked-image event. Upserts: bumps `count`, updates
   * `last_seen_at`. Returns the resulting row, or null if validation
   * rejected the input (so callers don't have to re-validate).
   */
  record(agentId: string, host: string): BlockedImgHost | null {
    if (!agentId || !isValidImgHost(host)) return null;
    const normalized = host.toLowerCase();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO blocked_img_hosts (agent_id, host, last_seen_at, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(agent_id, host) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        count = count + 1
    `).run(agentId, normalized, now);
    return this.getOne(agentId, normalized);
  }

  /** Recent blocks for one agent, newest first. */
  listForAgent(agentId: string, limit = 20): BlockedImgHost[] {
    if (!agentId) return [];
    const rows = this.db.prepare(`
      SELECT agent_id, host, last_seen_at, count
        FROM blocked_img_hosts
        WHERE agent_id = ?
        ORDER BY last_seen_at DESC
        LIMIT ?
    `).all(agentId, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToHost(r));
  }

  /** Single row lookup; mostly for tests + the record() return value. */
  getOne(agentId: string, host: string): BlockedImgHost | null {
    const row = this.db.prepare(`
      SELECT agent_id, host, last_seen_at, count
        FROM blocked_img_hosts
        WHERE agent_id = ? AND host = ?
    `).get(agentId, host) as Record<string, unknown> | undefined;
    return row ? this.rowToHost(row) : null;
  }

  /** Drop one specific (agent, host) entry — typically after the user adds it to permissions. */
  deleteFor(agentId: string, host: string): void {
    this.db.prepare(`DELETE FROM blocked_img_hosts WHERE agent_id = ? AND host = ?`)
      .run(agentId, host);
  }

  /** Drop every blocked entry for one agent — used when the user dismisses the whole list. */
  clearForAgent(agentId: string): void {
    this.db.prepare(`DELETE FROM blocked_img_hosts WHERE agent_id = ?`).run(agentId);
  }

  /** Drop everything. Test / dev tooling. */
  clear(): void {
    this.db.exec(`DELETE FROM blocked_img_hosts`);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private rowToHost(row: Record<string, unknown>): BlockedImgHost {
    return {
      agentId: row.agent_id as string,
      host: row.host as string,
      lastSeenAt: row.last_seen_at as number,
      count: row.count as number,
    };
  }
}
