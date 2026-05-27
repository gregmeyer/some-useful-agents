import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chmod600Safe } from './fs-utils.js';

/**
 * Inbox store — a unified "needs your attention" queue for the
 * dashboard.
 *
 * Producers (PR 3+) drop rows here from disconnected signals:
 *   - failed runs (high)        — hooked from run-store.updateRun
 *   - permission requests (med) — currently CSP-blocked image hosts
 *   - cadence reminders  (low)  — emitted by a scheduled system agent
 *
 * Consumers: the dashboard `/inbox` views, future `sua inbox …` CLI,
 * and a future triage system agent that classifies messages + emits a
 * structured <plan>{ messageId, recommendation, verifyHint }</plan>
 * parsed by the route.
 *
 * The MVP only writes/displays `open` and `dismissed`; the full
 * lifecycle enum (`triaged`, `awaiting_user`, `verifying`, `resolved`)
 * is defined now so PR 3+ doesn't require a migration.
 */

export const INBOX_PRIORITIES = ['high', 'medium', 'low'] as const;
export type InboxPriority = typeof INBOX_PRIORITIES[number];

export const INBOX_STATUSES = [
  'open',
  'triaged',
  'awaiting_user',
  'verifying',
  'resolved',
  'dismissed',
] as const;
export type InboxStatus = typeof INBOX_STATUSES[number];

export const INBOX_SOURCES = ['run-failure', 'permission-request', 'cadence', 'manual'] as const;
export type InboxSource = typeof INBOX_SOURCES[number];

export const INBOX_RESPONSE_ROLES = ['user', 'triage', 'system'] as const;
export type InboxResponseRole = typeof INBOX_RESPONSE_ROLES[number];

export interface InboxMessage {
  id: string;
  createdAt: number;
  priority: InboxPriority;
  source: InboxSource;
  agentId?: string;
  runId?: string;
  title: string;
  body: string;
  contextJson?: string;
  status: InboxStatus;
  triageRunId?: string;
  recommendation?: string;
  resolvedAt?: number;
  dedupeKey?: string;
}

export interface InboxResponse {
  id: string;
  messageId: string;
  createdAt: number;
  role: InboxResponseRole;
  body: string;
  metaJson?: string;
}

export interface AddMessageInput {
  priority: InboxPriority;
  source: InboxSource;
  title: string;
  body: string;
  agentId?: string;
  runId?: string;
  contextJson?: string;
  /**
   * Idempotency key. If a row with this dedupeKey already exists, `add`
   * returns the existing row unchanged. Suggested formats:
   *   `run-failure:<runId>` — each failed run is its own incident
   *   `csp-block:<agentId>:<host>` — collapses repeated CSP blocks
   *   `cadence:<topic>:<yyyy-mm-dd>` — one reminder per topic per day
   */
  dedupeKey?: string;
}

export interface ListMessagesOpts {
  status?: InboxStatus;
  priority?: InboxPriority;
  limit?: number;
}

/**
 * Priority ranking for ORDER BY — `high` first. SQLite sorts strings
 * alphabetically by default which would put `low` before `medium`
 * before `high`; we inject a CASE expression to fix the ordering
 * without storing a numeric column.
 */
const PRIORITY_RANK_CASE = `
  CASE priority
    WHEN 'high' THEN 0
    WHEN 'medium' THEN 1
    WHEN 'low' THEN 2
    ELSE 3
  END
`;

/**
 * SQLite-backed Inbox. One row per message in `inbox_messages`; an
 * optional conversation thread per message in `inbox_responses`. The
 * full schema lands in the MVP even though `triage_run_id`,
 * `recommendation`, and `inbox_responses` are unused until PR 4 —
 * adding nullable columns later means migrations, and the schema is
 * small enough to define once.
 */
export class InboxStore {
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

