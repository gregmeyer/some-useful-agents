/**
 * A comparison's scorecard, worked out in code (the evaluate-software skill):
 * a notebook's weighted number fields are its scoring criteria, each option
 * scores 0–4 on each, and a missing score is unknown, never zero. The
 * notebook's checks are its gates: passed, failed or not known yet.
 *
 * - lower bound = Σ weight × score / 4 over the known scores (out of 100);
 * - upper bound = lower + the weight of the unknown ones;
 * - coverage = the weight that is known.
 *
 * A failed gate disqualifies. An unknown gate, or coverage under the minimum,
 * leaves an option provisional: it is ranked, never a definitive winner.
 * Pure; imports types only (notebooks.ts calls it).
 */
import type { NotebookField, NotebookFieldValue } from './notebooks.js';

/** A score is 0–4. */
export const SCORE_MAX = 4;
/** Below this much known weight, an option isn't a definitive winner. */
export const DEFAULT_MIN_COVERAGE = 80;
/** A point goes on the 2x2 only when at least this much of that axis's weight is known. */
export const AXIS_MIN_COVERAGE = 50;
/** Criteria at least this heavy are tried at half and one and a half times their weight. */
const SENSITIVE_WEIGHT = 15;

export type ScoreAxis = 'suitability' | 'feasibility';
export type GateStatus = 'pass' | 'fail' | 'unknown';
export type ScoreStatus = 'ranked' | 'provisional' | 'disqualified';

export interface ScoreCriterion { key: string; label: string; weight: number; axis?: ScoreAxis; anchors?: string[] }

export interface ScoreRow {
  id: string;
  title: string;
  /** Per criterion, in the criteria's order: the score, or null when unknown. */
  scores: Array<number | null>;
  gates: Array<{ check: string; status: GateStatus }>;
  lower: number;
  upper: number;
  /** Known weight, out of 100. */
  coverage: number;
  status: ScoreStatus;
  /** Why it's provisional or out, in a few words. */
  why?: string;
  /** 1 = first; none when disqualified. */
  rank?: number;
  /** 0–100 on each axis; left out when too little of it is known. */
  suitability?: number;
  feasibility?: number;
}

export interface ScoreReversal { weights: string; leader: string; was: string }

export interface Scorecard {
  criteria: ScoreCriterion[];
  minCoverage: number;
  rows: ScoreRow[];
  /** The option ranked first and not provisional; none when no option is definitive. */
  leader?: string;
  /** Plausible other weights that put a different option first. */
  reversals: ScoreReversal[];
}

export interface ScoreOption {
  id: string;
  title: string;
  data?: Record<string, NotebookFieldValue>;
  checked?: readonly string[];
  failedChecks?: Record<string, unknown>;
  ruledOut?: unknown;
}

/** A notebook's scoring criteria: its number fields that carry a weight. */
export function scoreCriteria(fields: readonly NotebookField[]): ScoreCriterion[] {
  return fields.filter((f) => f.type === 'number' && typeof f.weight === 'number' && f.weight > 0)
    .map((f) => ({ key: f.key, label: f.label, weight: f.weight!, ...(f.axis ? { axis: f.axis } : {}), ...(f.anchors?.length ? { anchors: [...f.anchors] } : {}) }));
}

/** A score as given: a number 0–4, else unknown. 0 is a score. */
export function scoreOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= SCORE_MAX ? n : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function bounds(scores: Array<number | null>, weights: readonly number[]) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let lower = 0; let unknown = 0;
  scores.forEach((s, i) => { if (s === null) unknown += weights[i]; else lower += weights[i] * s / SCORE_MAX; });
  // Out of 100 whatever the weights add to.
  return { lower: (lower / total) * 100, upper: ((lower + unknown) / total) * 100, coverage: ((total - unknown) / total) * 100 };
}

function axisPoint(scores: Array<number | null>, criteria: readonly ScoreCriterion[], axis: ScoreAxis): number | undefined {
  let all = 0; let known = 0; let sum = 0;
  criteria.forEach((c, i) => {
    if (c.axis !== axis) return;
    all += c.weight;
    const s = scores[i];
    if (s !== null) { known += c.weight; sum += c.weight * s / SCORE_MAX; }
  });
  if (!all || (known / all) * 100 < AXIS_MIN_COVERAGE) return undefined;
  return round1((sum / known) * 100);
}

