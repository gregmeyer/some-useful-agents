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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS session_turns (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        run_id TEXT,
        failed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
    `);
  }

  create(agentId: string, title: string): Session {
    const now = new Date().toISOString();
    const id = randomUUID().slice(0, 8);
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Conversation';
    this.db.prepare('INSERT INTO sessions (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, agentId, clean, now, now);
    return { id, agentId, title: clean, createdAt: now, updatedAt: now };
  }

  get(id: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toSession(row) : undefined;
  }

  /** Most recently active first. */
  list(agentId: string, limit = 50): Session[] {
    return (this.db.prepare('SELECT * FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?')
      .all(agentId, limit) as Record<string, unknown>[]).map(toSession);
  }

  turns(sessionId: string): SessionTurn[] {
    return (this.db.prepare('SELECT * FROM session_turns WHERE session_id = ? ORDER BY seq')
      .all(sessionId) as Record<string, unknown>[]).map(toTurn);
  }

  appendTurn(input: { sessionId: string; role: 'user' | 'agent'; text: string; runId?: string; failed?: boolean }): SessionTurn {
    const now = new Date().toISOString();
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM session_turns WHERE session_id = ?')
      .get(input.sessionId) as { n: number };
    const seq = Number(row.n) + 1;
    this.db.prepare(`
      INSERT INTO session_turns (session_id, seq, role, text, run_id, failed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.sessionId, seq, input.role, input.text, input.runId ?? null, input.failed ? 1 : 0, now);
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, input.sessionId);
    return { sessionId: input.sessionId, seq, role: input.role, text: input.text, runId: input.runId, failed: Boolean(input.failed), createdAt: now };
  }

  delete(id: string): boolean {
    this.db.prepare('DELETE FROM session_turns WHERE session_id = ?').run(id);
    return Number(this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes ?? 0) > 0;
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }
}

function toSession(r: Record<string, unknown>): Session {
  return {
    id: String(r.id),
    agentId: String(r.agent_id),
    title: String(r.title),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toTurn(r: Record<string, unknown>): SessionTurn {
  return {
    sessionId: String(r.session_id),
    seq: Number(r.seq),
    role: r.role === 'agent' ? 'agent' : 'user',
    text: String(r.text),
    runId: (r.run_id as string | null) ?? undefined,
    failed: Number(r.failed) === 1,
    createdAt: String(r.created_at),
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

/** Record the agent's reply for a finished run. Idempotent per run. */
export function completeAgentTurn(
  sessions: SessionStore,
  sessionId: string,
  run: Pick<Run, 'id' | 'status' | 'result' | 'error'>,
): SessionTurn {
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
  reply: SessionTurn;
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
