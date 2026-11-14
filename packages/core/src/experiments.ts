/**
 * Experiments (ADR-0078): a frozen set of cases run through one agent under
 * named conditions, with repeats, so what changes the agent's output can be
 * measured rather than argued.
 *
 * - A **case** is a set of items, copied once (from a notebook's options, or
 *   pasted) and never changed after.
 * - A **factor** is one thing varied ("Build", "Preferences"); each of its
 *   **levels** says what that means for a run: an agent version, its
 *   instructions, a provider or model, or inputs. **Conditions** are every
 *   combination of one level per factor.
 * - A **pass** is one run-through of the grid: a **cell** for every case,
 *   condition and repeat, each holding the run it made and the ranking that
 *   run returned. A pass is kept cell by cell, so a restart loses nothing.
 *
 * What the cells measured is computed in experiment-measures.ts. This file
 * stores; it runs nothing.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { openStoreDb } from './sqlite-open.js';
import { chmod600Safe } from './fs-utils.js';
import type { MeasuredCondition } from './experiment-measures.js';

/** What a case's output is. `ranking`: the ids of its items, best first. */
export type ExperimentKind = 'ranking';

export const EXPERIMENT_MAX_FACTORS = 3;
export const EXPERIMENT_MAX_LEVELS = 4;
export const EXPERIMENT_MAX_CONDITIONS = 16;
export const EXPERIMENT_MAX_REPEATS = 5;
export const EXPERIMENT_MAX_CASES = 5;
export const EXPERIMENT_MAX_ITEMS = 60;
/** Runs one pass may make, at most (cases × conditions × repeats). */
export const EXPERIMENT_MAX_RUNS = 60;
export const EXPERIMENT_MAX_SCORERS = 3;

/** One thing in a case: what is ranked. Facts are short strings by label. */
export interface ExperimentItem { id: string; title: string; facts: Record<string, string> }
export interface ExperimentCase { id: string; name: string; items: ExperimentItem[] }

/** What one level of a factor means for a run. */
export interface ExperimentLevel {
  id: string;
  name: string;
  /** Run this version of the task agent (its current one otherwise). */
  version?: number;
  /** Passed to the task as its INSTRUCTIONS input. */
  instructions?: string;
  provider?: string;
  model?: string;
  /** Other inputs to the task (PREFERENCES, say). */
  inputs?: Record<string, string>;
}
export interface ExperimentFactor { id: string; name: string; levels: ExperimentLevel[] }
export type ExperimentCondition = MeasuredCondition;

/**
 * How each result is scored, beside how the results compare (ADR-0078).
 * - `top`: counted in code. The share of the named items that are in the
 *   result's top K ("these three should be near the top"); with `avoid`,
 *   the share kept out of it ("these two should stay low").
 * - `judge`: a model reads one result against a rubric written in plain
 *   words and gives 0 to 1 with a reason. It sees the items, the person's
 *   preferences and the ranking; never which build made it.
 */
export type ExperimentScorer =
  | { id: string; name: string; kind: 'top'; items: string[]; k: number; /** Score the share kept OUT of the top K (things that should stay low). */ avoid?: boolean }
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
  /** The agent every cell runs. */
  task: { agentId: string };
  factors: ExperimentFactor[];
  repeats: number;
  topK: number;
  /** How each result is scored (none: results are only compared with each other). */
  scorers: ExperimentScorer[];
  /** The notebook its cases were copied from, when they were. */
  from?: { notebookId: string; title: string };
  /** The agent run whose results its cases were taken from, when they were ("Job search, run of Nov 13"). */
  fromRun?: { runId: string; title: string };
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ExperimentPass { id: string; experimentId: string; startedAt: string; finishedAt?: string; /** The task agent's current version when it started. */ taskVersion?: number; note?: string }

