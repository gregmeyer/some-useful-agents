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

/** What a field holds, so widgets can format it ($4,023 · 149,652 mi · a link). */
export const NOTEBOOK_FIELD_TYPES = ['money', 'number', 'text', 'url', 'image', 'date'] as const;
export type NotebookFieldType = typeof NOTEBOOK_FIELD_TYPES[number];
/**
 * What a field means across notebooks, so a widget can be reused: a shortlist
 * shows the `price` big, a map plots `price` against `measure`, a card shows
 * the `image`, a button opens the `link`, a list groups by `org` (the company
 * or seller).
 */
export const NOTEBOOK_FIELD_ROLES = ['price', 'measure', 'place', 'link', 'image', 'when', 'org'] as const;
export type NotebookFieldRole = typeof NOTEBOOK_FIELD_ROLES[number];

/** One fact every option in a notebook has: a car's price or miles, a flat's rent. */
export interface NotebookField {
  /** lowercase_snake, e.g. `price`, `miles`, `listing_url`. */
  key: string;
  label: string;
  type: NotebookFieldType;
  /** For numbers: "mi", "sq ft". */
  unit?: string;
  role?: NotebookFieldRole;
  /** For money and numbers: which way is better (a price is lower, a salary or a rating higher). */
  better?: 'higher' | 'lower';
  /** For money and numbers: values may be a range ("$150k–$180k"). */
  range?: boolean;
}

/** A value given as a span: a salary band, a price "from … to …". */
export interface NotebookRange { min: number; max: number }

export type NotebookFieldValue = string | number | NotebookRange;

export function isRange(v: unknown): v is NotebookRange {
  return !!v && typeof v === 'object' && typeof (v as NotebookRange).min === 'number' && typeof (v as NotebookRange).max === 'number';
}

/** A number to sort or plot by: a range counts as its midpoint. */
export function fieldNumber(v: NotebookFieldValue | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (isRange(v)) return (v.min + v.max) / 2;
  return undefined;
}

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
  /** What each option records (empty until sua or you set them). */
  fields: NotebookField[];
  /** The steps an option goes through, in order: Found → Applied → Interview → Offer. */
  stages: string[];
  /** Five-field cron for the pipeline, or empty for "only when asked". */
  cadence: string;
  status: NotebookStatus;
  /** Set when it closes with a decision. */
  decision?: string;
  decidedAt?: string;
  /** When the pipeline last ran, and what it added (one line). */
  lastRunAt?: string;
  lastRunNote?: string;
  /** Its conversation with sua (an inbox thread id). */
  conversationId?: string;
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
  /** An option's facts, by field key. */
  data?: Record<string, NotebookFieldValue>;
  /** What makes an option the same one next time (a listing address, a VIN). */
  fingerprint?: string;
  /** The last run that found it again (first seen is `createdAt`). */
  lastSeenAt?: string;
  /** An option's stage (one of the notebook's stages) and when it got there. */
  stage?: string;
  stageAt?: string;
  /** Set when it's out: why, when, by whom, and at which stage. It stays in the notebook. */
  ruledOut?: { reason: string; at: string; by: string; stage?: string };
  createdAt: string;
}

