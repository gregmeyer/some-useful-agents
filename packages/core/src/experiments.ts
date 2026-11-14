/**
 * Experiments (ADR-0078): the same ask given to one agent under named
 * versions of it, each run several times, so what a change does to what the
 * agent produces can be measured rather than argued.
 *
 * - The **ask** is the agent's inputs, the same for every run.
 * - A **factor** is one thing changed ("Build", "Preferences"); each of its
 *   **levels** is a version of it: an agent version, a provider or model,
 *   or a value for one of the agent's inputs. **Conditions** are every
 *   combination of one level per factor; the first is the baseline.
 * - A **pass** is one run-through of the grid: a **cell** for every
 *   condition and repeat, each holding the run it made and the items that
 *   run's output listed. A pass is kept cell by cell, so a restart loses
 *   nothing.
 *
 * The whole agent runs each time: it searches, reads and decides as it
 * would for anyone. Nothing is held back from it but the changes named.
 * What the cells measured is counted in experiment-measures.ts. This file
 * stores; it runs nothing.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { openStoreDb } from './sqlite-open.js';
import { chmod600Safe } from './fs-utils.js';
import type { MeasuredCondition } from './experiment-measures.js';
import type { OutputItem } from './experiment-output.js';

/** What is compared. `outputs`: the items each run's output lists. */
export type ExperimentKind = 'outputs';

export const EXPERIMENT_MAX_FACTORS = 3;
export const EXPERIMENT_MAX_LEVELS = 4;
export const EXPERIMENT_MAX_CONDITIONS = 12;
export const EXPERIMENT_MAX_REPEATS = 5;
/** Runs one pass may make, at most (conditions × repeats, and once more for each judge). Each is the whole agent. */
export const EXPERIMENT_MAX_RUNS = 36;
export const EXPERIMENT_MAX_SCORERS = 3;

/** One version of a thing that is changed. */
export interface ExperimentLevel {
  id: string;
  name: string;
  /** Run this version of the agent (its current one otherwise). */
  version?: number;
  provider?: string;
  model?: string;
  /** Values for the agent's inputs, in place of the ask's. */
  inputs?: Record<string, string>;
}
export interface ExperimentFactor { id: string; name: string; levels: ExperimentLevel[] }
export type ExperimentCondition = MeasuredCondition;

/**
 * How each result is scored, beside how the results compare.
 * - `found`: counted in code. The share of the named things (words from a
 *   title, or part of a link) that the output lists; with `avoid`, the
 *   share it does not list.
 * - `judge`: a model reads one result against a rubric in plain words and
 *   gives 0 to 1 with a reason. It sees the ask and the items; never which
 *   version produced them.
 */
export type ExperimentScorer =
  | { id: string; name: string; kind: 'found'; items: string[]; avoid?: boolean }
  | { id: string; name: string; kind: 'judge'; rubric: string; provider?: string; model?: string };

/** One result's score from one scorer. */
export interface ExperimentScore { cellId: string; scorerId: string; value?: number; reason?: string; cites?: string[]; runId?: string; error?: string }

export type ExperimentCellStatus = 'todo' | 'running' | 'done' | 'invalid' | 'failed' | 'stopped';

export interface Experiment {
  id: string;
  name: string;
  /** What it is meant to find out, in the words it was asked in. */
  question: string;
  kind: ExperimentKind;
  /** The agent every cell runs, whole. */
  task: { agentId: string };
  /** The ask: the agent's inputs, the same for every run. */
  inputs: Record<string, string>;
  factors: ExperimentFactor[];
  repeats: number;
  scorers: ExperimentScorer[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ExperimentPass { id: string; experimentId: string; startedAt: string; finishedAt?: string; /** The agent's current version when it started. */ taskVersion?: number; note?: string }

export interface ExperimentCell {
  id: string;
  passId: string;
  experimentId: string;
  conditionId: string;
  repeat: number;
  status: ExperimentCellStatus;
  runId?: string;
  agentVersion?: number;
  usedProvider?: string;
  usedModel?: string;
  /** What the run's output listed, in its order. */
  items?: OutputItem[];
  /** Why it is invalid or failed. */
  error?: string;
  costUsd?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface NewExperiment {
  name: string;
  question?: string;
  task: { agentId: string };
  inputs?: unknown;
  factors: unknown;
  repeats?: number;
  scorers?: unknown;
}

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const slug = (s: string, fallback: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
function unique(want: string, taken: Set<string>): string {
  let id = want;
  for (let n = 2; taken.has(id); n++) id = `${want}-${String(n)}`;
  taken.add(id);
  return id;
}

/** An agent's inputs as kept: names as the agent declares them (letters, digits, underscore), values as text. Pure. */
export function cleanInputs(raw: unknown, max = 16): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, max)) {
    const key = k.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60);
    const val = text(typeof v === 'number' || typeof v === 'boolean' ? String(v) : v, 8000);
    if (key && val) out[key] = val;
  }
  return out;
}