export interface ExperimentCell {
  id: string;
  passId: string;
  experimentId: string;
  caseId: string;
  conditionId: string;
  repeat: number;
  status: ExperimentCellStatus;
  runId?: string;
  agentVersion?: number;
  usedProvider?: string;
  usedModel?: string;
  /** The ids of the case's items, best first (a `ranking` experiment). */
  ranking?: string[];
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
  factors: unknown;
  cases: unknown;
  repeats?: number;
  topK?: number;
  scorers?: unknown;
  from?: { notebookId: string; title: string };
  fromRun?: { runId: string; title: string };
}

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const slug = (s: string, fallback: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
/** A key no other in `taken` has (adds -2, -3…), and records it. */
function unique(want: string, taken: Set<string>): string {
  let id = want;
  for (let n = 2; taken.has(id); n++) id = `${want}-${String(n)}`;
  taken.add(id);
  return id;
}

/**
 * Factors as an experiment keeps them: up to three, each with two to four
 * named levels; a factor with fewer than two levels varies nothing and is
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
      const inputs: Record<string, string> = {};
      if (lr.inputs && typeof lr.inputs === 'object' && !Array.isArray(lr.inputs)) {
        for (const [k, v] of Object.entries(lr.inputs as Record<string, unknown>).slice(0, 8)) {
          const key = k.replace(/[^A-Za-z0-9_]/g, '').toUpperCase().slice(0, 40);
          const val = text(v, 8000);
          if (key && val) inputs[key] = val;
        }
      }
      const version = Number(lr.version);
      const instructions = text(lr.instructions, 8000);
      const provider = line(lr.provider, 40);
      const model = line(lr.model, 80);
      levels.push({
        id: unique(slug(typeof lr.id === 'string' && lr.id ? lr.id : lname, 'level'), levelIds), name: lname,
        ...(Number.isInteger(version) && version > 0 ? { version } : {}),
        ...(instructions ? { instructions } : {}),
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

/**
 * Cases as kept: up to five, each with 2 to 60 items; an item has an id no
 * other in its case has, a title, and short facts by label. Pure.
 */
export function cleanCases(raw: unknown): ExperimentCase[] {
  const out: ExperimentCase[] = [];
  const ids = new Set<string>();
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const items: ExperimentItem[] = [];
    const itemIds = new Set<string>();
    for (const it of Array.isArray(r.items) ? r.items : []) {
      if (!it || typeof it !== 'object') continue;
      const ir = it as Record<string, unknown>;
      const title = line(ir.title, 200);
      if (!title) continue;
      const facts: Record<string, string> = {};
      if (ir.facts && typeof ir.facts === 'object' && !Array.isArray(ir.facts)) {
        for (const [k, v] of Object.entries(ir.facts as Record<string, unknown>).slice(0, 20)) {
          const label = line(k, 60);
          const val = line(typeof v === 'number' || typeof v === 'boolean' ? String(v) : v, 400);
          if (label && val) facts[label] = val;
        }
      }
      items.push({ id: unique(slug(typeof ir.id === 'string' && ir.id ? ir.id : title, 'item').slice(0, 24), itemIds), title, facts });
      if (items.length === EXPERIMENT_MAX_ITEMS) break;
    }
    if (items.length < 2) continue;
    const name = line(r.name, 80) || `Set ${String(out.length + 1)}`;
    out.push({ id: unique(slug(typeof r.id === 'string' && r.id ? r.id : name, 'set'), ids), name, items });
    if (out.length === EXPERIMENT_MAX_CASES) break;
  }
  return out;
}

/**
 * A run's answer as a ranking of a case's items, or why it can't be used:
 * every id must be one of the case's, none twice, none left out. Pure.
 */