/** An option an agent found: new, or one the notebook already has, seen again. */
export interface NewOption {
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  fingerprint?: string;
  by: string;
  runId?: string;
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
    for (const [table, col] of [
      ['notebook_entries', 'run_id TEXT'], ['notebooks', 'last_run_at TEXT'], ['notebooks', 'last_run_note TEXT'], ['notebooks', 'conversation_id TEXT'],
      ['notebooks', "fields_json TEXT NOT NULL DEFAULT '[]'"], ['notebook_entries', 'data_json TEXT'], ['notebook_entries', 'fingerprint TEXT'], ['notebook_entries', 'last_seen_at TEXT'],
      ['notebooks', "stages_json TEXT NOT NULL DEFAULT '[]'"], ['notebook_entries', 'stage TEXT'], ['notebook_entries', 'stage_at TEXT'],
      ['notebook_entries', 'ruled_out_at TEXT'], ['notebook_entries', 'ruled_out_reason TEXT'], ['notebook_entries', 'ruled_out_by TEXT'], ['notebook_entries', 'ruled_out_stage TEXT'],
    ] as const) {
      try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already there */ }
    }
  }

  /**
   * Set the stages an option moves through. Options at a stage that's gone
   * move to the first one (matched by name, ignoring case).
   */
  setStages(id: string, list: readonly unknown[]): Notebook {
    this.mustGet(id);
    const stages: string[] = [];
    for (const s of list) {
      const name = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 30) : '';
      if (name && !stages.some((x) => x.toLowerCase() === name.toLowerCase())) stages.push(name);
      if (stages.length === 8) break;
    }
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebooks SET stages_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(stages), now, id);
    for (const e of this.entries(id, 1000)) {
      if (e.kind !== 'option') continue;
      const same = stages.find((s) => s.toLowerCase() === (e.stage ?? '').toLowerCase());
      const to = same ?? stages[0] ?? null;
      if (to !== (e.stage ?? null)) this.db.prepare('UPDATE notebook_entries SET stage = ?, stage_at = COALESCE(stage_at, ?) WHERE id = ?').run(to, now, e.id);
    }
    return this.mustGet(id);
  }

  /** An option by id, fingerprint, or title (exact, then the only one containing it). */
  findOption(notebookId: string, ref: string): NotebookEntry | undefined {
    const options = this.entries(notebookId, 1000).filter((e) => e.kind === 'option');
    const r = ref.trim();
    const key = entryKey(r);
    if (!key) return undefined;
    const hit = options.find((e) => e.id === r || e.fingerprint === r.toLowerCase() || entryKey(e.title) === key);
    if (hit) return hit;
    const partial = options.filter((e) => entryKey(e.title).includes(key));
    return partial.length === 1 ? partial[0] : undefined;
  }

  /** Move an option to one of the notebook's stages (reinstating it if it was ruled out). */
  moveOption(notebookId: string, entryId: string, stage: string): NotebookEntry {
    const nb = this.mustGet(notebookId);
    const to = nb.stages.find((s) => s.toLowerCase() === stage.trim().toLowerCase());
    if (!to) throw new Error(`"${stage}" isn't one of this notebook's stages${nb.stages.length ? ` (${nb.stages.join(', ')})` : ''}.`);
    const e = this.mustGetOption(notebookId, entryId);
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebook_entries SET stage = ?, stage_at = ?, ruled_out_at = NULL, ruled_out_reason = NULL, ruled_out_by = NULL, ruled_out_stage = NULL WHERE id = ?').run(to, now, e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(now, notebookId);
    return this.mustGetOption(notebookId, entryId);
  }

  /** Rule an option out, with why. It stays (for the funnel and the history); searches won't bring it back. */
  ruleOut(notebookId: string, entryId: string, reason: string, by = 'you'): NotebookEntry {
    const e = this.mustGetOption(notebookId, entryId);
    const why = reason.replace(/\s+/g, ' ').trim().slice(0, 200) || 'ruled out';
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebook_entries SET ruled_out_at = ?, ruled_out_reason = ?, ruled_out_by = ?, ruled_out_stage = ? WHERE id = ?').run(now, why, by, e.stage ?? null, e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(now, notebookId);
    return this.mustGetOption(notebookId, entryId);
  }

  /** Bring a ruled-out option back, at the stage it was at. */
  reinstate(notebookId: string, entryId: string): NotebookEntry {
    const e = this.mustGetOption(notebookId, entryId);
    this.db.prepare('UPDATE notebook_entries SET ruled_out_at = NULL, ruled_out_reason = NULL, ruled_out_by = NULL, ruled_out_stage = NULL WHERE id = ?').run(e.id);
    return this.mustGetOption(notebookId, entryId);
  }

  private mustGetOption(notebookId: string, entryId: string): NotebookEntry {
    const row = this.db.prepare("SELECT * FROM notebook_entries WHERE id = ? AND notebook_id = ? AND kind = 'option'").get(entryId, notebookId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('No such option in this notebook.');
    return this.toEntry(row);
  }

  /** Replace what options record. Invalid fields are dropped; at most 12. */
  setFields(id: string, fields: readonly unknown[]): Notebook {
    this.mustGet(id);
    this.db.prepare('UPDATE notebooks SET fields_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(cleanFields(fields)), new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /**
   * Add an option, or, when one with the same fingerprint is already here,
   * refresh its facts and when it was last seen instead of adding it twice.
   */
  upsertOption(notebookId: string, input: NewOption): { entry: NotebookEntry; seenAgain: boolean; ruledOut?: boolean } {
    const nb = this.mustGet(notebookId);
    const data = cleanData(input.data, nb.fields);
    const fingerprint = optionFingerprint(input.fingerprint, data, nb.fields);
    const now = new Date().toISOString();
    if (fingerprint) {
      const row = this.db.prepare("SELECT * FROM notebook_entries WHERE notebook_id = ? AND kind = 'option' AND fingerprint = ? LIMIT 1").get(notebookId, fingerprint) as Record<string, unknown> | undefined;
      // An option kept before fingerprints existed: the same title, or its text holds this listing's address.
      const legacy = row ? undefined : (this.db.prepare("SELECT * FROM notebook_entries WHERE notebook_id = ? AND kind = 'option' AND fingerprint IS NULL").all(notebookId) as Array<Record<string, unknown>>)
        .find((r) => entryKey(String(r.title)) === entryKey(input.title) || String(r.body ?? '').toLowerCase().replace(/https?:\/\/(www\.)?/g, '').includes(fingerprint));
      if (legacy) this.db.prepare('UPDATE notebook_entries SET fingerprint = ? WHERE id = ?').run(fingerprint, String(legacy.id));
      const match = row ?? legacy;
      if (match) {
        const prev = this.toEntry(match);
        const merged = { ...(prev.data ?? {}), ...data };
        this.db.prepare('UPDATE notebook_entries SET data_json = ?, last_seen_at = ?, run_id = COALESCE(?, run_id) WHERE id = ?')
          .run(JSON.stringify(merged), now, input.runId ?? null, prev.id);
        // Ruled out stays ruled out: a search finding it again only notes when it was seen.
        return { entry: { ...prev, data: merged, lastSeenAt: now, ...(input.runId ? { runId: input.runId } : {}) }, seenAgain: true, ...(prev.ruledOut ? { ruledOut: true } : {}) };
      }
    }
    const entry = this.addEntry(notebookId, { kind: 'option', title: input.title, body: input.body, by: input.by, runId: input.runId });
    const stage = nb.stages[0];
    this.db.prepare('UPDATE notebook_entries SET data_json = ?, fingerprint = ?, last_seen_at = ?, stage = ?, stage_at = ? WHERE id = ?')
      .run(Object.keys(data).length ? JSON.stringify(data) : null, fingerprint ?? null, now, stage ?? null, stage ? now : null, entry.id);
    return { entry: { ...entry, ...(Object.keys(data).length ? { data } : {}), ...(fingerprint ? { fingerprint } : {}), lastSeenAt: now, ...(stage ? { stage, stageAt: now } : {}) }, seenAgain: false };
  }

  /**
   * Options kept before the notebook had fields: read what's unambiguous in
   * their text (price, the main measure, the year, the listing link) into
   * data, so they compare and chart with the rest. Returns how many changed.
   */
  backfillOptions(id: string): number {
    const nb = this.mustGet(id);
    if (nb.fields.length === 0) return 0;
    let n = 0;
    for (const e of this.entries(id, 1000)) {
      if (e.kind !== 'option' || (e.data && Object.keys(e.data).length > 0)) continue;
      const data = readOptionText(`${e.title}\n${e.body}`, nb.fields);
      if (Object.keys(data).length === 0) continue;
      const fp = e.fingerprint ?? optionFingerprint(undefined, data, nb.fields);
      this.db.prepare('UPDATE notebook_entries SET data_json = ?, fingerprint = COALESCE(fingerprint, ?) WHERE id = ?').run(JSON.stringify(data), fp ?? null, e.id);
      n++;
    }
    return n;
  }

  /** Link the notebook to its conversation with sua. */
  setConversation(id: string, threadId: string): void {
    this.db.prepare('UPDATE notebooks SET conversation_id = ? WHERE id = ?').run(threadId, id);
  }

  /** Add parameters / criteria (skipping ones it has), e.g. from the conversation. */
  extend(id: string, add: { params?: readonly string[]; criteria?: readonly string[] }): Notebook {
    const nb = this.mustGet(id);
    const has = (list: readonly string[], s: string) => list.some((x) => x.toLowerCase() === s.toLowerCase());
    const params = [...nb.params];
    for (const p of clean(add.params)) if (!has(params, p)) params.push(p);
    const criteria = [...nb.criteria];
    for (const c of clean(add.criteria, 10)) if (!has(criteria.map((x) => x.text), c)) criteria.push({ text: c, met: false });
    this.db.prepare('UPDATE notebooks SET params_json = ?, criteria_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(params.slice(0, 20)), JSON.stringify(criteria.slice(0, 10)), new Date().toISOString(), id);
    return this.mustGet(id);
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
      fields: parse<NotebookField[]>(r.fields_json, []),
      stages: parse<string[]>(r.stages_json, []),
      cadence: String(r.cadence ?? ''),
      status: String(r.status) as NotebookStatus,
      ...(r.decision ? { decision: String(r.decision) } : {}),
      ...(r.decided_at ? { decidedAt: String(r.decided_at) } : {}),
      ...(r.last_run_at ? { lastRunAt: String(r.last_run_at) } : {}),
      ...(r.last_run_note ? { lastRunNote: String(r.last_run_note) } : {}),
      ...(r.conversation_id ? { conversationId: String(r.conversation_id) } : {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private toEntry(r: Record<string, unknown>): NotebookEntry {
    return {
      id: String(r.id), notebookId: String(r.notebook_id), kind: String(r.kind) as NotebookEntryKind,
      title: String(r.title), body: String(r.body ?? ''), by: String(r.by),
      ...(r.run_id ? { runId: String(r.run_id) } : {}),
      ...(r.data_json ? { data: (() => { try { return JSON.parse(String(r.data_json)) as Record<string, NotebookFieldValue>; } catch { return {}; } })() } : {}),
      ...(r.fingerprint ? { fingerprint: String(r.fingerprint) } : {}),
      ...(r.last_seen_at ? { lastSeenAt: String(r.last_seen_at) } : {}),
      ...(r.stage ? { stage: String(r.stage) } : {}),
      ...(r.stage_at ? { stageAt: String(r.stage_at) } : {}),
      ...(r.ruled_out_at ? { ruledOut: { reason: String(r.ruled_out_reason ?? ''), at: String(r.ruled_out_at), by: String(r.ruled_out_by ?? 'you'), ...(r.ruled_out_stage ? { stage: String(r.ruled_out_stage) } : {}) } } : {}),
      createdAt: String(r.created_at),
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

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Keep only well-formed fields, one per key and at most one per role. */
export function cleanFields(list: readonly unknown[]): NotebookField[] {
  const out: NotebookField[] = [];
  const roles = new Set<string>();
  for (const f of list) {
    const x = f as Partial<Record<keyof NotebookField, unknown>>;
    const key = typeof x.key === 'string' ? x.key.trim() : '';
    if (!FIELD_KEY_RE.test(key) || out.some((o) => o.key === key)) continue;
    const type = (NOTEBOOK_FIELD_TYPES as readonly string[]).includes(String(x.type)) ? x.type as NotebookFieldType : 'text';
    const role = (NOTEBOOK_FIELD_ROLES as readonly string[]).includes(String(x.role)) && !roles.has(String(x.role)) ? x.role as NotebookFieldRole : undefined;
    if (role) roles.add(role);
    const label = typeof x.label === 'string' && x.label.trim() ? x.label.trim().slice(0, 40) : key.replace(/_/g, ' ');
    const unit = typeof x.unit === 'string' && x.unit.trim() ? x.unit.trim().slice(0, 12) : undefined;
    const numeric = type === 'money' || type === 'number';
    // A price is better lower unless the notebook says otherwise (a salary is a price that's better higher).
    const better = numeric && (x.better === 'higher' || x.better === 'lower') ? x.better : numeric && role === 'price' ? 'lower' as const : undefined;
    const range = numeric && x.range === true;
    out.push({ key, label, type, ...(unit ? { unit } : {}), ...(role ? { role } : {}), ...(better ? { better } : {}), ...(range ? { range: true } : {}) });
    if (out.length === 12) break;
  }
  return out;
}

/** "$150k–$180k", "150,000 - 180,000", "150-180k" → { min, max }. */
function toRange(v: unknown): NotebookRange | number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (isRange(v)) return v.min <= v.max ? { min: v.min, max: v.max } : { min: v.max, max: v.min };
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) return toRange({ min: v[0], max: v[1] });
  if (typeof v !== 'string') return undefined;
  const parts = [...v.replace(/\s/g, '').matchAll(/(\d[\d,]*(?:\.\d+)?)(k)?/gi)].slice(0, 2);
  if (parts.length === 0) return undefined;
  const vals = parts.map((m) => ({ n: Number(m[1].replace(/,/g, '')), k: !!m[2] }));
  // "150-180k": the k on the second number applies to a bare first one.
  if (vals.length === 2 && vals[1].k && !vals[0].k && vals[0].n < 1000) vals[0].k = true;
  const nums = vals.map((x) => (x.k ? x.n * 1000 : x.n));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  return nums.length === 1 ? nums[0] : toRange({ min: nums[0], max: nums[1] });
}

/** "$4,023" → 4023, "149,652 mi" → 149652; anything else as trimmed text. */
function toValue(v: unknown, type: NotebookFieldType, range = false): NotebookFieldValue | undefined {
  if (range && (type === 'money' || type === 'number')) return toRange(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (type === 'money' || type === 'number') {
    const m = /-?\d[\d,]*(?:\.\d+)?/.exec(s.replace(/\s/g, ''));
    if (!m) return undefined;
    let n = Number(m[0].replace(/,/g, ''));
    if (/^\$?\d+(?:\.\d+)?k$/i.test(s.replace(/[\s,]/g, ''))) n *= 1000;
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'url' || type === 'image') return /^https?:\/\//i.test(s) ? s.slice(0, 2000) : undefined;
  return s.slice(0, 200);
}

/** An option's facts, keyed and typed by the notebook's fields (unknown keys dropped). */
export function cleanData(data: Record<string, unknown> | undefined, fields: readonly NotebookField[]): Record<string, NotebookFieldValue> {
  const out: Record<string, NotebookFieldValue> = {};
  if (!data || typeof data !== 'object') return out;
  for (const f of fields) {
    const v = toValue(data[f.key], f.type, f.range);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/**
 * What makes an option the same one next run: the fingerprint the agent gave
 * (a VIN, a listing id), else the option's link without tracking bits.
 */
export function optionFingerprint(given: string | undefined, data: Record<string, NotebookFieldValue>, fields: readonly NotebookField[]): string | undefined {
  const g = typeof given === 'string' ? given.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (g) return g;
  const link = fields.find((f) => f.role === 'link');
  const url = link ? data[link.key] : undefined;
  if (typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch { return undefined; }
}

/** An option as widgets see it: its facts by key, plus the role-mapped ones. */
export interface NotebookViewOption {
  id: string;
  title: string;
  body: string;
  /** The option's facts by field key. */
  fields: Record<string, NotebookFieldValue>;
  /** For sorting and plotting; a range counts as its midpoint (the span is in `fields`). */
  price?: number;
  measure?: number;
  place?: string;
  org?: string;
  link?: string;
  image?: string;
  when?: string;
  by: string;
  runId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Its stage, and that stage's position (0 = the first). */
  stage?: string;
  stageIndex: number;
  ruledOut?: { reason: string; at: string; by: string; stage?: string };
}

/** One stage of the funnel: how many got this far, are here now, or were ruled out here (and why). */
export interface NotebookFunnelStage {
  stage: string;
  reached: number;
  here: number;
  ruledOut: number;
  reasons: Array<{ reason: string; count: number }>;
}

export interface NotebookViewEntry { id: string; kind: NotebookEntryKind; title: string; body: string; by: string; runId?: string; at: string }

/**
 * The data a notebook's widgets bind to, under `/notebook`: the same shape for
 * every notebook, so a shortlist or a price map built for one works on any.
 */
export interface NotebookViewData {
  notebook: {
    id: string;
    title: string;
    statement: string;
    status: NotebookStatus;
    decision?: string;
    limits: string[];
    criteria: NotebookCriterion[];
    progress: { met: number; total: number };
    fields: NotebookField[];
    stages: string[];
    /** Options still in the running, then the ruled-out ones. */
    options: NotebookViewOption[];
    /** Per stage, in order; empty when the notebook has no stages. */
    funnel: NotebookFunnelStage[];
    active: number;
    ruledOutCount: number;
    notes: NotebookViewEntry[];
    evidence: NotebookViewEntry[];
    decisions: NotebookViewEntry[];
    /** Everything, newest first. */
    history: NotebookViewEntry[];
    lastRunAt?: string;
    lastRunNote?: string;
  };
}

export function notebookViewData(nb: Notebook, entries: readonly NotebookEntry[]): NotebookViewData {
  const byRole = new Map(nb.fields.filter((f) => f.role).map((f) => [f.role!, f.key]));
  const pick = (data: Record<string, NotebookFieldValue>, role: NotebookFieldRole) => {
    const key = byRole.get(role);
    return key === undefined ? undefined : data[key];
  };
  const view = (e: NotebookEntry): NotebookViewEntry => ({ id: e.id, kind: e.kind, title: e.title, body: e.body, by: e.by, ...(e.runId ? { runId: e.runId } : {}), at: e.createdAt });
  const options = entries.filter((e) => e.kind === 'option').map((e): NotebookViewOption => {
    const data = e.data ?? {};
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const price = fieldNumber(pick(data, 'price'));
    const measure = fieldNumber(pick(data, 'measure'));
    const org = str(pick(data, 'org'));
    const place = str(pick(data, 'place'));
    const link = str(pick(data, 'link'));
    const image = str(pick(data, 'image'));
    const when = pick(data, 'when');
    return {
      id: e.id, title: e.title, body: e.body, fields: data,
      ...(price !== undefined ? { price } : {}), ...(measure !== undefined ? { measure } : {}),
      ...(place ? { place } : {}), ...(org ? { org } : {}), ...(link ? { link } : {}), ...(image ? { image } : {}),
      ...(when !== undefined ? { when: String(when) } : {}),
      by: e.by, ...(e.runId ? { runId: e.runId } : {}),
      firstSeenAt: e.createdAt, lastSeenAt: e.lastSeenAt ?? e.createdAt,
      ...(e.stage ? { stage: e.stage } : {}),
      stageIndex: Math.max(0, nb.stages.findIndex((s) => s === (e.ruledOut?.stage ?? e.stage))),
      ...(e.ruledOut ? { ruledOut: e.ruledOut } : {}),
    };
  });
  options.sort((a, b) => Number(!!a.ruledOut) - Number(!!b.ruledOut));
  const funnel: NotebookFunnelStage[] = nb.stages.map((stage, i) => {
    const out = options.filter((o) => o.ruledOut && o.stageIndex === i);
    const reasons = new Map<string, number>();
    for (const o of out) { const r = o.ruledOut!.reason.toLowerCase(); reasons.set(r, (reasons.get(r) ?? 0) + 1); }
    return {
      stage,
      reached: options.filter((o) => o.stageIndex >= i).length,
      here: options.filter((o) => !o.ruledOut && o.stageIndex === i).length,
      ruledOut: out.length,
      reasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })),
    };
  });
  return {
    notebook: {
      id: nb.id, title: nb.title, statement: nb.statement, status: nb.status,
      ...(nb.decision ? { decision: nb.decision } : {}),
      limits: nb.params, criteria: nb.criteria, progress: notebookProgress(nb), fields: nb.fields, stages: nb.stages,
      options, funnel,
      active: options.filter((o) => !o.ruledOut).length,
      ruledOutCount: options.filter((o) => o.ruledOut).length,
      notes: entries.filter((e) => e.kind === 'note').map(view),
      evidence: entries.filter((e) => e.kind === 'evidence').map(view),
      decisions: entries.filter((e) => e.kind === 'decision').map(view),
      history: entries.map(view),
      ...(nb.lastRunAt ? { lastRunAt: nb.lastRunAt } : {}),
      ...(nb.lastRunNote ? { lastRunNote: nb.lastRunNote } : {}),
    },
  };
}

/**
 * The unambiguous facts in an option's text, for the notebook's fields: a
 * dollar amount for the price, a number with the measure's unit ("157k mi"),
 * a leading year for a `year` field, the first web address for the link.
 */
export function readOptionText(text: string, fields: readonly NotebookField[]): Record<string, NotebookFieldValue> {
  const out: Record<string, NotebookFieldValue> = {};
  const num = (s: string) => { const k = /k$/i.test(s); const v = Number(s.replace(/[k,]/gi, '')); return Number.isFinite(v) ? (k ? v * 1000 : v) : undefined; };
  for (const f of fields) {
    if (f.role === 'price' && f.type === 'money') {
      const m = /\$\s?(\d[\d,]*(?:\.\d+)?k?)/i.exec(text);
      const v = m ? num(m[1]) : undefined;
      if (v !== undefined) out[f.key] = v;
    } else if (f.role === 'measure' && f.unit) {
      const unit = f.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?k?)\\s*${unit}\\b`, 'i').exec(text);
      const v = m ? num(m[1]) : undefined;
      if (v !== undefined) out[f.key] = v;
    } else if (f.key === 'year' && f.type === 'number') {
      const m = /^\s*((?:19|20)\d{2})\b/.exec(text);
      if (m) out[f.key] = Number(m[1]);
    } else if (f.role === 'link') {
      const m = /https?:\/\/[^\s<>"'()]+/.exec(text);
      if (m) out[f.key] = m[0].replace(/[.,;:!?]+$/, '');
    }
  }
  return out;
}
