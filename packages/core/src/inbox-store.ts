import { DatabaseSync } from 'node:sqlite';
import { openStoreDb } from './sqlite-open.js';
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

export const INBOX_RESPONSE_ROLES = ['user', 'triage', 'system', 'action'] as const;
export type InboxResponseRole = typeof INBOX_RESPONSE_ROLES[number];

/**
 * Lifecycle for an `action`-role response (triage proposing a sub-agent
 * run). State transitions: `proposed` → `running` → `completed | failed`,
 * or `proposed` → `skipped`. `refused` is terminal when allowlist /
 * depth checks reject the proposal at insert time.
 */
export const INBOX_ACTION_STATUSES = [
  'proposed',
  'running',
  'completed',
  'failed',
  'skipped',
  'refused',
] as const;
export type InboxActionStatus = typeof INBOX_ACTION_STATUSES[number];

/**
 * Structured payload stored in `inbox_responses.meta_json` for
 * `action`-role rows. The view + route read this to drive Run/Skip
 * buttons and status rendering; the body field is just a
 * human-readable rationale.
 */
export interface InboxActionMeta {
  kind: 'action';
  status: InboxActionStatus;
  agentId: string;
  inputs: Record<string, string>;
  rationale?: string;
  /**
   * Optional verb-led label for the action's Run button (e.g. "Describe this
   * agent" instead of the generic "Run"). Triage may set it so the dispatch
   * CTA reads naturally; falls back to "Run" when absent.
   */
  ctaLabel?: string;
  /**
   * When true, approving this run first grants `permissions.inboxRunnable`
   * to `agentId` (a one-click "Enable & run"). Set by the dashboard when
   * triage proposes running an installed agent that hasn't been granted
   * inbox-run permission yet — the operator's approval is the grant.
   */
  grantsInboxRunnable?: boolean;
  /** Sub-agent run id once execution starts. */
  runId?: string;
  startedAt?: number;
  endedAt?: number;
  /** First ~500 chars of the sub-agent's terminal output. */
  resultSummary?: string;
  /** Set when status is `refused` or `failed`. */
  refusalReason?: string;
}

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
  /** User-flagged for quick filter on the inbox list. */
  starred: boolean;
  /**
   * Free-form lowercase tags, deduped + sorted. Stored as a JSON array.
   * Producers may seed tags (e.g. `network`, `auth`); operators add/remove
   * them from the modal header.
   */
  tags: string[];
  /**
   * Wall-clock ms-since-epoch of the most recent activity on the
   * thread — either the last conversation response or the message's
   * own `createdAt` if no replies exist. Derived at `list()` time via
   * a LEFT JOIN; `get()` and other single-row reads leave this
   * undefined since they don't run the join. Drives the queue's
   * "Age" column under the default priority + last-activity sort.
   */
  lastActivityAt?: number;
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
  /**
   * Free-text query matched (case-insensitively) against title, body,
   * agent_id, and the bodies of any conversation responses. Lets the
   * operator find a thread by quoting something the triage agent said,
   * or the agent that owns the failure.
   */
  q?: string;
  /** When true, only return starred messages. */
  starred?: boolean;
  /** When set, only return messages tagged with this exact lowercase tag. */
  tag?: string;
  /**
   * Sort key. Default `priority` (high first, then most-recent
   * activity within a priority). Other keys honor the dashboard's
   * URL-driven sort state — see InboxSortKey in routes/inbox.ts.
   */
  sort?: InboxSortKey;
  /** Sort direction. Default `desc` for most keys; UI flips on header click. */
  dir?: InboxSortDir;
}

export type InboxSortKey = 'priority' | 'status' | 'age' | 'title' | 'agent';
export type InboxSortDir = 'asc' | 'desc';

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

function tokenizeSearchQuery(q: string): string[] {
  return q
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Priority ranking for ORDER BY — `high` first. SQLite sorts strings
 * alphabetically by default which would put `low` before `medium`
 * before `high`; we inject a CASE expression to fix the ordering
 * without storing a numeric column.
 */
const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Lowercase, trim, drop invalid entries, de-duplicate, sort. Used by
 * `setTags` and exported for callers that need to validate UI input
 * before sending it to the store.
 */
export function normalizeTags(input: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const t = raw.toLowerCase().trim();
    if (TAG_RE.test(t)) out.add(t);
  }
  return Array.from(out).sort();
}