  static fromHandle(db: DatabaseSync): InboxStore {
    const store = Object.create(InboxStore.prototype) as InboxStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    (store as unknown as { dataRoot: string }).dataRoot = '';
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        priority TEXT NOT NULL,
        source TEXT NOT NULL,
        agent_id TEXT,
        run_id TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        context_json TEXT,
        status TEXT NOT NULL,
        triage_run_id TEXT,
        recommendation TEXT,
        resolved_at INTEGER,
        dedupe_key TEXT UNIQUE
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_inbox_open
        ON inbox_messages(status, priority, created_at DESC)
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_responses (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        role TEXT NOT NULL,
        body TEXT NOT NULL,
        meta_json TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_inbox_responses_msg
        ON inbox_responses(message_id, created_at)
    `);
  }

  /**
   * Insert a new message. When `dedupeKey` is set and a row already
   * exists with the same key, returns the existing row unchanged
   * (idempotent — producers can fire-and-forget without state).
   * Returns the resulting row in either case.
   */
  add(input: AddMessageInput): InboxMessage {
    this.validatePriority(input.priority);
    this.validateSource(input.source);
    if (!input.title) throw new Error('InboxStore.add: title is required');
    if (!input.body) throw new Error('InboxStore.add: body is required');

    if (input.dedupeKey) {
      const existing = this.findByDedupeKey(input.dedupeKey);
      if (existing) return existing;
    }

    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO inbox_messages (
        id, created_at, priority, source, agent_id, run_id,
        title, body, context_json, status, dedupe_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(
      id,
      now,
      input.priority,
      input.source,
      input.agentId ?? null,
      input.runId ?? null,
      input.title,
      input.body,
      input.contextJson ?? null,
      input.dedupeKey ?? null,
    );
    return this.get(id)!;
  }

  /**
   * List messages newest-first within each priority. Default filter
   * excludes `dismissed` + `resolved` (the queue is for active items
   * only); pass `status` to override.
   */
  list(opts: ListMessagesOpts = {}): InboxMessage[] {
    const where: string[] = [];
    const params: (string | number | null)[] = [];
    if (opts.status !== undefined) {
      this.validateStatus(opts.status);
      where.push('status = ?');
      params.push(opts.status);
    } else {
      where.push("status NOT IN ('dismissed', 'resolved')");
    }
    if (opts.priority !== undefined) {
      this.validatePriority(opts.priority);
      where.push('priority = ?');
      params.push(opts.priority);
    }
    const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 200;
    const rows = this.db.prepare(`
      SELECT * FROM inbox_messages
      WHERE ${where.join(' AND ')}
      ORDER BY ${PRIORITY_RANK_CASE}, created_at DESC
      LIMIT ?
    `).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToMessage(r));
  }

  get(id: string): InboxMessage | null {
    const row = this.db.prepare(`SELECT * FROM inbox_messages WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  findByDedupeKey(dedupeKey: string): InboxMessage | null {
    const row = this.db.prepare(`SELECT * FROM inbox_messages WHERE dedupe_key = ?`)
      .get(dedupeKey) as Record<string, unknown> | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  /**
   * Transition a message to a new status. `triageRunId` and
   * `recommendation` are set when present (used by PR 4's triage
   * route). Transitioning to `resolved` or `dismissed` also writes
   * `resolved_at`.
   */
  updateStatus(
    id: string,
    status: InboxStatus,
    opts: { triageRunId?: string; recommendation?: string } = {},
  ): void {
    this.validateStatus(status);
    const fields: string[] = ['status = ?'];
    const params: (string | number | null)[] = [status];
    if (opts.triageRunId !== undefined) {
      fields.push('triage_run_id = ?');
      params.push(opts.triageRunId);
    }
    if (opts.recommendation !== undefined) {
      fields.push('recommendation = ?');
      params.push(opts.recommendation);
    }
    if (status === 'resolved' || status === 'dismissed') {
      fields.push('resolved_at = ?');
      params.push(Date.now());
    }
    params.push(id);
    const result = this.db.prepare(
      `UPDATE inbox_messages SET ${fields.join(', ')} WHERE id = ?`,
    ).run(...params);
    if (result.changes === 0) throw new Error(`InboxStore.updateStatus: no message with id "${id}"`);
  }

  /** Convenience for the common `updateStatus(id, 'dismissed')` path. */
  dismiss(id: string): void {
    this.updateStatus(id, 'dismissed');
  }

  /**
   * Append a conversation entry to a message. Roles:
   *   `user`   — operator reply via the dashboard or CLI
   *   `triage` — triage agent recommendation / follow-up
   *   `system` — automated state-transition note (e.g. "host added to allowlist")
   */
  addResponse(
    messageId: string,
    role: InboxResponseRole,
    body: string,
    metaJson?: string,
  ): InboxResponse {
    this.validateResponseRole(role);
    if (!body) throw new Error('InboxStore.addResponse: body is required');
    // Ensure the parent message exists — fail loudly rather than orphan a row.
    if (!this.get(messageId)) {
      throw new Error(`InboxStore.addResponse: no message with id "${messageId}"`);
    }
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO inbox_responses (id, message_id, created_at, role, body, meta_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, messageId, now, role, body, metaJson ?? null);
    return { id, messageId, createdAt: now, role, body, metaJson };
  }

  listResponses(messageId: string): InboxResponse[] {
    const rows = this.db.prepare(`
      SELECT id, message_id, created_at, role, body, meta_json
        FROM inbox_responses
        WHERE message_id = ?
        ORDER BY created_at ASC
    `).all(messageId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToResponse(r));
  }

  /** Drop every row from both tables. Test + dev tooling. */
  clear(): void {
    this.db.exec(`DELETE FROM inbox_responses`);
    this.db.exec(`DELETE FROM inbox_messages`);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  // ── validation ─────────────────────────────────────────────────────

  private validatePriority(p: string): void {
    if (!(INBOX_PRIORITIES as readonly string[]).includes(p)) {
      throw new Error(`InboxStore: invalid priority "${p}" — must be one of ${INBOX_PRIORITIES.join(', ')}`);
    }
  }
  private validateStatus(s: string): void {
    if (!(INBOX_STATUSES as readonly string[]).includes(s)) {
      throw new Error(`InboxStore: invalid status "${s}" — must be one of ${INBOX_STATUSES.join(', ')}`);
    }
  }
  private validateSource(s: string): void {
    if (!(INBOX_SOURCES as readonly string[]).includes(s)) {
      throw new Error(`InboxStore: invalid source "${s}" — must be one of ${INBOX_SOURCES.join(', ')}`);
    }
  }
  private validateResponseRole(r: string): void {
    if (!(INBOX_RESPONSE_ROLES as readonly string[]).includes(r)) {
      throw new Error(`InboxStore: invalid response role "${r}" — must be one of ${INBOX_RESPONSE_ROLES.join(', ')}`);
    }
  }

  // ── row marshalling ────────────────────────────────────────────────

  private rowToMessage(row: Record<string, unknown>): InboxMessage {
    return {
      id: row.id as string,
      createdAt: row.created_at as number,
      priority: row.priority as InboxPriority,
      source: row.source as InboxSource,
      agentId: (row.agent_id as string | null) ?? undefined,
      runId: (row.run_id as string | null) ?? undefined,
      title: row.title as string,
      body: row.body as string,
      contextJson: (row.context_json as string | null) ?? undefined,
      status: row.status as InboxStatus,
      triageRunId: (row.triage_run_id as string | null) ?? undefined,
      recommendation: (row.recommendation as string | null) ?? undefined,
      resolvedAt: (row.resolved_at as number | null) ?? undefined,
      dedupeKey: (row.dedupe_key as string | null) ?? undefined,
    };
  }

  private rowToResponse(row: Record<string, unknown>): InboxResponse {
    return {
      id: row.id as string,
      messageId: row.message_id as string,
      createdAt: row.created_at as number,
      role: row.role as InboxResponseRole,
      body: row.body as string,
      metaJson: (row.meta_json as string | null) ?? undefined,
    };
  }
}