/**
 * Factors as an experiment keeps them: up to three, each with two to four
 * named levels; a factor with fewer than two levels changes nothing and is
 * dropped. A level keeps only what it sets. Pure.
 */
export function cleanFactors(raw: unknown): ExperimentFactor[] {
  const out: ExperimentFactor[] = [];
  const ids = new Set<string>();
  for (const f of Array.isArray(raw) ? raw : []) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const name = line(r.name, 40);
    if (!name) continue;
    const levels: ExperimentLevel[] = [];
    const levelIds = new Set<string>();
    for (const l of Array.isArray(r.levels) ? r.levels : []) {
      if (!l || typeof l !== 'object') continue;
      const lr = l as Record<string, unknown>;
      const lname = line(lr.name, 60);
      if (!lname) continue;
      const inputs = cleanInputs(lr.inputs, 8);
      const version = Number(lr.version);
      const provider = line(lr.provider, 40);
      const model = line(lr.model, 80);
      levels.push({
        id: unique(slug(typeof lr.id === 'string' && lr.id ? lr.id : lname, 'level'), levelIds), name: lname,
        ...(Number.isInteger(version) && version > 0 ? { version } : {}),
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(Object.keys(inputs).length ? { inputs } : {}),
      });
      if (levels.length === EXPERIMENT_MAX_LEVELS) break;
    }
    if (levels.length < 2) continue;
    out.push({ id: unique(slug(typeof r.id === 'string' && r.id ? r.id : name, 'factor'), ids), name, levels });
    if (out.length === EXPERIMENT_MAX_FACTORS) break;
  }
  return out;
}

/**
 * Every combination of one level per factor, the first level of each first
 * (so the first condition is the baseline). No factors: one condition, "As
 * it is". Pure.
 */
export function experimentConditions(factors: readonly ExperimentFactor[]): ExperimentCondition[] {
  let rows: Array<Array<{ f: ExperimentFactor; l: ExperimentLevel }>> = [[]];
  for (const f of factors) rows = rows.flatMap((row) => f.levels.map((l) => [...row, { f, l }]));
  return rows.map((row) => ({
    id: row.map((x) => x.l.id).join('+') || 'as-it-is',
    name: row.map((x) => x.l.name).join(' · ') || 'As it is',
    levels: Object.fromEntries(row.map((x) => [x.f.id, x.l.id])),
  }));
}

/** The levels a condition takes, in factor order. */
export function conditionLevels(factors: readonly ExperimentFactor[], condition: Pick<ExperimentCondition, 'levels'>): ExperimentLevel[] {
  return factors.flatMap((f) => { const l = f.levels.find((x) => x.id === condition.levels[f.id]); return l ? [l] : []; });
}

