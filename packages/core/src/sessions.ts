/**
 * Conversations with an agent: a session is a list of turns (your message,
 * the agent's reply); each turn is one ordinary run of the agent. See
 * docs/conversations.md and ADR-0039.
 *
 * Continuity is by transcript, not provider session state: the earlier turns
 * go into a budgeted "conversation so far" block that the executor prepends
 * to llm / goal prompts after template substitution (like behaviors and
 * memory). That works the same on every provider — claude, codex,
 * OpenAI-compatible, Apple FM — and on a Temporal worker, and it is visible.
 *
 * The message fills one input of the agent: `chat: { input: NAME }` when
 * declared, otherwise the agent's only required string input (or only string
 * input). An agent with no such input isn't conversational, and says why.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openStoreDb } from './sqlite-open.js';
import { InboxStore } from './inbox-store.js';
import { budgetTranscript, droppedNote } from './transcript.js';
import { executeAgentDag, type DagExecuteOptions, type DagExecutorDeps } from './dag-executor.js';
import type { Agent } from './agent-v2-types.js';
import type { Run, RunStatus } from './types.js';

export const CONVERSATION_BLOCK_MAX_BYTES = 8 * 1024;
/** Per-turn cap inside the block, so one long reply can't crowd out the rest. */
export const CONVERSATION_TURN_MAX_CHARS = 2000;
export const CHAT_MESSAGE_MAX_BYTES = 8 * 1024;
/** Stored reply cap. The run keeps the full result. */
const REPLY_STORE_MAX_CHARS = 20_000;

export interface Session {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTurn {
  sessionId: string;
  seq: number;
  role: 'user' | 'agent';
  text: string;
  runId?: string;
  /** Agent turns only: the run did not complete, and `text` is its error. */
  failed: boolean;
  createdAt: string;
}

export class NotConversationalError extends Error {
  constructor(agentId: string, detail: string) {
    super(`Agent "${agentId}" can't take a chat message: ${detail}`);
    this.name = 'NotConversationalError';
  }
}

export class ChatMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatMessageError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string, agentId: string) {
    super(`No conversation ${sessionId} with agent "${agentId}".`);
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Conversations live in the inbox store (ADR-0048): a session is an
 * `inbox_messages` row with source `conversation` and the agent in
 * `agent_id`; each turn is an `inbox_responses` row (role `user` or `agent`,
 * `{runId, failed}` in meta_json). The API here is unchanged, so the CLI,
 * MCP, the Chat tab and the socket don't know the storage moved. The old
 * `sessions` / `session_turns` tables are copied over once and kept as
 * `*_legacy`.
 */
export class SessionStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): SessionStore {
    const store = Object.create(SessionStore.prototype) as SessionStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    // The inbox owns the tables; this creates them on a fresh database.
    InboxStore.fromHandle(this.db);
    migrateLegacySessions(this.db);
  }

  create(agentId: string, title: string): Session {
    const now = Date.now();
    const id = randomUUID().slice(0, 8);
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Conversation';
    insertConversation(this.db, { id, agentId, title: clean, createdAt: now });
    const iso = new Date(now).toISOString();
    return { id, agentId, title: clean, createdAt: iso, updatedAt: iso };
  }

  get(id: string): Session | undefined {
    const row = this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM inbox_messages WHERE id = ? AND source = 'conversation'`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? toSession(row) : undefined;
  }

  /** Most recently active first. */
  list(agentId: string, limit = 50): Session[] {
    return (this.db.prepare(`
      SELECT ${SESSION_COLUMNS} FROM inbox_messages
      WHERE agent_id = ? AND source = 'conversation'
      ORDER BY updated_at DESC, rowid DESC LIMIT ?
    `).all(agentId, limit) as Record<string, unknown>[]).map(toSession);
  }

  turns(sessionId: string): SessionTurn[] {
    return (this.db.prepare(`
      SELECT * FROM inbox_responses WHERE message_id = ? AND role IN ('user', 'agent')
      ORDER BY created_at, rowid
    `).all(sessionId) as Record<string, unknown>[]).map((r, i) => toTurn(sessionId, i + 1, r));
  }

  appendTurn(input: { sessionId: string; role: 'user' | 'agent'; text: string; runId?: string; failed?: boolean }): SessionTurn {
    const last = this.db.prepare('SELECT COALESCE(MAX(created_at), 0) AS t, COUNT(*) AS n FROM inbox_responses WHERE message_id = ?')
      .get(input.sessionId) as { t: number; n: number };
    // Never earlier than the turn before, so order holds if the clock steps back.
    const now = Math.max(Date.now(), Number(last.t));
    insertTurn(this.db, { sessionId: input.sessionId, role: input.role, text: input.text, runId: input.runId, failed: input.failed, createdAt: now });
    return {
      sessionId: input.sessionId,
      seq: Number(last.n) + 1,
      role: input.role,
      text: input.text,
      runId: input.runId,
      failed: Boolean(input.failed),
      createdAt: new Date(now).toISOString(),
    };
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    this.db.prepare('DELETE FROM inbox_responses WHERE message_id = ?').run(id);
    return Number(this.db.prepare(`DELETE FROM inbox_messages WHERE id = ? AND source = 'conversation'`).run(id).changes ?? 0) > 0;
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }
}

/** Placeholder body, as on a manual inbox thread: the turns are the content. */
const CONVERSATION_BODY = '(empty)';

const SESSION_COLUMNS = `id, agent_id, title, created_at, COALESCE(
  (SELECT MAX(created_at) FROM inbox_responses WHERE inbox_responses.message_id = inbox_messages.id),
  created_at
) AS updated_at`;

function insertConversation(db: DatabaseSync, c: { id: string; agentId: string; title: string; createdAt: number }): void {
  db.prepare(`
    INSERT INTO inbox_messages (id, created_at, priority, source, agent_id, title, body, status)
    VALUES (?, ?, 'low', 'conversation', ?, ?, ?, 'open')
  `).run(c.id, c.createdAt, c.agentId, c.title, CONVERSATION_BODY);
}

function insertTurn(db: DatabaseSync, t: { sessionId: string; role: 'user' | 'agent'; text: string; runId?: string; failed?: boolean; createdAt: number }): void {
  const meta: Record<string, unknown> = {};
  if (t.runId) meta.runId = t.runId;
  if (t.role === 'agent') meta.failed = Boolean(t.failed);
  db.prepare(`
    INSERT INTO inbox_responses (id, message_id, created_at, role, body, meta_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), t.sessionId, t.createdAt, t.role, t.text, Object.keys(meta).length ? JSON.stringify(meta) : null);
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;
}