export function cleanRanking(raw: unknown, items: readonly Pick<ExperimentItem, 'id'>[]): { ranking: string[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'It gave no list of ids.' };
  const known = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  for (const v of raw) {
    const id = typeof v === 'string' ? v.trim() : '';
    if (!known.has(id)) return { error: `"${String(v).slice(0, 40)}" is not one of the items' ids.` };
    if (seen.has(id)) return { error: `"${id}" is ranked twice.` };
    seen.add(id);
  }
  const missing = items.filter((i) => !seen.has(i.id)).map((i) => i.id);
  if (missing.length) return { error: `It left out ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${String(missing.length - 5)} more` : ''}. Rank every item.` };
  return { ranking: [...seen] };
}

/**
 * Scorers as kept: up to three. A `top` scorer keeps only ids that are items
 * of a case and needs at least one; a `judge` needs a rubric. Pure.
 */
export function cleanScorers(raw: unknown, cases: readonly ExperimentCase[] = [], topK = 5): ExperimentScorer[] {
  const out: ExperimentScorer[] = [];
  const ids = new Set<string>();
  const known = new Set(cases.flatMap((c) => c.items.map((i) => i.id)));
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const name = line(r.name, 60);
    if (r.kind === 'top') {
      const items = [...new Set((Array.isArray(r.items) ? r.items : []).map((i) => (typeof i === 'string' ? i : '')).filter((i) => (cases.length ? known.has(i) : !!i)))].slice(0, 20);
      if (!items.length) continue;
      const k = int(r.k, 1, 60, topK);
      const avoid = r.avoid === true;
      out.push({ id: unique(slug(typeof r.id === 'string' && r.id ? r.id : name || (avoid ? 'out-of-the-top' : 'in-the-top'), 'top'), ids), name: name || `${avoid ? 'Out of' : 'In'} the top ${String(k)}`, kind: 'top', items, k, ...(avoid ? { avoid } : {}) });
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

/** A `top` scorer's score for one ranking: the share of its items in the first K (or, with `avoid`, kept out of it). Pure. */
export function topScore(scorer: Extract<ExperimentScorer, { kind: 'top' }>, ranking: readonly string[]): number {
  const top = new Set(ranking.slice(0, scorer.k));
  const mine = scorer.items.filter((id) => ranking.includes(id));
  if (!mine.length) return 0;
  const inTop = mine.filter((id) => top.has(id)).length;
  return (scorer.avoid ? mine.length - inTop : inTop) / mine.length;
}

/**
 * A judge's answer as a score, or why it can't be used: a number from 0 to
 * 1, a reason, and at least one item it points to, each one of the case's
 * (a judge that cites nothing, or something not in the result, is not
 * taken on trust). Pure.
 */
export function cleanJudgement(raw: unknown, items: readonly Pick<ExperimentItem, 'id'>[]): { value: number; reason: string; cites: string[] } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'It gave no score object.' };
  const r = raw as Record<string, unknown>;
  const value = typeof r.score === 'number' ? r.score : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > 1) return { error: 'Its score is not a number from 0 to 1.' };
  const reason = line(r.reason, 400);
  if (!reason) return { error: 'It gave no reason.' };
  const known = new Set(items.map((i) => i.id));
  const cites = [...new Set((Array.isArray(r.cites) ? r.cites : []).map((c) => (typeof c === 'string' ? c.trim() : '')))].filter(Boolean);
  if (!cites.length) return { error: 'It cites no item. Name the ids of the items its reason rests on.' };
  const unknown = cites.find((c) => !known.has(c));
  if (unknown) return { error: `It cites "${unknown.slice(0, 40)}", which is not one of the items' ids.` };
  return { value, reason, cites: cites.slice(0, 10) };
}

/** How many runs one pass makes: one of the task per case, condition and repeat, and one more for each judge. */
export function experimentRunCount(e: Pick<Experiment, 'factors' | 'repeats'> & { scorers?: readonly ExperimentScorer[] }, cases: number): number {
  const judges = (e.scorers ?? []).filter((s) => s.kind === 'judge').length;
  return cases * experimentConditions(e.factors).length * e.repeats * (1 + judges);
}

/** One scorer's scores for one condition, over that condition's results. */
export interface ScoreSummary { scorerId: string; conditionId: string; mean: number; min: number; max: number; n: number }

/**
 * Each scorer's average for each condition (with the lowest and highest
 * seen): `top` scorers counted here from the rankings, judges from their
 * stored scores. Pure.
 */