/** Scorers as kept: up to three. A `found` scorer needs at least one thing named; a `judge` needs a rubric. Pure. */
export function cleanScorers(raw: unknown): ExperimentScorer[] {
  const out: ExperimentScorer[] = [];
  const ids = new Set<string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const name = line(r.name, 60);
    if (r.kind === 'found') {
      const items = [...new Set((Array.isArray(r.items) ? r.items : []).map((i) => line(i, 120)).filter(Boolean))].slice(0, 20);
      if (!items.length) continue;
      const avoid = r.avoid === true;
      out.push({ id: unique(slug(typeof r.id === 'string' && r.id ? r.id : name || (avoid ? 'left-out' : 'found'), 'found'), ids), name: name || (avoid ? 'Left out' : 'Found'), kind: 'found', items, ...(avoid ? { avoid } : {}) });
    } else if (r.kind === 'judge') {
      const rubric = text(r.rubric, 2000);
      if (!rubric) continue;
      const provider = line(r.provider, 40);
      const model = line(r.model, 80);
      out.push({ id: unique(slug(typeof r.id === 'string' && r.id ? r.id : name || 'judge', 'judge'), ids), name: name || 'Judge', kind: 'judge', rubric, ...(provider ? { provider } : {}), ...(model ? { model } : {}) });
    }
    if (out.length === EXPERIMENT_MAX_SCORERS) break;
  }
  return out;
}

const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A `found` scorer's score for one output: the share of the things it names
 * that the output lists (a name matches an item whose title holds its
 * words, or whose link holds it); with `avoid`, the share it doesn't. Pure.
 */
export function foundScore(scorer: Extract<ExperimentScorer, { kind: 'found' }>, items: readonly Pick<OutputItem, 'title' | 'link'>[]): number {
  const titles = items.map((i) => plain(i.title));
  const links = items.map((i) => (i.link ?? '').toLowerCase());
  const hit = (want: string) => { const w = plain(want); return (w.length > 0 && titles.some((t) => t.includes(w))) || links.some((l) => l && l.includes(want.toLowerCase())); };
  const n = scorer.items.filter(hit).length;
  return (scorer.avoid ? scorer.items.length - n : n) / scorer.items.length;
}

/**
 * A judge's answer as a score, or why it can't be used: a number from 0 to
 * 1 and a reason; and, unless the output listed nothing, at least one item
 * it points to by its number in the list (a judge that cites nothing, or
 * something not there, is not taken on trust). Pure.
 */
export function cleanJudgement(raw: unknown, itemCount: number): { value: number; reason: string; cites: string[] } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'It gave no score object.' };
  const r = raw as Record<string, unknown>;
  const value = typeof r.score === 'number' ? r.score : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > 1) return { error: 'Its score is not a number from 0 to 1.' };
  const reason = line(r.reason, 400);
  if (!reason) return { error: 'It gave no reason.' };
  const cites = [...new Set((Array.isArray(r.cites) ? r.cites : []).map((c) => Number(c)).filter((n) => Number.isInteger(n)))];
  if (itemCount > 0 && !cites.length) return { error: 'It cites no item. Give the numbers of the items its reason rests on.' };
  const bad = cites.find((n) => n < 1 || n > itemCount);
  if (bad !== undefined) return { error: `It cites item ${String(bad)}, and the list has ${String(itemCount)}.` };
  return { value, reason, cites: cites.slice(0, 10).map(String) };
}

/** How many runs one pass makes: the agent once per condition and repeat, and one more for each judge. */
export function experimentRunCount(e: Pick<Experiment, 'factors' | 'repeats'> & { scorers?: readonly ExperimentScorer[] }): number {
  const judges = (e.scorers ?? []).filter((s) => s.kind === 'judge').length;
  return experimentConditions(e.factors).length * e.repeats * (1 + judges);
}

/** One scorer's scores for one condition, over that condition's results. */
export interface ScoreSummary { scorerId: string; conditionId: string; mean: number; min: number; max: number; n: number }

/** Each scorer's average for each condition (with the lowest and highest seen): `found` scorers counted here, judges from their stored scores. Pure. */
export function scoreSummaries(scorers: readonly ExperimentScorer[], cells: readonly Pick<ExperimentCell, 'id' | 'conditionId' | 'status' | 'items'>[], scores: readonly ExperimentScore[]): ScoreSummary[] {
  const out: ScoreSummary[] = [];
  const done = cells.filter((c) => c.status === 'done' && c.items);
  for (const s of scorers) {
    for (const conditionId of [...new Set(done.map((c) => c.conditionId))]) {
      const mine = done.filter((c) => c.conditionId === conditionId);
      const values = s.kind === 'found'
        ? mine.map((c) => foundScore(s, c.items!))
        : mine.flatMap((c) => { const sc = scores.find((x) => x.cellId === c.id && x.scorerId === s.id); return sc?.value !== undefined ? [sc.value] : []; });
      if (values.length) out.push({ scorerId: s.id, conditionId, mean: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values), n: values.length });
    }
  }
  return out;
}