function isoToMs(value: unknown, fallback: number): number {
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : fallback;
}

/**
 * Copy pre-0.30 `sessions` / `session_turns` into the inbox tables, once.
 * Ids are kept, so `--session <id>` and Chat tab links still work. A session
 * already copied is skipped, which makes it safe to re-run, including when an
 * older build on the same database recreated the tables after a migration.
 * The originals end up as `sessions_legacy` / `session_turns_legacy`.
 */
export function migrateLegacySessions(db: DatabaseSync): number {
  if (!tableExists(db, 'sessions')) return 0;
  let copied = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Another process may have finished while we waited for the lock.
    if (tableExists(db, 'sessions')) {
      const hasTurns = tableExists(db, 'session_turns');
      const sessions = db.prepare('SELECT * FROM sessions ORDER BY created_at, rowid').all() as Record<string, unknown>[];
      const exists = db.prepare('SELECT 1 FROM inbox_messages WHERE id = ?');
      const turnsOf = hasTurns ? db.prepare('SELECT * FROM session_turns WHERE session_id = ? ORDER BY seq') : undefined;
      for (const s of sessions) {
        const id = String(s.id);
        if (exists.get(id) !== undefined) continue;
        const createdAt = isoToMs(s.created_at, Date.now());
        insertConversation(db, { id, agentId: String(s.agent_id), title: String(s.title), createdAt });
        let prev = createdAt;
        for (const t of (turnsOf?.all(id) ?? []) as Record<string, unknown>[]) {
          prev = Math.max(prev, isoToMs(t.created_at, prev));
          insertTurn(db, {
            sessionId: id,
            role: t.role === 'agent' ? 'agent' : 'user',
            text: String(t.text),
            runId: (t.run_id as string | null) ?? undefined,
            failed: Number(t.failed) === 1,
            createdAt: prev,
          });
        }
        copied++;
      }
      for (const [table, legacy] of [['sessions', 'sessions_legacy'], ['session_turns', 'session_turns_legacy']] as const) {
        if (!tableExists(db, table)) continue;
        if (tableExists(db, legacy)) {
          db.exec(`INSERT OR IGNORE INTO ${legacy} SELECT * FROM ${table}`);
          db.exec(`DROP TABLE ${table}`);
        } else {
          db.exec(`ALTER TABLE ${table} RENAME TO ${legacy}`);
        }
      }
      db.exec('DROP INDEX IF EXISTS idx_sessions_agent');
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return copied;
}

function toSession(r: Record<string, unknown>): Session {
  return {
    id: String(r.id),
    agentId: String(r.agent_id),
    title: String(r.title),
    createdAt: new Date(Number(r.created_at)).toISOString(),
    updatedAt: new Date(Number(r.updated_at)).toISOString(),
  };
}

function toTurn(sessionId: string, seq: number, r: Record<string, unknown>): SessionTurn {
  let meta: { runId?: unknown; failed?: unknown } = {};
  try { meta = r.meta_json ? JSON.parse(String(r.meta_json)) : {}; } catch { /* malformed: no run link */ }
  return {
    sessionId,
    seq,
    role: r.role === 'agent' ? 'agent' : 'user',
    text: String(r.body),
    runId: typeof meta.runId === 'string' ? meta.runId : undefined,
    failed: meta.failed === true,
    createdAt: new Date(Number(r.created_at)).toISOString(),
  };
}

/**
 * The input a chat message fills: `chat.input`, else the only required
 * string input, else the only string input. Throws NotConversationalError
 * naming what would fix it.
 */
export function resolveChatInput(agent: Pick<Agent, 'id' | 'inputs' | 'chat'>): string {
  const inputs = agent.inputs ?? {};
  if (agent.chat?.input) {
    const spec = inputs[agent.chat.input];
    if (!spec) {
      throw new NotConversationalError(agent.id, `chat.input is "${agent.chat.input}", but the agent declares no such input.`);
    }
    if (spec.type !== 'string') {
      throw new NotConversationalError(agent.id, `chat.input "${agent.chat.input}" must be a string input (it is ${spec.type}).`);
    }
    return agent.chat.input;
  }
  const strings = Object.entries(inputs).filter(([, s]) => s.type === 'string');
  const required = strings.filter(([, s]) => s.required && s.default === undefined);
  if (required.length === 1) return required[0][0];
  if (required.length === 0 && strings.length === 1) return strings[0][0];
  const names = (required.length > 1 ? required : strings).map(([n]) => n);
  throw new NotConversationalError(
    agent.id,
    names.length === 0
      ? 'it has no string input for the message. Add one (e.g. inputs: { MESSAGE: { type: string, required: true } }) and use {{inputs.MESSAGE}} in its prompt.'
      : `it has several string inputs (${names.join(', ')}). Set chat: { input: ${names[0]} } on the agent to pick one.`,
  );
}

/**
 * The block a turn starts with: the earlier turns, oldest first, keeping the
 * most recent ones that fit CONVERSATION_BLOCK_MAX_BYTES. Plain text; the
 * executor prepends it after substitution so nothing in it is expanded.
 */
export function formatConversationBlock(turns: readonly SessionTurn[]): string {
  if (turns.length === 0) return '';
  const header = 'CONVERSATION SO FAR (your earlier turns with this user, oldest first; the new message is below — answer it in light of these):';
  const footer = 'END OF CONVERSATION SO FAR';
  const { lines, dropped } = budgetTranscript(
    turns.map((t) => {
      const text = t.role === 'agent' && t.failed ? `(no reply: that run failed — ${t.text.trim().slice(0, 200)})` : t.text.trim();
      return `${t.role === 'user' ? 'User' : 'You'}: ${text}`;
    }),
    {
      maxBytes: CONVERSATION_BLOCK_MAX_BYTES - Buffer.byteLength(header) - Buffer.byteLength(footer) - 2,
      lineMaxChars: CONVERSATION_TURN_MAX_CHARS,
    },
  );
  if (lines.length === 0) return '';
  const note = dropped > 0 ? `${droppedNote(dropped)}\n` : '';
  return `${header}\n${note}${lines.join('\n')}\n${footer}\n`;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(['completed', 'failed', 'cancelled']);

/** The agent turn for a finished run: its result, or its error when it didn't complete. */
function replyFor(run: Pick<Run, 'status' | 'result' | 'error'>): { text: string; failed: boolean } {
  if (run.status === 'completed') {
    const text = (typeof run.result === 'string' ? run.result : '').trim();
    return { text: (text || '(no output)').slice(0, REPLY_STORE_MAX_CHARS), failed: false };
  }
  return { text: (run.error ?? `Run ${run.status}.`).slice(0, REPLY_STORE_MAX_CHARS), failed: true };
}

/**
 * Record the agent's reply for a finished run. Idempotent per run. A run
 * that hasn't finished (e.g. `waiting` on a person's answer) gets no reply
 * yet: reconcileSession adds it once the run ends.
 */
export function completeAgentTurn(
  sessions: SessionStore,
  sessionId: string,
  run: Pick<Run, 'id' | 'status' | 'result' | 'error'>,
): SessionTurn | undefined {
  if (!TERMINAL.has(run.status)) return undefined;
  const existing = sessions.turns(sessionId).find((t) => t.role === 'agent' && t.runId === run.id);
  if (existing) return existing;
  const { text, failed } = replyFor(run);
  return sessions.appendTurn({ sessionId, role: 'agent', text, runId: run.id, failed });
}

/**
 * Fill in replies for turns whose run finished while nobody was waiting
 * (dashboard / Temporal turns, or a CLI that was interrupted). Returns the
 * session's turns afterwards.
 */
export function reconcileSession(
  sessions: SessionStore,
  runStore: { getRun(id: string): Run | null | undefined },
  sessionId: string,
): SessionTurn[] {
  const turns = sessions.turns(sessionId);
  const answered = new Set(turns.filter((t) => t.role === 'agent').map((t) => t.runId));
  let changed = false;
  for (const t of turns) {
    if (t.role !== 'user' || !t.runId || answered.has(t.runId)) continue;
    const run = runStore.getRun(t.runId);
    if (run && TERMINAL.has(run.status)) {
      completeAgentTurn(sessions, sessionId, run);
      changed = true;
    }
  }
  return changed ? sessions.turns(sessionId) : turns;
}

export interface PreparedTurn {
  session: Session;
  /** Pre-generated id of the run this turn will be. */
  runId: string;
  /** The agent inputs for the run: extra `inputs` plus the message in the chat input. */
  inputs: Record<string, string>;
  /** Pass as DagExecuteOptions.conversationPreamble ('' on a first turn). */
  conversationPreamble: string;
}

/**
 * Start a turn: find or create the session, build the history block from
 * the turns so far, and record the user's message against the run id the
 * caller must use. The caller runs the agent, then calls completeAgentTurn
 * (or leaves it to reconcileSession).
 */
export function prepareAgentTurn(args: {
  agent: Pick<Agent, 'id' | 'inputs' | 'chat'>;
  sessions: SessionStore;
  message: string;
  sessionId?: string;
  inputs?: Record<string, string>;
  runStore?: { getRun(id: string): Run | null | undefined };
}): PreparedTurn {
  const message = args.message.trim();
  if (!message) throw new ChatMessageError('The message is empty.');
  if (Buffer.byteLength(message) > CHAT_MESSAGE_MAX_BYTES) {
    throw new ChatMessageError(`The message is too long (max ${CHAT_MESSAGE_MAX_BYTES / 1024} KB).`);
  }
  const chatInput = resolveChatInput(args.agent);
  let session: Session;
  if (args.sessionId) {
    const found = args.sessions.get(args.sessionId);
    if (!found || found.agentId !== args.agent.id) throw new SessionNotFoundError(args.sessionId, args.agent.id);
    session = found;
  } else {
    session = args.sessions.create(args.agent.id, message);
  }
  const prior = args.runStore
    ? reconcileSession(args.sessions, args.runStore, session.id)
    : args.sessions.turns(session.id);
  const conversationPreamble = formatConversationBlock(prior);
  const runId = randomUUID();
  args.sessions.appendTurn({ sessionId: session.id, role: 'user', text: message, runId });
  return { session, runId, inputs: { ...(args.inputs ?? {}), [chatInput]: message }, conversationPreamble };
}

export interface AgentTurnResult {
  sessionId: string;
  run: Run;
  /** Undefined while the run is still going (e.g. waiting on a person's answer). */
  reply?: SessionTurn;
}

/**
 * One whole turn, in process: prepare, run the agent with the history block,
 * record the reply. Used by `sua agent chat` and MCP `run-agent`.
 */
export async function runAgentTurn(args: {
  agent: Agent;
  sessions: SessionStore;
  message: string;
  sessionId?: string;
  inputs?: Record<string, string>;
  triggeredBy: DagExecuteOptions['triggeredBy'];
  deps: DagExecutorDeps;
  signal?: AbortSignal;
  /** Override the executor (tests; the CLI's retry wrapper). */
  execute?: (agent: Agent, options: DagExecuteOptions, deps: DagExecutorDeps) => Promise<Run>;
}): Promise<AgentTurnResult> {
  const prepared = prepareAgentTurn({ ...args, runStore: args.deps.runStore });
  const execute = args.execute ?? executeAgentDag;
  const run = await execute(
    args.agent,
    {
      triggeredBy: args.triggeredBy,
      inputs: prepared.inputs,
      runId: prepared.runId,
      signal: args.signal,
      conversationPreamble: prepared.conversationPreamble || undefined,
    },
    args.deps,
  );
  const reply = completeAgentTurn(args.sessions, prepared.session.id, run);
  return { sessionId: prepared.session.id, run, reply };
}
