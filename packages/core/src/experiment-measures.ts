/**
 * What an experiment measured (ADR-0078), computed in code from the rankings
 * its runs returned. Nothing here asks a model: the numbers a verdict rests
 * on are counted, so a write-up can't invent them.
 *
 * A ranking is the ids of a case's items, best first. Two rankings of the
 * same items are compared two ways: how many of the top K they share, and
 * how many places an item moves on average. Repeats of one condition give
 * the run-to-run variation (the floor); conditions that differ in one factor
 * alone give that factor's effect. An effect is "beyond" the variation only
 * when it is larger than the largest difference seen between two repeats of
 * the same condition.
 */

/** How two rankings of the same items differ. */
export interface RankDifference {
  /** How many of the top K are in both (0..K). */
  overlap: number;
  /** Places an item moved, on average, over the items both ranked. */
  shift: number;
}

/** How many of each ranking's first `k` are in the other's first `k`. */
export function topKOverlap(a: readonly string[], b: readonly string[], k: number): number {
  const top = new Set(a.slice(0, k));
  return b.slice(0, k).filter((id) => top.has(id)).length;
}

/** Places an item moved, on average, over the items in both rankings (0 when they agree or share none). */
export function rankShift(a: readonly string[], b: readonly string[]): number {
  const at = new Map(b.map((id, i) => [id, i]));
  let sum = 0;
  let n = 0;
  a.forEach((id, i) => { const j = at.get(id); if (j !== undefined) { sum += Math.abs(i - j); n++; } });
  return n ? sum / n : 0;
}

export function rankDifference(a: readonly string[], b: readonly string[], k: number): RankDifference {
  return { overlap: topKOverlap(a, b, k), shift: rankShift(a, b) };
}

/** One run's ranking, placed in the grid. */
export interface MeasuredCell { caseId: string; conditionId: string; repeat: number; ranking: readonly string[] }
/** A condition: the level it takes for each factor. */
export interface MeasuredCondition { id: string; name: string; levels: Readonly<Record<string, string>> }
export interface MeasuredFactor { id: string; name: string }

/** An average over pairs of rankings, with the extremes seen. */
export interface MeasuredSpread extends RankDifference {
  /** Pairs of rankings it is the average of. */
  pairs: number;
  /** The fewest of the top K any pair shared. */
  overlapMin: number;
  /** The most places any pair moved an item, on average. */
  shiftMax: number;
}

export interface FactorEffect extends MeasuredSpread {
  factorId: string;
  name: string;
  /** Larger than anything seen between repeats of one condition. Undefined when there were no repeats to compare. */
  beyondNoise?: boolean;
  /**
   * Each pair of conditions it is the average of: the same change made with
   * everything else held at one setting. They can differ a lot (a factor
   * that matters under one build and not under another).
   */
  parts: Array<RankDifference & { from: string; to: string }>;
}

/** One item's place under each condition (1 = first), averaged over repeats. */
export interface ItemRanks { id: string; ranks: Record<string, number>; /** Its best place less its worst. */ spread: number }

export interface ExperimentVerdict {
  topK: number;
  /** What was run: cases, conditions, the fewest repeats any condition has, rankings counted. */
  n: { cases: number; conditions: number; repeats: number; rankings: number };
  /** Between repeats of the same condition. Undefined with fewer than two repeats anywhere. */
  noise?: MeasuredSpread;
  /** One per factor that has two conditions differing in it alone, largest shift first. */
  effects: FactorEffect[];
  /** Each condition against the first one (the baseline), over cases. */
  conditions: Array<{ id: string; name: string; vsBaseline?: MeasuredSpread; repeats: number }>;
  /** Items by how far their place moves across conditions, furthest first (the first case's items when there are several cases). */
  items: ItemRanks[];
}

function spread(diffs: readonly RankDifference[]): MeasuredSpread | undefined {
  if (!diffs.length) return undefined;
  const mean = (f: (d: RankDifference) => number) => diffs.reduce((s, d) => s + f(d), 0) / diffs.length;
  return {
    overlap: mean((d) => d.overlap), shift: mean((d) => d.shift), pairs: diffs.length,
    overlapMin: Math.min(...diffs.map((d) => d.overlap)), shiftMax: Math.max(...diffs.map((d) => d.shift)),
  };
}

/** Every pair within one list of rankings. */
function within(rs: ReadonlyArray<readonly string[]>, k: number): RankDifference[] {
  const out: RankDifference[] = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) out.push(rankDifference(rs[i], rs[j], k));
  return out;
}

/** Every pairing of a ranking from one list with one from the other. */
function between(a: ReadonlyArray<readonly string[]>, b: ReadonlyArray<readonly string[]>, k: number): RankDifference[] {
  return a.flatMap((x) => b.map((y) => rankDifference(x, y, k)));
}

/**
 * The verdict of one pass: the run-to-run variation, each factor's effect,
 * each condition against the baseline, and the items that moved most. Pure.
 * Cells without a ranking (failed, invalid, not run) are simply not passed.
 */
