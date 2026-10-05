/**
 * Notebooks (goal surfaces track G1): a goal you keep over time. A notebook
 * states what it's for, the parameters it works within, the criteria that say
 * it's done, the agents in its pipeline and how often they run, and it closes
 * with a decision. Everything it learns is an entry: a note, an option, a
 * piece of evidence, or a decision, each with who added it.
 *
 * Its page is drawn from its own surface (`notebook:<id>`, see surfaces/),
 * from items projected out of its entries.
 */
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openStoreDb } from './sqlite-open.js';
import type { Item } from './items/types.js';

export type NotebookStatus = 'active' | 'decided' | 'stopped';
export const NOTEBOOK_ENTRY_KINDS = ['note', 'option', 'evidence', 'decision'] as const;
export type NotebookEntryKind = typeof NOTEBOOK_ENTRY_KINDS[number];

export interface NotebookCriterion {
  text: string;
  met: boolean;
}

export interface Notebook {
  id: string;
  title: string;
  /** What it's for, in a sentence: "Find a reliable used SUV and decide by Oct 15". */
  statement: string;
  /** The bounds it works within: "under $26,000", "AWD". */
  params: string[];
  /** Done when every one is met. */
  criteria: NotebookCriterion[];
  /** Agent ids that gather for it, in order. */
  pipeline: string[];
  /** Five-field cron for the pipeline, or empty for "only when asked". */
  cadence: string;
  status: NotebookStatus;
  /** Set when it closes with a decision. */
  decision?: string;
  decidedAt?: string;
  /** When the pipeline last ran, and what it added (one line). */
  lastRunAt?: string;
  lastRunNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookEntry {
  id: string;
  notebookId: string;
  kind: NotebookEntryKind;
  title: string;
  body: string;
  /** `you`, or `agent:<id>` / `run:<id>`. */
  by: string;
  /** The run it came from, when an agent added it. */
  runId?: string;
  createdAt: string;
}

export interface NewNotebook {
  title: string;
  statement?: string;
  params?: string[];
  criteria?: string[];
  pipeline?: string[];
  cadence?: string;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** "Buy a used car" → "buy-a-used-car" (unique-ified by the store). */
export function notebookSlug(title: string): string {
  const s = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'notebook';
}

const clean = (list: readonly string[] | undefined, max = 20) =>
  (list ?? []).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max);

export class NotebookStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): NotebookStore {
    const store = Object.create(NotebookStore.prototype) as NotebookStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notebooks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        statement TEXT NOT NULL DEFAULT '',
        params_json TEXT NOT NULL DEFAULT '[]',
        criteria_json TEXT NOT NULL DEFAULT '[]',
        pipeline_json TEXT NOT NULL DEFAULT '[]',
        cadence TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        decision TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notebook_entries (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notebook_entries_by_notebook ON notebook_entries (notebook_id, created_at);
    `);
    // G2 columns, added to tables created before them.
    for (const [table, col] of [['notebook_entries', 'run_id TEXT'], ['notebooks', 'last_run_at TEXT'], ['notebooks', 'last_run_note TEXT']] as const) {
      try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already there */ }
    }
  }

  /** Record a pipeline run's outcome (one line) on the notebook. */
  noteRun(id: string, note: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebooks SET last_run_at = ?, last_run_note = ?, updated_at = ? WHERE id = ?').run(now, note.slice(0, 300), now, id);
  }

  create(input: NewNotebook): Notebook {
    const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) throw new Error('A notebook needs a title.');
    let id = notebookSlug(title);
    for (let n = 2; this.get(id); n++) id = `${notebookSlug(title).slice(0, 44)}-${String(n)}`;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO notebooks (id, title, statement, params_json, criteria_json, pipeline_json, cadence, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(
      id, title, (input.statement ?? '').trim().slice(0, 500),
      JSON.stringify(clean(input.params)),
      JSON.stringify(clean(input.criteria, 10).map((text) => ({ text, met: false }))),
      JSON.stringify(clean(input.pipeline, 10).filter((a) => ID_RE.test(a))),
      (input.cadence ?? '').trim(), now, now,
    );
    return this.get(id)!;
  }

  get(id: string): Notebook | undefined {
    const r = this.db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.toNotebook(r) : undefined;
  }

  /** Active first, then most recently changed. */
  list(opts: { status?: NotebookStatus } = {}): Notebook[] {
    const rows = (opts.status
      ? this.db.prepare("SELECT * FROM notebooks WHERE status = ? ORDER BY updated_at DESC").all(opts.status)
      : this.db.prepare("SELECT * FROM notebooks ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC").all()) as Array<Record<string, unknown>>;
    return rows.map((r) => this.toNotebook(r));
  }

  update(id: string, patch: Partial<Pick<NewNotebook, 'title' | 'statement' | 'params' | 'pipeline' | 'cadence'>>): Notebook {
    const nb = this.mustGet(id);
    const next = {
      title: patch.title !== undefined ? patch.title.replace(/\s+/g, ' ').trim().slice(0, 120) || nb.title : nb.title,
      statement: patch.statement !== undefined ? patch.statement.trim().slice(0, 500) : nb.statement,
      params: patch.params !== undefined ? clean(patch.params) : nb.params,
      pipeline: patch.pipeline !== undefined ? clean(patch.pipeline, 10).filter((a) => ID_RE.test(a)) : nb.pipeline,
      cadence: patch.cadence !== undefined ? patch.cadence.trim() : nb.cadence,
    };
    this.db.prepare('UPDATE notebooks SET title = ?, statement = ?, params_json = ?, pipeline_json = ?, cadence = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.statement, JSON.stringify(next.params), JSON.stringify(next.pipeline), next.cadence, new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /** Replace the criteria, keeping "met" for any whose text is unchanged. */
  setCriteria(id: string, texts: readonly string[]): Notebook {
    const nb = this.mustGet(id);
    const was = new Map(nb.criteria.map((c) => [c.text, c.met]));
    const criteria = clean(texts, 10).map((text) => ({ text, met: was.get(text) ?? false }));
    this.db.prepare('UPDATE notebooks SET criteria_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(criteria), new Date().toISOString(), id);
    return this.mustGet(id);
  }

  markCriterion(id: string, index: number, met: boolean): Notebook {
    const nb = this.mustGet(id);
    if (!nb.criteria[index]) throw new Error(`There's no criterion ${String(index + 1)}.`);
    const criteria = nb.criteria.map((c, i) => (i === index ? { ...c, met } : c));
    this.db.prepare('UPDATE notebooks SET criteria_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(criteria), new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /** Close with a decision: recorded as an entry too, so the history reads in one place. */
  decide(id: string, decision: string, by = 'you'): Notebook {
    const text = decision.trim().slice(0, 2000);
    if (!text) throw new Error('Say what you decided.');
    this.mustGet(id);
    const now = new Date().toISOString();
    this.db.prepare("UPDATE notebooks SET status = 'decided', decision = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(text, now, now, id);
    this.addEntry(id, { kind: 'decision', title: 'Decided', body: text, by });
    return this.mustGet(id);
  }

  setStatus(id: string, status: NotebookStatus): Notebook {
    this.mustGet(id);
    this.db.prepare('UPDATE notebooks SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    return this.mustGet(id);
  }

  addEntry(notebookId: string, input: { kind: NotebookEntryKind; title: string; body?: string; by: string; runId?: string }): NotebookEntry {
    this.mustGet(notebookId);
    if (!(NOTEBOOK_ENTRY_KINDS as readonly string[]).includes(input.kind)) throw new Error(`Not an entry kind: ${input.kind}.`);
    const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!title) throw new Error('An entry needs a line of text.');
    const entry: NotebookEntry = {
      id: randomUUID(), notebookId, kind: input.kind, title, body: (input.body ?? '').trim().slice(0, 8000), by: input.by,
      ...(input.runId ? { runId: input.runId } : {}), createdAt: new Date().toISOString(),
    };
    this.db.prepare('INSERT INTO notebook_entries (id, notebook_id, kind, title, body, by, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.id, notebookId, entry.kind, entry.title, entry.body, entry.by, entry.runId ?? null, entry.createdAt);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(entry.createdAt, notebookId);
    return entry;
  }

  /** Newest first. */
  entries(notebookId: string, limit = 200): NotebookEntry[] {
    return (this.db.prepare('SELECT * FROM notebook_entries WHERE notebook_id = ? ORDER BY created_at DESC LIMIT ?').all(notebookId, limit) as Array<Record<string, unknown>>)
      .map((r) => this.toEntry(r));
  }

  removeEntry(notebookId: string, entryId: string): boolean {
    const r = this.db.prepare('DELETE FROM notebook_entries WHERE id = ? AND notebook_id = ?').run(entryId, notebookId);
    return Number(r.changes) === 1;
  }

  private mustGet(id: string): Notebook {
    const nb = this.get(id);
    if (!nb) throw new Error(`No notebook "${id}".`);
    return nb;
  }

  // Methods, not arrow fields: fromHandle skips field initializers.
  private toNotebook(r: Record<string, unknown>): Notebook {
    const parse = <T>(v: unknown, d: T): T => { try { return JSON.parse(String(v)) as T; } catch { return d; } };
    return {
      id: String(r.id),
      title: String(r.title),
      statement: String(r.statement ?? ''),
      params: parse<string[]>(r.params_json, []),
      criteria: parse<NotebookCriterion[]>(r.criteria_json, []),
      pipeline: parse<string[]>(r.pipeline_json, []),
      cadence: String(r.cadence ?? ''),
      status: String(r.status) as NotebookStatus,
      ...(r.decision ? { decision: String(r.decision) } : {}),
      ...(r.decided_at ? { decidedAt: String(r.decided_at) } : {}),
      ...(r.last_run_at ? { lastRunAt: String(r.last_run_at) } : {}),
      ...(r.last_run_note ? { lastRunNote: String(r.last_run_note) } : {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private toEntry(r: Record<string, unknown>): NotebookEntry {
    return {
      id: String(r.id), notebookId: String(r.notebook_id), kind: String(r.kind) as NotebookEntryKind,
      title: String(r.title), body: String(r.body ?? ''), by: String(r.by),
      ...(r.run_id ? { runId: String(r.run_id) } : {}), createdAt: String(r.created_at),
    };
  }
}

/** How many criteria are met, e.g. { met: 2, total: 3 }. */
export function notebookProgress(nb: Pick<Notebook, 'criteria'>): { met: number; total: number } {
  return { met: nb.criteria.filter((c) => c.met).length, total: nb.criteria.length };
}

const ENTRY_KIND: Record<NotebookEntryKind, Item['kind']> = { note: 'fact', option: 'collection', evidence: 'evidence', decision: 'decision' };

/** A notebook's entries as items, for its own surface (`notebook:<id>`). */
export function notebookEntryItems(nb: Notebook, entries: readonly NotebookEntry[]): Item[] {
  return entries.map((e) => ({
    id: `nbentry:${e.id}`,
    kind: ENTRY_KIND[e.kind],
    title: e.title,
    ...(e.body ? { summary: e.body.replace(/\s+/g, ' ').slice(0, 160) } : {}),
    urgency: e.kind === 'decision' ? 'high' as const : 'normal' as const,
    state: 'ok' as const,
    subject: {},
    value: e.kind,
    actions: [],
    evidence: [],
    provenance: { source: 'agents' as const, producedBy: e.by === 'you' ? 'system' : e.by, at: e.createdAt },
    href: `/notebooks/${encodeURIComponent(nb.id)}#entry-${e.id}`,
  }));
}

/** A title reduced for "have we seen this?": lowercase letters and digits only. */
export function entryKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