export function scoreSummaries(scorers: readonly ExperimentScorer[], cells: readonly Pick<ExperimentCell, 'id' | 'conditionId' | 'status' | 'ranking'>[], scores: readonly ExperimentScore[]): ScoreSummary[] {
  const out: ScoreSummary[] = [];
  const done = cells.filter((c) => c.status === 'done' && c.ranking);
  for (const s of scorers) {
    for (const conditionId of [...new Set(done.map((c) => c.conditionId))]) {
      const mine = done.filter((c) => c.conditionId === conditionId);
      const values = s.kind === 'top'
        ? mine.map((c) => topScore(s, c.ranking!))
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        question TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'ranking',
        task_json TEXT NOT NULL,
        factors_json TEXT NOT NULL DEFAULT '[]',
        repeats INTEGER NOT NULL DEFAULT 3,
        top_k INTEGER NOT NULL DEFAULT 5,
        from_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS experiment_cases (
        experiment_id TEXT NOT NULL,
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        items_json TEXT NOT NULL,
        PRIMARY KEY (experiment_id, id)
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
        case_id TEXT NOT NULL,
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
    for (const [table, col] of [['experiments', "scorers_json TEXT NOT NULL DEFAULT '[]'"]] as const) {
      try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already there */ }
    }
  }

  private row(r: Record<string, unknown>): Experiment {
    const json = <T>(v: unknown, d: T): T => { try { return typeof v === 'string' ? JSON.parse(v) as T : d; } catch { return d; } };
    const from = json<Experiment['from'] | undefined>(r.from_json, undefined);
    return {
      id: String(r.id), name: String(r.name), question: String(r.question ?? ''), kind: 'ranking',
      task: json(r.task_json, { agentId: '' }), factors: cleanFactors(json(r.factors_json, [])),
      repeats: Number(r.repeats), topK: Number(r.top_k),
      scorers: cleanScorers(json(r.scorers_json, []), [], Number(r.top_k)),
      ...(from?.notebookId ? { from } : {}),
      ...((): { fromRun?: Experiment['fromRun'] } => { const fr = json<{ runId?: string; title?: string } | undefined>(r.from_json, undefined); return fr?.runId ? { fromRun: { runId: String(fr.runId), title: String(fr.title ?? '') } } : {}; })(),
      createdAt: String(r.created_at), updatedAt: String(r.updated_at),
      ...(r.archived_at ? { archivedAt: String(r.archived_at) } : {}),
    };
  }

  /**
   * A new experiment with its cases frozen. Refuses one with nothing to
   * rank, no task, or a grid larger than a pass may run.
   */
  create(input: NewExperiment): Experiment {
    const name = line(input.name, 120);
    if (!name) throw new Error('Give the experiment a name.');
    const agentId = line(input.task?.agentId, 120);
    if (!agentId) throw new Error('Choose the agent it runs.');
    const cases = cleanCases(input.cases);
    if (!cases.length) throw new Error('It needs a set of at least two items to rank.');
    const factors = cleanFactors(input.factors);
    const repeats = int(input.repeats, 1, EXPERIMENT_MAX_REPEATS, 3);
    const conditions = experimentConditions(factors).length;
    if (conditions > EXPERIMENT_MAX_CONDITIONS) throw new Error(`That is ${String(conditions)} conditions; ${String(EXPERIMENT_MAX_CONDITIONS)} at most. Use fewer factors or levels.`);
    const smallest = Math.min(...cases.map((c) => c.items.length));
    const topK = int(input.topK, 1, Math.max(1, smallest - 1), Math.min(5, Math.max(1, smallest - 1)));
    const scorers = cleanScorers(input.scorers, cases, topK);
    const judges = scorers.filter((x) => x.kind === 'judge').length;
    const runs = cases.length * conditions * repeats * (1 + judges);
    if (runs > EXPERIMENT_MAX_RUNS) throw new Error(`That is ${String(runs)} runs a pass${judges ? ' (each judge reads every result)' : ''}; ${String(EXPERIMENT_MAX_RUNS)} at most. Use fewer repeats, levels, sets or judges.`);
    let id = slug(name, 'experiment');
    for (let n = 2; this.get(id); n++) id = `${slug(name, 'experiment').slice(0, 36)}-${String(n)}`;
    const now = new Date().toISOString();
    const from = input.from?.notebookId ? { notebookId: line(input.from.notebookId, 120), title: line(input.from.title, 200) }
      : input.fromRun?.runId ? { runId: line(input.fromRun.runId, 120), title: line(input.fromRun.title, 200) } : undefined;
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO experiments (id, name, question, kind, task_json, factors_json, repeats, top_k, from_json, scorers_json, created_at, updated_at)
        VALUES (?, ?, ?, 'ranking', ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, text(input.question, 1000), JSON.stringify({ agentId }), JSON.stringify(factors), repeats, topK, from ? JSON.stringify(from) : null, JSON.stringify(scorers), now, now);
      const ins = this.db.prepare('INSERT INTO experiment_cases (experiment_id, id, position, name, items_json) VALUES (?, ?, ?, ?, ?)');
      cases.forEach((c, i) => ins.run(id, c.id, i, c.name, JSON.stringify(c.items)));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.get(id)!;
  }

  get(id: string): Experiment | undefined {
    const r = this.db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }

  /** Newest first; archived ones only when asked. */
  list(opts: { archived?: boolean } = {}): Experiment[] {
    const rows = this.db.prepare(`SELECT * FROM experiments ${opts.archived ? '' : 'WHERE archived_at IS NULL'} ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.row(r));
  }

  /** Experiments whose cases were copied from this notebook. */
  fromNotebook(notebookId: string): Experiment[] {
    return this.list().filter((e) => e.from?.notebookId === notebookId);
  }

  /** Its frozen cases, in order. */
  cases(experimentId: string): ExperimentCase[] {
    const rows = this.db.prepare('SELECT * FROM experiment_cases WHERE experiment_id = ? ORDER BY position').all(experimentId) as Array<Record<string, unknown>>;
    return rows.map((r) => { let items: ExperimentItem[] = []; try { items = JSON.parse(String(r.items_json)) as ExperimentItem[]; } catch { /* none */ } return { id: String(r.id), name: String(r.name), items }; });
  }

  /** Its name and question (what it runs and its cases never change: make a new experiment for that). */
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
    let ranking: string[] | undefined;
    try { const v = r.ranking_json ? JSON.parse(String(r.ranking_json)) as unknown : undefined; if (Array.isArray(v)) ranking = v.map(String); } catch { /* none */ }
    const opt = <K extends string>(k: K, v: unknown) => (v === null || v === undefined || v === '' ? {} : { [k]: v } as Record<K, never>);
    return {
      id: String(r.id), passId: String(r.pass_id), experimentId: String(r.experiment_id), caseId: String(r.case_id), conditionId: String(r.condition_id),
      repeat: Number(r.repeat), status: String(r.status) as ExperimentCellStatus,
      ...opt('runId', r.run_id), ...(r.agent_version !== null && r.agent_version !== undefined ? { agentVersion: Number(r.agent_version) } : {}),
      ...opt('usedProvider', r.used_provider), ...opt('usedModel', r.used_model),
      ...(ranking ? { ranking } : {}), ...opt('error', r.error),
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

  /** A new pass: a cell to do for every case, condition and repeat. */
  startPass(experimentId: string, opts: { taskVersion?: number; id?: string } = {}): ExperimentPass {
    const e = this.get(experimentId);
    if (!e) throw new Error('No such experiment.');
    const cases = this.cases(experimentId);
    const conditions = experimentConditions(e.factors);
    const now = new Date().toISOString();
    const passId = opts.id ?? `${experimentId}-${now.replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT INTO experiment_passes (id, experiment_id, started_at, task_version) VALUES (?, ?, ?, ?)').run(passId, experimentId, now, opts.taskVersion ?? null);
      const ins = this.db.prepare("INSERT INTO experiment_cells (id, pass_id, experiment_id, case_id, condition_id, repeat, status) VALUES (?, ?, ?, ?, ?, ?, 'todo')");
      // Repeat by repeat, so a pass stopped early has every condition run about as often.
      for (let r = 1; r <= e.repeats; r++) for (const c of cases) for (const cd of conditions) ins.run(`${passId}|${c.id}|${cd.id}|${String(r)}`, passId, experimentId, c.id, cd.id, r);
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

  /**
   * Take the next cell to do, marked running. Undefined when none is left.
   * One statement, so two workers never take the same cell.
   */
  claimCell(passId: string): ExperimentCell | undefined {
    const now = new Date().toISOString();
    const r = this.db.prepare(`UPDATE experiment_cells SET status = 'running', started_at = ?
      WHERE id = (SELECT id FROM experiment_cells WHERE pass_id = ? AND status = 'todo' ORDER BY rowid LIMIT 1) AND status = 'todo'
      RETURNING *`).get(now, passId) as Record<string, unknown> | undefined;
    return r ? this.cell(r) : undefined;
  }

  /** How a cell ended (or which run it is making). */
  updateCell(cellId: string, patch: Partial<Pick<ExperimentCell, 'status' | 'runId' | 'agentVersion' | 'usedProvider' | 'usedModel' | 'ranking' | 'error' | 'costUsd'>>): void {
    const sets: string[] = [];
    const vals: Array<string | number | null> = [];
    const set = (col: string, v: string | number | null | undefined) => { if (v !== undefined) { sets.push(`${col} = ?`); vals.push(v); } };
    set('status', patch.status);
    set('run_id', patch.runId);
    set('agent_version', patch.agentVersion);
    set('used_provider', patch.usedProvider);
    set('used_model', patch.usedModel);
    set('ranking_json', patch.ranking ? JSON.stringify(patch.ranking) : undefined);
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

  /**
   * Put a pass's unfinished cells back to do: ones stopped, ones that failed
   * or came back invalid when `retry`, and ones left running by a restart.
   * Returns how many.
   */
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

  /** A pass's stored scores (judges'; `top` scorers are counted from the rankings). */
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