const PRIORITY_RANK_CASE = `
  CASE priority
    WHEN 'high' THEN 0
    WHEN 'medium' THEN 1
    WHEN 'low' THEN 2
    ELSE 3
  END
`;

/**
 * Status ranking for ORDER BY. `awaiting_user` (the "Your turn"
 * state) comes first so a `?sort=status` flip surfaces what needs
 * an operator click. `triaged` follows (triage finished, no
 * pending action), then `verifying` (in-flight check), then `open`
 * (fresh, untriaged). Terminal states sit last for symmetry with
 * `list()`'s default filter that hides them.
 */
const STATUS_RANK_CASE = `
  CASE status
    WHEN 'awaiting_user' THEN 0
    WHEN 'triaged' THEN 1
    WHEN 'verifying' THEN 2
    WHEN 'open' THEN 3
    WHEN 'resolved' THEN 4
    WHEN 'dismissed' THEN 5
    ELSE 6
  END
`;

/**
 * SQL fragment for the derived "last activity" timestamp. Returns
 * `MAX(inbox_responses.created_at)` for the row's message_id,
 * falling back to the message's own `created_at` when no responses
 * exist. Used both in the SELECT (so the column is on every row)
 * and the default ORDER BY (priority then activity desc).
 *
 * Implemented as a correlated scalar subquery rather than a LEFT
 * JOIN + GROUP BY because there's no aggregation on the outer
 * query and the subquery sidesteps duplicate rows from multi-
 * response messages.
 */
const LAST_ACTIVITY_AT_SQL = `
  COALESCE(
    (SELECT MAX(created_at) FROM inbox_responses
       WHERE inbox_responses.message_id = inbox_messages.id),
    inbox_messages.created_at
  )
`;

/**
 * Map a sort key + direction to the ORDER BY clause. `priority` is
 * the default and always tie-breaks by last-activity desc; other
 * sorts tie-break by activity desc too so the result is stable
 * even when the primary key is equal. Starred messages always
 * float to the top so the rail's contents lead the list.
 */
