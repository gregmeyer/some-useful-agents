/**
 * What an experiment measured (ADR-0078), counted in code from what its
 * runs produced. Nothing here asks a model: the numbers a verdict rests on
 * are counted, so a write-up can't invent them.
 *
 * A run's output is a list of item keys, in the order it listed them. Two
 * outputs are compared by what they share: how many items are in both, of
 * how many there are between them; and, for the ones in both, how many
 * places apart they sit. Repeats of one condition give the run-to-run
 * variation (the floor); conditions that differ in one factor alone give
 * that factor's effect. An effect is "beyond" the variation only when two
 * versions share less than the least any two repeats of the same condition
 * shared.
 */

/** How two outputs differ. */
export interface OutputDifference {
  /** Items in both. */
  shared: number;
  /** Items in either. */
  of: number;
  /** shared / of (1 when both are empty). */
  share: number;
  /** Places apart, on average, for the items in both (0 when none is shared). */
  shift: number;
}

export function outputDifference(a: readonly string[], b: readonly string[]): OutputDifference {
  // Places are counted among the shared items alone, so an item only one found doesn't push the rest apart.
  const inB = new Set(b);
  const inA = new Set(a);
  const aShared = a.filter((k) => inB.has(k));
  const bShared = b.filter((k) => inA.has(k));
  let moved = 0;
  aShared.forEach((k, i) => { moved += Math.abs(i - bShared.indexOf(k)); });
  const of = new Set([...a, ...b]).size;
  const shared = aShared.length;
  return { shared, of, share: of ? shared / of : 1, shift: shared ? moved / shared : 0 };
}

/** One run's output, placed in the grid. */
export interface MeasuredCell { conditionId: string; repeat: number; keys: readonly string[] }
/** A condition: the level it takes for each factor. */
export interface MeasuredCondition { id: string; name: string; levels: Readonly<Record<string, string>> }
export interface MeasuredFactor { id: string; name: string }

/** An average over pairs of outputs, with the extremes seen. */
export interface MeasuredSpread {
  /** Pairs of outputs it is the average of. */
  pairs: number;
  shared: number;
  of: number;
  share: number;
  shift: number;
  /** The least any pair shared. */
  shareMin: number;
}

export interface FactorEffect extends MeasuredSpread {
  factorId: string;
  name: string;
  /** Two versions shared less than any two repeats of one condition did. Undefined when there were no repeats to compare. */
  beyondNoise?: boolean;
  /** Each pair of conditions it is the average of: the same change with everything else held at one setting. */
  parts: Array<{ from: string; to: string; shared: number; of: number; share: number }>;
}

/** One item across the conditions: in how many of each condition's runs it turned up, and about where. */
export interface ItemPresence {
  key: string;
  /** By condition: the share of its runs that listed the item (0 to 1). */
  found: Record<string, number>;
  /** By condition: its place on average in the runs that listed it (1 = first). */
  place: Record<string, number>;
  /** The most it was found in any condition, less the least. */
  spread: number;
}

export interface ExperimentVerdict {
  /** What was run: conditions, the fewest runs any condition has, outputs counted. */
  n: { conditions: number; repeats: number; outputs: number };
  /** Between repeats of the same condition. Undefined with fewer than two runs of any. */
  noise?: MeasuredSpread;
  /** One per factor that has two conditions differing in it alone, least shared first. */
  effects: FactorEffect[];
  /** Each condition: how many items its runs listed on average, and against the first (the baseline). */
  conditions: Array<{ id: string; name: string; repeats: number; items: number; vsBaseline?: MeasuredSpread }>;
  /** Every item any run listed, the ones whose presence differs most between conditions first. */
  items: ItemPresence[];
}

function spread(diffs: readonly OutputDifference[]): MeasuredSpread | undefined {
  if (!diffs.length) return undefined;
  const mean = (f: (d: OutputDifference) => number) => diffs.reduce((s, d) => s + f(d), 0) / diffs.length;
  return { pairs: diffs.length, shared: mean((d) => d.shared), of: mean((d) => d.of), share: mean((d) => d.share), shift: mean((d) => d.shift), shareMin: Math.min(...diffs.map((d) => d.share)) };
}
function within(rs: ReadonlyArray<readonly string[]>): OutputDifference[] {
  const out: OutputDifference[] = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) out.push(outputDifference(rs[i], rs[j]));
  return out;
}
function between(a: ReadonlyArray<readonly string[]>, b: ReadonlyArray<readonly string[]>): OutputDifference[] {
  return a.flatMap((x) => b.map((y) => outputDifference(x, y)));
}

/**
 * The verdict of one pass: the run-to-run variation, each factor's effect,
 * each condition against the baseline, and where each item turned up. Pure.
 * Runs whose output couldn't be read (or that failed) are simply not passed.
 */
