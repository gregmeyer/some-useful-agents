/**
 * Questions a run asks a person (ask nodes). The run stops in `waiting`,
 * holding no process; the question shows in the inbox; answering it resumes
 * the run, and the node completes with the answer. See docs/ask-a-person.md
 * and ADR-0042.
 *
 * One row per (run, node) ask. The executor looks the row up when it reaches
 * the node: none → ask (create it, stop); answered → complete with the
 * answer; expired / cancelled → the node fails.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openStoreDb } from './sqlite-open.js';
import { InboxStore } from './inbox-store.js';

export type QuestionStatus = 'pending' | 'answered' | 'expired' | 'cancelled';

export interface HumanQuestion {
  id: string;
  runId: string;
  nodeId: string;
  agentId: string;
  question: string;
  choices: string[];
  status: QuestionStatus;
  answer?: string;
  answeredAt?: string;
  expiresAt: string;
  createdAt: string;
  /** The inbox item the question is asked in, once created. */
  inboxMessageId?: string;
}

export const DEFAULT_ASK_TIMEOUT_HOURS = 72;
export const ANSWER_MAX_CHARS = 8000;

export class HumanQuestionStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): HumanQuestionStore {
    const store = Object.create(HumanQuestionStore.prototype) as HumanQuestionStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS human_questions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        question TEXT NOT NULL,
        choices_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        answer TEXT,
        answered_at TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        inbox_message_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_human_questions_run ON human_questions(run_id, node_id);
      CREATE INDEX IF NOT EXISTS idx_human_questions_status ON human_questions(status, expires_at);
    `);
  }

  ask(input: { runId: string; nodeId: string; agentId: string; question: string; choices?: string[]; timeoutHours?: number }): HumanQuestion {
    const id = randomUUID().slice(0, 12);
    const now = new Date();
    const hours = input.timeoutHours ?? DEFAULT_ASK_TIMEOUT_HOURS;
    const expiresAt = new Date(now.getTime() + hours * 3_600_000).toISOString();
    this.db.prepare(`
      INSERT INTO human_questions (id, run_id, node_id, agent_id, question, choices_json, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, input.runId, input.nodeId, input.agentId, input.question, JSON.stringify(input.choices ?? []), expiresAt, now.toISOString());
    return this.get(id)!;
  }

  get(id: string): HumanQuestion | undefined {
    const row = this.db.prepare('SELECT * FROM human_questions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toQuestion(row) : undefined;
  }

  /** The latest question a run's node asked. */
  forNode(runId: string, nodeId: string): HumanQuestion | undefined {
    const row = this.db.prepare('SELECT * FROM human_questions WHERE run_id = ? AND node_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(runId, nodeId) as Record<string, unknown> | undefined;
    return row ? toQuestion(row) : undefined;
  }

  /** The question a run is waiting on, if any. */
  pendingForRun(runId: string): HumanQuestion | undefined {
    const row = this.db.prepare("SELECT * FROM human_questions WHERE run_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
      .get(runId) as Record<string, unknown> | undefined;
    return row ? toQuestion(row) : undefined;
  }

  listPending(limit = 100): HumanQuestion[] {
    return (this.db.prepare("SELECT * FROM human_questions WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?")
      .all(limit) as Record<string, unknown>[]).map(toQuestion);
  }

  /** Pending questions past their deadline. */
  listExpired(now: Date = new Date()): HumanQuestion[] {
    return (this.db.prepare("SELECT * FROM human_questions WHERE status = 'pending' AND expires_at <= ?")
      .all(now.toISOString()) as Record<string, unknown>[]).map(toQuestion);
  }

  /**
   * Record the answer. Only a pending question can be answered, once: a
   * second answer (double click, two tabs) returns false and changes nothing.
   */
  answer(id: string, answer: string): boolean {
    const text = answer.trim().slice(0, ANSWER_MAX_CHARS);
    if (!text) throw new Error('The answer is empty.');
    const res = this.db.prepare(`
      UPDATE human_questions SET status = 'answered', answer = ?, answered_at = ? WHERE id = ? AND status = 'pending'
    `).run(text, new Date().toISOString(), id);
    return Number(res.changes ?? 0) > 0;
  }

  /** Close a pending question without an answer (`expired` or `cancelled`). */
  closeQuestion(id: string, status: 'expired' | 'cancelled'): boolean {
    const res = this.db.prepare(`UPDATE human_questions SET status = ? WHERE id = ? AND status = 'pending'`).run(status, id);
    return Number(res.changes ?? 0) > 0;
  }

  setInboxMessage(id: string, inboxMessageId: string): void {
    this.db.prepare('UPDATE human_questions SET inbox_message_id = ? WHERE id = ?').run(inboxMessageId, id);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }
}

function toQuestion(r: Record<string, unknown>): HumanQuestion {
  let choices: string[] = [];
  try { choices = JSON.parse(String(r.choices_json ?? '[]')) as string[]; } catch { choices = []; }
  return {
    id: String(r.id),
    runId: String(r.run_id),
    nodeId: String(r.node_id),
    agentId: String(r.agent_id),
    question: String(r.question),
    choices,
    status: String(r.status) as QuestionStatus,
    answer: (r.answer as string | null) ?? undefined,
    answeredAt: (r.answered_at as string | null) ?? undefined,
    expiresAt: String(r.expires_at),
    createdAt: String(r.created_at),
    inboxMessageId: (r.inbox_message_id as string | null) ?? undefined,
  };
}

/** The choice an answer matches (case-insensitive, trimmed), or '' for a written answer. */
export function matchChoice(answer: string, choices: readonly string[]): string {
  const a = answer.trim().toLowerCase();
  return choices.find((c) => c.trim().toLowerCase() === a) ?? '';
}

/**
 * Put a question in the inbox (source `question`, never auto-triaged) and
 * link it to the question. Idempotent: a question already raised keeps its
 * item. Returns the inbox message id.
 */
export function raiseQuestionInInbox(db: DatabaseSync, question: HumanQuestion, agentName: string): string {
  if (question.inboxMessageId) return question.inboxMessageId;
  const inbox = InboxStore.fromHandle(db);
  const firstLine = question.question.split('\n').find((l) => l.trim())?.trim() ?? question.question;
  const title = `${agentName} is asking: ${firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine}`;
  const choices = question.choices.length > 0 ? `\n\nChoices: ${question.choices.join(' · ')}` : '';
  const message = inbox.add({
    priority: 'high',
    source: 'question',
    title,
    body: `${question.question}${choices}\n\nThe run is waiting for your answer. Answer by ${new Date(question.expiresAt).toLocaleString()} or it fails.`,
    agentId: question.agentId,
    runId: question.runId,
    contextJson: JSON.stringify({ questionId: question.id, nodeId: question.nodeId }),
    dedupeKey: `question:${question.id}`,
  });
  HumanQuestionStore.fromHandle(db).setInboxMessage(question.id, message.id);
  return message.id;
}