export class ExperimentStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = openStoreDb(dbPath);
    this.ownsConnection = true;
    chmod600Safe(dbPath);
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): ExperimentStore {
    const store = Object.create(ExperimentStore.prototype) as ExperimentStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }

  private ensureSchema(): void {
    // Columns from the first shape of experiments (a frozen list re-ranked: cases, top_k, ranking_json, from_json)
    // stay in tables made then and are no longer read.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        question TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'outputs',
        task_json TEXT NOT NULL,
        factors_json TEXT NOT NULL DEFAULT '[]',
        repeats INTEGER NOT NULL DEFAULT 3,
        top_k INTEGER NOT NULL DEFAULT 5,
        from_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS experiment_passes (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        task_version INTEGER,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_experiment_passes_exp ON experiment_passes(experiment_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS experiment_cells (
        id TEXT PRIMARY KEY,
        pass_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        case_id TEXT NOT NULL DEFAULT 'ask',
        condition_id TEXT NOT NULL,
        repeat INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        run_id TEXT,
        agent_version INTEGER,
        used_provider TEXT,
        used_model TEXT,
        ranking_json TEXT,
        error TEXT,
        cost_usd REAL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_experiment_cells_pass ON experiment_cells(pass_id);
      CREATE TABLE IF NOT EXISTS experiment_scores (
        cell_id TEXT NOT NULL,
        scorer_id TEXT NOT NULL,
        pass_id TEXT NOT NULL,
        value REAL,
        reason TEXT,
        cites_json TEXT,
        run_id TEXT,
        error TEXT,
        PRIMARY KEY (cell_id, scorer_id)
      );
      CREATE INDEX IF NOT EXISTS idx_experiment_scores_pass ON experiment_scores(pass_id);
    `);
    for (const [table, col] of [['experiments', "scorers_json TEXT NOT NULL DEFAULT '[]'"], ['experiments', "inputs_json TEXT NOT NULL DEFAULT '{}'"], ['experiment_cells', 'items_json TEXT']] as const) {
      try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already there */ }
    }
  }

  private row(r: Record<string, unknown>): Experiment {
    const json = <T>(v: unknown, d: T): T => { try { return typeof v === 'string' ? JSON.parse(v) as T : d; } catch { return d; } };
    return {
      id: String(r.id), name: String(r.name), question: String(r.question ?? ''), kind: 'outputs',
      task: json(r.task_json, { agentId: '' }), inputs: cleanInputs(json(r.inputs_json, {})),
      factors: cleanFactors(json(r.factors_json, [])), repeats: Number(r.repeats),
      scorers: cleanScorers(json(r.scorers_json, [])),
      createdAt: String(r.created_at), updatedAt: String(r.updated_at),
      ...(r.archived_at ? { archivedAt: String(r.archived_at) } : {}),
    };
  }

  /** A new experiment. Refuses one with no agent, or a grid larger than a pass may run. */
  create(input: NewExperiment): Experiment {
    const name = line(input.name, 120);
    if (!name) throw new Error('Give the experiment a name.');
    const agentId = line(input.task?.agentId, 120);
    if (!agentId) throw new Error('Choose the agent to run.');
    const factors = cleanFactors(input.factors);
    const repeats = int(input.repeats, 1, EXPERIMENT_MAX_REPEATS, 2);
    const conditions = experimentConditions(factors).length;
    if (conditions > EXPERIMENT_MAX_CONDITIONS) throw new Error(`That is ${String(conditions)} versions to run; ${String(EXPERIMENT_MAX_CONDITIONS)} at most. Change fewer things, or give them fewer versions.`);
    const scorers = cleanScorers(input.scorers);
    const judges = scorers.filter((x) => x.kind === 'judge').length;
    const runs = conditions * repeats * (1 + judges);
    if (runs > EXPERIMENT_MAX_RUNS) throw new Error(`That is ${String(runs)} runs a pass${judges ? ' (each judge reads every result)' : ''}; ${String(EXPERIMENT_MAX_RUNS)} at most, since each is the whole agent. Use fewer repeats, versions or judges.`);
    let id = slug(name, 'experiment');
    for (let n = 2; this.get(id); n++) id = `${slug(name, 'experiment').slice(0, 36).replace(/-+$/, '')}-${String(n)}`;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO experiments (id, name, question, kind, task_json, inputs_json, factors_json, repeats, scorers_json, created_at, updated_at)
      VALUES (?, ?, ?, 'outputs', ?, ?, ?, ?, ?, ?, ?)`).run(id, name, text(input.question, 1000), JSON.stringify({ agentId }), JSON.stringify(cleanInputs(input.inputs)), JSON.stringify(factors), repeats, JSON.stringify(scorers), now, now);
    return this.get(id)!;
  }

  get(id: string): Experiment | undefined {
    const r = this.db.prepare("SELECT * FROM experiments WHERE id = ? AND kind = 'outputs'").get(id) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }

  /** Newest first; archived ones only when asked. */
  list(opts: { archived?: boolean } = {}): Experiment[] {
    const rows = this.db.prepare(`SELECT * FROM experiments WHERE kind = 'outputs' ${opts.archived ? '' : 'AND archived_at IS NULL'} ORDER BY created_at DESC, rowid DESC`).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.row(r));
  }

  /** Its name and question (what it runs never changes: make a new experiment for that). */
  rename(id: string, patch: { name?: string; question?: string }): Experiment | undefined {
    const e = this.get(id);
    if (!e) return undefined;
    this.db.prepare('UPDATE experiments SET name = ?, question = ?, updated_at = ? WHERE id = ?').run(line(patch.name, 120) || e.name, patch.question === undefined ? e.question : text(patch.question, 1000), new Date().toISOString(), id);
    return this.get(id);
  }

  archive(id: string, archived = true): void {
    this.db.prepare('UPDATE experiments SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? new Date().toISOString() : null, new Date().toISOString(), id);
  }

  private cell(r: Record<string, unknown>): ExperimentCell {
    let items: OutputItem[] | undefined;
    try { const v = r.items_json ? JSON.parse(String(r.items_json)) as unknown : undefined; if (Array.isArray(v)) items = v as OutputItem[]; } catch { /* none */ }
    const opt = <K extends string>(k: K, v: unknown) => (v === null || v === undefined || v === '' ? {} : { [k]: v } as Record<K, never>);
    return {
      id: String(r.id), passId: String(r.pass_id), experimentId: String(r.experiment_id), conditionId: String(r.condition_id),
      repeat: Number(r.repeat), status: String(r.status) as ExperimentCellStatus,
      ...opt('runId', r.run_id), ...(r.agent_version !== null && r.agent_version !== undefined ? { agentVersion: Number(r.agent_version) } : {}),
      ...opt('usedProvider', r.used_provider), ...opt('usedModel', r.used_model),
      ...(items ? { items } : {}), ...opt('error', r.error),
      ...(r.cost_usd !== null && r.cost_usd !== undefined ? { costUsd: Number(r.cost_usd) } : {}),
      ...opt('startedAt', r.started_at), ...opt('finishedAt', r.finished_at),
    };
  }

  private pass(r: Record<string, unknown>): ExperimentPass {
    return {
      id: String(r.id), experimentId: String(r.experiment_id), startedAt: String(r.started_at),
      ...(r.finished_at ? { finishedAt: String(r.finished_at) } : {}),
      ...(r.task_version !== null && r.task_version !== undefined ? { taskVersion: Number(r.task_version) } : {}),
      ...(r.note ? { note: String(r.note) } : {}),
    };
  }

  /** A new pass: a cell to do for every condition and repeat. */
  startPass(experimentId: string, opts: { taskVersion?: number; id?: string } = {}): ExperimentPass {
    const e = this.get(experimentId);
    if (!e) throw new Error('No such experiment.');
    const conditions = experimentConditions(e.factors);
    const now = new Date().toISOString();
    const passId = opts.id ?? `${experimentId}-${now.replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO experiment_passes (id, experiment_id, started_at, task_version) VALUES (?, ?, ?, ?)').run(passId, experimentId, now, opts.taskVersion ?? null);
      const ins = this.db.prepare("INSERT INTO experiment_cells (id, pass_id, experiment_id, case_id, condition_id, repeat, status) VALUES (?, ?, ?, 'ask', ?, ?, 'todo')");
      // Repeat by repeat, so a pass stopped early has every condition run about as often.
      for (let r = 1; r <= e.repeats; r++) for (const cd of conditions) ins.run(`${passId}|${cd.id}|${String(r)}`, passId, experimentId, cd.id, r);
      this.db.prepare('UPDATE experiments SET updated_at = ? WHERE id = ?').run(now, experimentId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.passes(experimentId).find((p) => p.id === passId)!;
  }

  /** Its passes, newest first. */
  passes(experimentId: string, limit = 20): ExperimentPass[] {
    const rows = this.db.prepare('SELECT * FROM experiment_passes WHERE experiment_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(experimentId, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.pass(r));
  }

  getPass(passId: string): ExperimentPass | undefined {
    const r = this.db.prepare('SELECT * FROM experiment_passes WHERE id = ?').get(passId) as Record<string, unknown> | undefined;
    return r ? this.pass(r) : undefined;
  }

  /** A pass's cells, in the order they run. */
  cells(passId: string): ExperimentCell[] {
    const rows = this.db.prepare('SELECT * FROM experiment_cells WHERE pass_id = ? ORDER BY rowid').all(passId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.cell(r));
  }

  /** Take the next cell to do, marked running. Undefined when none is left. One statement, so two workers never take the same cell. */
  claimCell(passId: string): ExperimentCell | undefined {
    const now = new Date().toISOString();
    const r = this.db.prepare(`UPDATE experiment_cells SET status = 'running', started_at = ?
      WHERE id = (SELECT id FROM experiment_cells WHERE pass_id = ? AND status = 'todo' ORDER BY rowid LIMIT 1) AND status = 'todo'
      RETURNING *`).get(now, passId) as Record<string, unknown> | undefined;
    return r ? this.cell(r) : undefined;
  }

  /** How a cell ended (or which run it is making). */
  updateCell(cellId: string, patch: Partial<Pick<ExperimentCell, 'status' | 'runId' | 'agentVersion' | 'usedProvider' | 'usedModel' | 'items' | 'error' | 'costUsd'>>): void {
    const sets: string[] = [];
    const vals: Array<string | number | null> = [];
    const set = (col: string, v: string | number | null | undefined) => { if (v !== undefined) { sets.push(`${col} = ?`); vals.push(v); } };
    set('status', patch.status);
    set('run_id', patch.runId);
    set('agent_version', patch.agentVersion);
    set('used_provider', patch.usedProvider);
    set('used_model', patch.usedModel);
    set('items_json', patch.items ? JSON.stringify(patch.items) : undefined);
    set('error', patch.error === undefined ? undefined : patch.error.slice(0, 500));
    set('cost_usd', patch.costUsd);
    if (patch.status && patch.status !== 'running' && patch.status !== 'todo') set('finished_at', new Date().toISOString());
    if (!sets.length) return;
    this.db.prepare(`UPDATE experiment_cells SET ${sets.join(', ')} WHERE id = ?`).run(...vals, cellId);
  }

  /** Stop a pass: cells not yet run are marked stopped (running ones end themselves). Returns how many. */
  stopPass(passId: string): number {
    const r = this.db.prepare("UPDATE experiment_cells SET status = 'stopped', finished_at = ? WHERE pass_id = ? AND status = 'todo'").run(new Date().toISOString(), passId);
    return Number(r.changes);
  }

  /** Put a pass's unfinished cells back to do: ones stopped, ones that failed or came back unreadable when `retry`, and ones left running by a restart. Returns how many. */
  resumePass(passId: string, opts: { retry?: boolean } = {}): number {
    const states = ["'stopped'", "'running'", ...(opts.retry ? ["'failed'", "'invalid'"] : [])].join(', ');
    const r = this.db.prepare(`UPDATE experiment_cells SET status = 'todo', run_id = NULL, error = NULL, started_at = NULL, finished_at = NULL WHERE pass_id = ? AND status IN (${states})`).run(passId);
    if (Number(r.changes)) this.db.prepare('UPDATE experiment_passes SET finished_at = NULL WHERE id = ?').run(passId);
    return Number(r.changes);
  }

  /** Cells a restart left marked running, across every pass: they are stopped, to be resumed. Returns the passes they were in. */
  stopInterrupted(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT pass_id FROM experiment_cells WHERE status = 'running'").all() as Array<{ pass_id: string }>;
    const now = new Date().toISOString();
    for (const r of rows) {
      this.db.prepare("UPDATE experiment_cells SET status = 'stopped', error = 'Cut off by a restart.', finished_at = ? WHERE pass_id = ? AND status IN ('running', 'todo')").run(now, r.pass_id);
      this.db.prepare('UPDATE experiment_passes SET finished_at = ?, note = ? WHERE id = ?').run(now, 'Cut off by a restart.', r.pass_id);
    }
    return rows.map((r) => r.pass_id);
  }

  /** Keep one result's score from one scorer (replacing an earlier one). */
  setScore(passId: string, score: ExperimentScore): void {
    this.db.prepare(`INSERT INTO experiment_scores (cell_id, scorer_id, pass_id, value, reason, cites_json, run_id, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cell_id, scorer_id) DO UPDATE SET value = excluded.value, reason = excluded.reason, cites_json = excluded.cites_json, run_id = excluded.run_id, error = excluded.error`)
      .run(score.cellId, score.scorerId, passId, score.value ?? null, score.reason ? score.reason.slice(0, 400) : null, score.cites ? JSON.stringify(score.cites) : null, score.runId ?? null, score.error ? score.error.slice(0, 300) : null);
  }

  /** A result's scores are dropped when it is run again. */
  clearScores(cellId: string): void {
    this.db.prepare('DELETE FROM experiment_scores WHERE cell_id = ?').run(cellId);
  }

  /** A pass's stored scores (judges'; `found` scorers are counted from the outputs). */
  scores(passId: string): ExperimentScore[] {
    const rows = this.db.prepare('SELECT * FROM experiment_scores WHERE pass_id = ?').all(passId) as Array<Record<string, unknown>>;
    return rows.map((r) => {
      let cites: string[] | undefined;
      try { const v = r.cites_json ? JSON.parse(String(r.cites_json)) as unknown : undefined; if (Array.isArray(v)) cites = v.map(String); } catch { /* none */ }
      return {
        cellId: String(r.cell_id), scorerId: String(r.scorer_id),
        ...(r.value !== null && r.value !== undefined ? { value: Number(r.value) } : {}),
        ...(r.reason ? { reason: String(r.reason) } : {}), ...(cites ? { cites } : {}),
        ...(r.run_id ? { runId: String(r.run_id) } : {}), ...(r.error ? { error: String(r.error) } : {}),
      };
    });
  }

  finishPass(passId: string, note?: string): void {
    this.db.prepare('UPDATE experiment_passes SET finished_at = ?, note = ? WHERE id = ?').run(new Date().toISOString(), note ? note.slice(0, 300) : null, passId);
  }
}

/** Where a pass stands, counted from its cells. Pure. */
export function passProgress(cells: readonly Pick<ExperimentCell, 'status' | 'costUsd'>[]): { total: number; done: number; running: number; todo: number; invalid: number; failed: number; stopped: number; costUsd: number; over: boolean } {
  const n = (s: ExperimentCellStatus) => cells.filter((c) => c.status === s).length;
  const todo = n('todo');
  const running = n('running');
  return { total: cells.length, done: n('done'), running, todo, invalid: n('invalid'), failed: n('failed'), stopped: n('stopped'), costUsd: cells.reduce((s, c) => s + (c.costUsd ?? 0), 0), over: todo + running === 0 };
}