export function experimentVerdict(input: { factors: readonly MeasuredFactor[]; conditions: readonly MeasuredCondition[]; cells: readonly MeasuredCell[] }): ExperimentVerdict {
  const { factors, conditions, cells } = input;
  const of = (conditionId: string) => cells.filter((c) => c.conditionId === conditionId).sort((a, b) => a.repeat - b.repeat).map((c) => c.keys);

  const noise = spread(conditions.flatMap((cd) => within(of(cd.id))));

  const effects: FactorEffect[] = [];
  for (const f of factors) {
    const diffs: OutputDifference[] = [];
    const parts: FactorEffect['parts'] = [];
    for (let i = 0; i < conditions.length; i++) {
      for (let j = i + 1; j < conditions.length; j++) {
        const a = conditions[i];
        const b = conditions[j];
        // The pair tests this factor only when it is the one thing they differ in.
        const differ = factors.filter((x) => a.levels[x.id] !== b.levels[x.id]).map((x) => x.id);
        if (differ.length !== 1 || differ[0] !== f.id) continue;
        const pair = between(of(a.id), of(b.id));
        diffs.push(...pair);
        const ps = spread(pair);
        if (ps) parts.push({ from: a.id, to: b.id, shared: ps.shared, of: ps.of, share: ps.share });
      }
    }
    const s = spread(diffs);
    if (!s) continue;
    effects.push({ factorId: f.id, name: f.name, ...s, parts, ...(noise ? { beyondNoise: s.share < noise.shareMin } : {}) });
  }
  effects.sort((a, b) => a.share - b.share);

  const base = conditions[0];
  const perCondition = conditions.map((cd) => {
    const runs = of(cd.id);
    const vs = base && cd.id !== base.id ? spread(between(of(base.id), runs)) : undefined;
    return { id: cd.id, name: cd.name, repeats: runs.length, items: runs.length ? runs.reduce((s, r) => s + r.length, 0) / runs.length : 0, ...(vs ? { vsBaseline: vs } : {}) };
  });

  const keys = [...new Set(cells.flatMap((c) => c.keys))];
  const items: ItemPresence[] = keys.map((key) => {
    const found: Record<string, number> = {};
    const place: Record<string, number> = {};
    for (const cd of conditions) {
      const runs = of(cd.id);
      if (!runs.length) continue;
      const places = runs.map((r) => r.indexOf(key)).filter((p) => p >= 0).map((p) => p + 1);
      found[cd.id] = places.length / runs.length;
      if (places.length) place[cd.id] = places.reduce((s, p) => s + p, 0) / places.length;
    }
    const v = Object.values(found);
    return { key, found, place, spread: v.length ? Math.max(...v) - Math.min(...v) : 0 };
  });
  // The ones some versions found and others didn't lead; then the ones found most, in the order they tend to come.
  const total = (i: ItemPresence) => Object.values(i.found).reduce((s, x) => s + x, 0);
  const first = (i: ItemPresence) => Math.min(...Object.values(i.place), Number.MAX_SAFE_INTEGER);
  items.sort((a, b) => b.spread - a.spread || total(b) - total(a) || first(a) - first(b));

  return {
    n: { conditions: conditions.length, repeats: perCondition.length ? Math.min(...perCondition.map((c) => c.repeats)) : 0, outputs: cells.length },
    ...(noise ? { noise } : {}),
    effects,
    conditions: perCondition,
    items,
  };
}

const num = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');

/** "4 of 12 items were in both" for an average over pairs. */
export function sharedWords(s: Pick<MeasuredSpread, 'shared' | 'of'>): string {
  return `${num(s.shared)} of ${num(s.of)} ${num(s.of) === '1' ? 'item was' : 'items were'} in both`;
}

/**
 * The verdict in plain words: what changed what was produced, by how much,
 * against the run-to-run variation, and what it rests on. Says so when
 * nothing can be concluded. Pure.
 */
export function verdictWords(v: ExperimentVerdict): { headline: string; lines: string[]; sample: string } {
  const sample = `${String(v.n.conditions)} ${v.n.conditions === 1 ? 'version' : 'versions'}, ${String(v.n.repeats)} ${v.n.repeats === 1 ? 'run' : 'runs'} of each. It holds for this ask, when it was run.`;
  if (!v.n.outputs) return { headline: 'Nothing has been run yet.', lines: [], sample };
  const lines = v.effects.map((e) => `Changing ${e.name.toLowerCase()}: ${sharedWords(e)} versions' results, on average.`);
  if (v.noise) lines.push(`Running the same version again: ${sharedWords(v.noise)} runs' results, on average.`);
  if (!v.effects.length) {
    if (v.noise) return { headline: `Nothing was changed, so this shows only how steady it is: two runs of the same thing shared ${num(v.noise.share * 100)}% of what they found.`, lines, sample };
    return { headline: 'Nothing to compare yet: no two versions that differ in one thing alone have both been run.', lines, sample };
  }
  if (!v.noise) return { headline: 'Each version was run once, so run-to-run variation isn\'t known and no change can be said to matter. Run it with repeats.', lines, sample };
  const beyond = v.effects.filter((e) => e.beyondNoise);
  if (!beyond.length) return { headline: 'No change altered what it produced more than running the same version twice did.', lines, sample };
  if (beyond.length === 1) {
    const others = v.effects.filter((e) => e !== beyond[0]);
    return { headline: `${beyond[0].name} changed what it produced${others.length ? `; ${others.map((e) => e.name.toLowerCase()).join(' and ')} did not, beyond run-to-run variation` : ', beyond run-to-run variation'}.`, lines, sample };
  }
  const [top, next] = beyond;
  return {
    headline: next.share > 0 && top.share / next.share > 0.8 ? `${top.name} and ${next.name.toLowerCase()} changed what it produced about as much as each other.` : `${top.name} changed what it produced more than ${next.name.toLowerCase()} did.`,
    lines, sample,
  };
}