/** Ranked first by lower bound, then upper bound, then title; the disqualified aren't ranked. */
function order(rows: ReadonlyArray<{ id: string; title: string; lower: number; upper: number; out: boolean }>): string[] {
  return rows.filter((r) => !r.out).sort((a, b) => b.lower - a.lower || b.upper - a.upper || a.title.localeCompare(b.title)).map((r) => r.id);
}

export function scorecard(fields: readonly NotebookField[], checks: readonly string[], options: readonly ScoreOption[], opts: { minCoverage?: number } = {}): Scorecard {
  const criteria = scoreCriteria(fields);
  const minCoverage = opts.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const weights = criteria.map((c) => c.weight);
  const base = options.map((o) => {
    const scores = criteria.map((c) => scoreOf(o.data?.[c.key]));
    const gates = checks.map((check): { check: string; status: GateStatus } => ({
      check,
      status: o.failedChecks && check in o.failedChecks ? 'fail' : o.checked?.includes(check) ? 'pass' : 'unknown',
    }));
    return { o, scores, gates, out: !!o.ruledOut || gates.some((g) => g.status === 'fail') };
  });
  const scored = base.map((b) => ({ ...b, ...bounds(b.scores, weights) }));
  const ranked = order(scored.map((s) => ({ id: s.o.id, title: s.o.title, lower: s.lower, upper: s.upper, out: s.out })));
  const rows: ScoreRow[] = scored.map((s) => {
    const unknownGates = s.gates.filter((g) => g.status === 'unknown').length;
    const status: ScoreStatus = s.out ? 'disqualified' : unknownGates || s.coverage < minCoverage ? 'provisional' : 'ranked';
    const failed = s.gates.find((g) => g.status === 'fail');
    const why = s.out ? (failed ? `fails: ${failed.check}` : 'ruled out')
      : status === 'provisional' ? [unknownGates ? `${String(unknownGates)} gate${unknownGates === 1 ? '' : 's'} unknown` : '', s.coverage < minCoverage ? `${String(Math.round(s.coverage))}% known` : ''].filter(Boolean).join(' · ')
      : undefined;
    const rank = ranked.indexOf(s.o.id);
    const suitability = axisPoint(s.scores, criteria, 'suitability');
    const feasibility = axisPoint(s.scores, criteria, 'feasibility');
    return {
      id: s.o.id, title: s.o.title, scores: s.scores, gates: s.gates,
      lower: round1(s.lower), upper: round1(s.upper), coverage: round1(s.coverage), status,
      ...(why ? { why } : {}), ...(rank >= 0 ? { rank: rank + 1 } : {}),
      ...(suitability !== undefined ? { suitability } : {}), ...(feasibility !== undefined ? { feasibility } : {}),
    };
  });
  rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const first = rows[0];
  const leader = first && first.rank === 1 && first.status === 'ranked' ? first.id : undefined;
  return { criteria, minCoverage, rows, ...(leader ? { leader } : {}), reversals: reversals(criteria, scored, ranked[0]) };
}

/**
 * Plausible other weights (equal, and each heavy criterion at half and one and
 * a half times): the ones that put a different option first.
 */
function reversals(criteria: readonly ScoreCriterion[], scored: ReadonlyArray<{ o: ScoreOption; scores: Array<number | null>; out: boolean }>, was: string | undefined): ScoreReversal[] {
  if (!was || criteria.length < 2) return [];
  const sets: Array<{ name: string; weights: number[] }> = [{ name: 'Equal weights', weights: criteria.map(() => 1) }];
  criteria.forEach((c, i) => {
    if (c.weight < SENSITIVE_WEIGHT) return;
    for (const [f, word] of [[0.5, 'half'], [1.5, '×1.5']] as const) {
      sets.push({ name: `${c.label} at ${word}`, weights: criteria.map((x, j) => (j === i ? x.weight * f : x.weight)) });
    }
  });
  const out: ScoreReversal[] = [];
  for (const s of sets) {
    const lead = order(scored.map((r) => ({ id: r.o.id, title: r.o.title, out: r.out, ...bounds(r.scores, s.weights) })))[0];
    if (lead && lead !== was) out.push({ weights: s.name, leader: lead, was });
  }
  return out;
}