function buildOrderBy(sort: InboxSortKey | undefined, dir: InboxSortDir | undefined): string {
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'status':
      // Status asc = "Your turn first"; status desc = "calmest first".
      return `starred DESC, ${STATUS_RANK_CASE} ${dir === 'desc' ? 'DESC' : 'ASC'}, ${LAST_ACTIVITY_AT_SQL} DESC`;
    case 'age':
      // Age desc = newest activity first; age asc = oldest first.
      return `starred DESC, ${LAST_ACTIVITY_AT_SQL} ${d}`;
    case 'title':
      return `starred DESC, LOWER(title) ${d}, ${LAST_ACTIVITY_AT_SQL} DESC`;
    case 'agent':
      // NULLs LAST for agent_id so unagented rows don't crowd the top.
      return `starred DESC, agent_id IS NULL, LOWER(IFNULL(agent_id,'')) ${d}, ${LAST_ACTIVITY_AT_SQL} DESC`;
    case 'priority':
    default:
      // Priority asc = high first; desc = low first. Default behavior
      // (no explicit sort) matches priority asc + activity desc.
      return `starred DESC, ${PRIORITY_RANK_CASE} ${dir === 'desc' ? 'DESC' : 'ASC'}, ${LAST_ACTIVITY_AT_SQL} DESC`;
  }
}

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
    this.db = openStoreDb(dbPath);
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
        dedupe_key TEXT UNIQUE,
        starred INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT
      )
    `);
    // Idempotent additive migrations for installs created before star + tags.
    // ALTER TABLE ... ADD COLUMN is a no-op on a column that already exists
    // (we catch + ignore the duplicate-column error).
    for (const ddl of [
      `ALTER TABLE inbox_messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE inbox_messages ADD COLUMN tags_json TEXT`,
    ]) {
      try { this.db.exec(ddl); } catch { /* column exists — ignore */ }
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_inbox_open
        ON inbox_messages(status, priority, created_at DESC)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_inbox_starred
        ON inbox_messages(starred, created_at DESC) WHERE starred = 1
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
   *
   * Supports text search (`q` — matches title/body/agent and the
   * conversation thread), starred-only, and tag filtering.
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
    if (opts.starred === true) {
      where.push('starred = 1');
    }
    if (typeof opts.tag === 'string' && opts.tag.trim()) {
      // tags_json is a JSON array of lowercase strings; match the tag
      // surrounded by JSON delimiters so we don't false-match on
      // substrings (e.g. tag "auth" wouldn't match "authentication").
      where.push('tags_json LIKE ?');
      params.push(`%"${opts.tag.toLowerCase().trim()}"%`);
    }
    if (typeof opts.q === 'string' && opts.q.trim()) {
      // Token-based search across id/title/body/agent/tags and the full
      // conversation thread. Terms are ANDed so "joke judge" matches a
      // row like "joke-judge-two" without needing the exact substring.
      const terms = tokenizeSearchQuery(opts.q);
      if (terms.length > 0) {
        const termClauses = terms.map(() => `(
          LOWER(id) LIKE ? ESCAPE '\\'
          OR LOWER(title) LIKE ? ESCAPE '\\'
          OR LOWER(body) LIKE ? ESCAPE '\\'
          OR LOWER(IFNULL(agent_id, '')) LIKE ? ESCAPE '\\'
          OR LOWER(tags_json) LIKE ? ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM inbox_responses
              WHERE inbox_responses.message_id = inbox_messages.id
                AND LOWER(inbox_responses.body) LIKE ? ESCAPE '\\'
          )
        )`);
        where.push(`(${termClauses.join(' AND ')})`);
        for (const term of terms) {
          const pattern = `%${escapeLike(term)}%`;
          params.push(pattern, pattern, pattern, pattern, pattern, pattern);
        }
      }
    }
    const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 200;
    const orderBy = buildOrderBy(opts.sort, opts.dir);
    const rows = this.db.prepare(`
      SELECT
        inbox_messages.*,
        ${LAST_ACTIVITY_AT_SQL} AS last_activity_at
      FROM inbox_messages
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ?
    `).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToMessage(r));
  }

  /** Set or clear the star flag. */
  setStarred(id: string, starred: boolean): void {
    const result = this.db.prepare(`UPDATE inbox_messages SET starred = ? WHERE id = ?`)
      .run(starred ? 1 : 0, id);
    if (result.changes === 0) throw new Error(`InboxStore.setStarred: no message with id "${id}"`);
  }

  /**
   * Replace the message's tag list. Tags are lowercased, trimmed,
   * de-duplicated, and sorted before persisting. Pass an empty
   * array to clear all tags. Tag values may contain only
   * lowercase letters, digits, hyphens, and underscores (no spaces);
   * invalid entries are silently dropped so the UI can be lazy
   * about validation.
   */
  setTags(id: string, tags: string[]): void {
    const normalized = normalizeTags(tags);
    const json = normalized.length === 0 ? null : JSON.stringify(normalized);
    const result = this.db.prepare(`UPDATE inbox_messages SET tags_json = ? WHERE id = ?`)
      .run(json, id);
    if (result.changes === 0) throw new Error(`InboxStore.setTags: no message with id "${id}"`);
  }

  /** All tags currently in use across the inbox, sorted, deduped. */
  listAllTags(): string[] {
    const rows = this.db.prepare(
      `SELECT tags_json FROM inbox_messages WHERE tags_json IS NOT NULL`,
    ).all() as Array<{ tags_json: string }>;
    const tags = new Set<string>();
    for (const row of rows) {
      try {
        const arr = JSON.parse(row.tags_json) as unknown;
        if (Array.isArray(arr)) {
          for (const t of arr) if (typeof t === 'string') tags.add(t);
        }
      } catch { /* skip malformed */ }
    }
    return Array.from(tags).sort();
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
   * Rename a message. Used by the dashboard to replace the default
   * "New conversation" placeholder with a title derived from the
   * operator's first reply. Title is required (the column is NOT
   * NULL); caller is responsible for truncating to the operator-
   * friendly limit (~60 chars).
   */
  updateTitle(id: string, title: string): void {
    if (!title) throw new Error('InboxStore.updateTitle: title is required');
    const result = this.db.prepare(
      'UPDATE inbox_messages SET title = ? WHERE id = ?',
    ).run(title, id);
    if (result.changes === 0) throw new Error(`InboxStore.updateTitle: no message with id "${id}"`);
  }

  /**
   * Patch mutable thread metadata: the linked `agent_id` (used by inbox
   * "retarget" — point a thread at a different agent) and `context_json`
   * (used to record provenance like `forkedFrom`). Pass `null` to clear a
   * column; omit a field to leave it untouched. No-ops on an empty patch.
   */
  updateMessage(
    id: string,
    patch: { agentId?: string | null; contextJson?: string | null },
  ): void {
    const fields: string[] = [];
    const params: (string | null)[] = [];
    if (patch.agentId !== undefined) {
      fields.push('agent_id = ?');
      params.push(patch.agentId);
    }
    if (patch.contextJson !== undefined) {
      fields.push('context_json = ?');
      params.push(patch.contextJson);
    }
    if (fields.length === 0) return;
    params.push(id);
    const result = this.db.prepare(
      `UPDATE inbox_messages SET ${fields.join(', ')} WHERE id = ?`,
    ).run(...params);
    if (result.changes === 0) throw new Error(`InboxStore.updateMessage: no message with id "${id}"`);
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

  /**
   * Fetch a single response row by id. Used by the action-execution
   * routes (`/inbox/:id/actions/:rid/run|skip`) to load the proposed
   * action and verify it's still in `proposed` state before mutating.
   */
  getResponse(id: string): InboxResponse | null {
    const row = this.db.prepare(
      `SELECT id, message_id, created_at, role, body, meta_json
        FROM inbox_responses WHERE id = ?`,
    ).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToResponse(row) : null;
  }

  /**
   * Atomically transition an `action`-role response from one status
   * to another, IFF its current meta_json status matches `fromStatus`.
   * Returns true when the transition committed, false when it lost the
   * race (row missing OR status changed by another writer first).
   *
   * Race-safe via a single UPDATE with a status WHERE clause —
   * critical for `/inbox/:id/actions/:rid/run`, which previously
   * checked status in the route handler and updated it later in an
   * async fire-and-forget, leaving a window where a concurrent
   * double-click could dispatch the sub-agent twice.
   */
  transitionActionStatus(id: string, fromStatus: string, newMetaJson: string): boolean {
    const result = this.db.prepare(`
      UPDATE inbox_responses
      SET meta_json = ?
      WHERE id = ?
        AND role = 'action'
        AND json_extract(meta_json, '$.status') = ?
    `).run(newMetaJson, id, fromStatus);
    return result.changes === 1;
  }

  /**
   * Update an existing response's body and/or meta_json. Used to
   * transition `action` rows through their lifecycle (proposed →
   * running → completed). Pass `undefined` to leave a field
   * unchanged; pass `null` for `metaJson` to clear it.
   *
   * Not race-safe — for transitions that depend on the current
   * status (e.g. proposed → running), use `transitionActionStatus`.
   */
  updateResponse(
    id: string,
    patch: { body?: string; metaJson?: string | null },
  ): void {
    const fields: string[] = [];
    const params: (string | null)[] = [];
    if (patch.body !== undefined) {
      fields.push('body = ?');
      params.push(patch.body);
    }
    if (patch.metaJson !== undefined) {
      fields.push('meta_json = ?');
      params.push(patch.metaJson);
    }
    if (fields.length === 0) return;
    params.push(id);
    const result = this.db.prepare(
      `UPDATE inbox_responses SET ${fields.join(', ')} WHERE id = ?`,
    ).run(...params);
    if (result.changes === 0) {
      throw new Error(`InboxStore.updateResponse: no response with id "${id}"`);
    }
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
    let tags: string[] = [];
    if (typeof row.tags_json === 'string' && row.tags_json) {
      try {
        const parsed = JSON.parse(row.tags_json) as unknown;
        if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
      } catch { /* malformed — surface as empty */ }
    }
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
      starred: (row.starred as number) === 1,
      tags,
      // last_activity_at is only present when `list()` joins it in;
      // `get()` and other single-row reads leave it undefined.
      lastActivityAt: typeof row.last_activity_at === 'number' ? row.last_activity_at : undefined,
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