export function experimentVerdict(input: { factors: readonly MeasuredFactor[]; conditions: readonly MeasuredCondition[]; cells: readonly MeasuredCell[]; topK: number }): ExperimentVerdict {
  const { factors, conditions, cells, topK } = input;
  const cases = [...new Set(cells.map((c) => c.caseId))];
  const of = (caseId: string, conditionId: string) => cells.filter((c) => c.caseId === caseId && c.conditionId === conditionId).sort((a, b) => a.repeat - b.repeat).map((c) => c.ranking);

  const noise = spread(cases.flatMap((cs) => conditions.flatMap((cd) => within(of(cs, cd.id), topK))));

  const effects: FactorEffect[] = [];
  for (const f of factors) {
    const diffs: RankDifference[] = [];
    const parts: FactorEffect['parts'] = [];
    for (let i = 0; i < conditions.length; i++) {
      for (let j = i + 1; j < conditions.length; j++) {
        const a = conditions[i];
        const b = conditions[j];
        // The pair tests this factor only when it is the one thing they differ in.
        const differ = factors.filter((x) => a.levels[x.id] !== b.levels[x.id]).map((x) => x.id);
        if (differ.length !== 1 || differ[0] !== f.id) continue;
        const pair = cases.flatMap((cs) => between(of(cs, a.id), of(cs, b.id), topK));
        diffs.push(...pair);
        const ps = spread(pair);
        if (ps) parts.push({ from: a.id, to: b.id, overlap: ps.overlap, shift: ps.shift });
      }
    }
    const s = spread(diffs);
    if (!s) continue;
    effects.push({ factorId: f.id, name: f.name, ...s, parts, ...(noise ? { beyondNoise: s.shift > noise.shiftMax || s.overlap < noise.overlapMin } : {}) });
  }
  effects.sort((a, b) => b.shift - a.shift || a.overlap - b.overlap);

  const base = conditions[0];
  const perCondition = conditions.map((cd) => {
    const repeats = cases.length ? Math.min(...cases.map((cs) => of(cs, cd.id).length)) : 0;
    const vs = base && cd.id !== base.id ? spread(cases.flatMap((cs) => between(of(cs, base.id), of(cs, cd.id), topK))) : undefined;
    return { id: cd.id, name: cd.name, repeats, ...(vs ? { vsBaseline: vs } : {}) };
  });

  // Where each item lands under each condition, for the first case (a table reads one set at a time).
  const items: ItemRanks[] = [];
  const first = cases[0];
  if (first !== undefined) {
    const ids = [...new Set(cells.filter((c) => c.caseId === first).flatMap((c) => c.ranking))];
    for (const id of ids) {
      const ranks: Record<string, number> = {};
      for (const cd of conditions) {
        const places = of(first, cd.id).map((r) => r.indexOf(id)).filter((p) => p >= 0).map((p) => p + 1);
        if (places.length) ranks[cd.id] = places.reduce((s, p) => s + p, 0) / places.length;
      }
      const v = Object.values(ranks);
      if (v.length) items.push({ id, ranks, spread: Math.max(...v) - Math.min(...v) });
    }
    items.sort((a, b) => b.spread - a.spread || Math.min(...Object.values(a.ranks)) - Math.min(...Object.values(b.ranks)));
  }

  return {
    topK,
    n: { cases: cases.length, conditions: conditions.length, repeats: perCondition.length ? Math.min(...perCondition.map((c) => c.repeats)) : 0, rankings: cells.length },
    ...(noise ? { noise } : {}),
    effects,
    conditions: perCondition,
    items,
  };
}

const num = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');

/**
 * The verdict in plain words: what moved the result, by how much, against
 * the run-to-run variation, and what it rests on. Says so when nothing can
 * be concluded. Pure.
 */
export function verdictWords(v: ExperimentVerdict): { headline: string; lines: string[]; sample: string } {
  const sample = `${String(v.n.cases)} ${v.n.cases === 1 ? 'set' : 'sets'}, ${String(v.n.conditions)} conditions, ${String(v.n.repeats)} ${v.n.repeats === 1 ? 'run' : 'runs'} of each. It holds for ${v.n.cases === 1 ? 'this set' : 'these sets'} only.`;
  const said = (s: RankDifference) => `${num(s.overlap)} of the top ${String(v.topK)} stayed, and an item moved ${num(s.shift)} ${num(s.shift) === '1' ? 'place' : 'places'} on average.`;
  if (!v.effects.length) return { headline: v.n.rankings ? 'Nothing to compare yet: no two conditions that differ in one thing alone have both been run.' : 'Nothing has been run yet.', lines: [], sample };
  const lines = v.effects.map((e) => `Changing ${e.name.toLowerCase()}: ${said(e)}`);
  if (!v.noise) return { headline: 'Each condition was run once, so run-to-run variation isn\'t known and no factor can be said to matter. Run it with repeats.', lines, sample };
  lines.push(`Running the same thing again: ${said(v.noise)}`);
  const beyond = v.effects.filter((e) => e.beyondNoise);
  if (!beyond.length) return { headline: 'No factor changed the result more than running the same thing twice did.', lines, sample };
  let headline: string;
  if (beyond.length === 1) {
    const others = v.effects.filter((e) => e !== beyond[0]);
    headline = `${beyond[0].name} changed the result${others.length ? `; ${others.map((e) => e.name.toLowerCase()).join(' and ')} did not, beyond run-to-run variation` : ', beyond run-to-run variation'}.`;
  } else {
    const [top, next] = beyond;
    headline = top.shift > 0 && next.shift / top.shift > 0.8
      ? `${top.name} and ${next.name.toLowerCase()} changed the result about as much as each other.`
      : `${top.name} changed the result more than ${next.name.toLowerCase()} did.`;
  }
  return { headline, lines, sample };
}
