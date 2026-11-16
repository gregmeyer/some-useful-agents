/**
 * Notebooks asked for from elsewhere (the MCP server's notebook-create tool):
 * a queued request in the shared database, which the dashboard claims and
 * makes, from a template or by drafting an ask, as New notebook would. The
 * same queue-and-claim shape as board builds (board-build.ts).
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openStoreDb } from './sqlite-open.js';
import { type NotebookStore, type NotebookTemplate } from './notebooks.js';

export type NotebookRequestPhase = 'queued' | 'drafting' | 'creating' | 'ready' | 'failed';

/** What was asked for: a template (by id) and who or what it's about, or an ask sua drafts a notebook from. */
export interface NotebookRequestInput {
  template?: string;
  subject?: string;
  title?: string;
  ask?: string;
  /** Start its first step once it's made. */
  start?: boolean;
  origin?: string;
}

export interface NotebookRequest {
  id: string;
  phase: NotebookRequestPhase;
  detail: string;
  error?: string;
  notebookId?: string;
  input: NotebookRequestInput;
  createdAt: number;
  updatedAt: number;
}

const ACTIVE = "('drafting','creating')";

export class NotebookRequestStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;
  constructor(dbPathOrHandle: string | DatabaseSync) {
    if (typeof dbPathOrHandle === 'string') { this.db = openStoreDb(dbPathOrHandle); this.ownsConnection = true; } else { this.db = dbPathOrHandle; this.ownsConnection = false; }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notebook_requests (
        id TEXT PRIMARY KEY,
        phase TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        error TEXT,
        notebook_id TEXT,
        input_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notebook_requests_phase ON notebook_requests (phase, created_at);
    `);
  }

  /** Queue a request for the dashboard to make. */
  create(input: NotebookRequestInput): NotebookRequest {
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare('INSERT INTO notebook_requests (id, phase, detail, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, 'queued', 'Waiting for the dashboard to make it…', JSON.stringify(input), now, now);
    return this.get(id)!;
  }

  /** Claim a queued request for making (only one claimer wins). */
  claim(id: string): boolean {
    const r = this.db.prepare("UPDATE notebook_requests SET phase = 'creating', detail = 'Making the notebook…', updated_at = ? WHERE id = ? AND phase = 'queued'").run(Date.now(), id);
    return Number(r.changes) === 1;
  }

  queued(): NotebookRequest[] {
    return (this.db.prepare("SELECT * FROM notebook_requests WHERE phase = 'queued' ORDER BY created_at").all() as Array<Record<string, unknown>>).map((r) => this.row(r));
  }

  /** Requests a restart interrupted (being drafted or made). */
  unfinished(): NotebookRequest[] {
    return (this.db.prepare(`SELECT * FROM notebook_requests WHERE phase IN ${ACTIVE}`).all() as Array<Record<string, unknown>>).map((r) => this.row(r));
  }

  update(id: string, patch: Partial<Pick<NotebookRequest, 'phase' | 'detail' | 'error' | 'notebookId'>>): void {
    const cur = this.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.db.prepare('UPDATE notebook_requests SET phase = ?, detail = ?, error = ?, notebook_id = ?, updated_at = ? WHERE id = ?')
      .run(next.phase, next.detail, next.error ?? null, next.notebookId ?? null, Date.now(), id);
  }

  get(id: string): NotebookRequest | undefined {
    const r = this.db.prepare('SELECT * FROM notebook_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }

  private row(r: Record<string, unknown>): NotebookRequest {
    let input: NotebookRequestInput = {};
    try { input = JSON.parse(String(r.input_json ?? '{}')) as NotebookRequestInput; } catch { input = {}; }
    return {
      id: String(r.id), phase: r.phase as NotebookRequestPhase, detail: String(r.detail ?? ''),
      ...(r.error ? { error: String(r.error) } : {}),
      ...(r.notebook_id ? { notebookId: String(r.notebook_id) } : {}),
      input, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }

  close(): void { if (this.ownsConnection) this.db.close(); }
}

/** Does a notebook from this template need to be told who or what it's about? */
export function templateNeedsSubject(t: NotebookTemplate): boolean {
  return !!t.setup.subject;
}

/**
 * One of your templates, by its id or by words from its name ("company
 * briefing"); archived ones only by exact id, so the error can say so.
 */
export function findNotebookTemplate(store: NotebookStore, ref: string): NotebookTemplate | undefined {
  const want = ref.trim();
  if (!want) return undefined;
  const exact = store.getTemplate(want);
  if (exact) return exact;
  const words = want.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return undefined;
  const live = store.listTemplates(200);
  const named = live.find((t) => t.name.toLowerCase() === want.toLowerCase());
  if (named) return named;
  return live.find((t) => { const n = `${t.name} ${t.id}`.toLowerCase(); return words.every((w) => n.includes(w)); });
}

/**
 * Check a request before it's queued: a template that exists, isn't
 * archived, and has its subject; or an ask. Returns the request to queue
 * (the template by its id) or why not.
 */
export function checkNotebookRequest(store: NotebookStore, input: NotebookRequestInput): NotebookRequestInput | { error: string } {
  const template = input.template?.trim() ?? '';
  const ask = input.ask?.replace(/\s+/g, ' ').trim() ?? '';
  const subject = input.subject?.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '';
  const title = input.title?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '';
  if (!!template === !!ask) return { error: 'Give either template (start from one of their templates; list them with notebook-templates) or ask (what the notebook is for, in a sentence), not both.' };
  const rest = { ...(title ? { title } : {}), ...(input.start ? { start: true } : {}), ...(input.origin ? { origin: input.origin } : {}) };
  if (ask) return { ask: ask.slice(0, 1000), ...rest };
  const t = findNotebookTemplate(store, template);
  if (!t) return { error: `There's no template "${template}". List them with notebook-templates.` };
  if (t.archivedAt) return { error: `The template "${t.name}" is archived. The person can restore it from New notebook → Archived templates.` };
  if (templateNeedsSubject(t) && !subject) return { error: `The template "${t.name}" needs to know ${t.setup.subject!.label.replace(/^./, (c) => c.toLowerCase())} (subject), e.g. "${t.setup.subject!.example}".` };
  return { template: t.id, ...(subject ? { subject } : {}), ...rest };
}
