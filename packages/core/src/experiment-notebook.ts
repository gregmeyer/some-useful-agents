/**
 * An experiment's results as page data (ADR-0078): for its own page, for a
 * notebook that shows it, and for anything that reads it. Built from the
 * experiment's latest pass every time, so it never goes stale and nothing
 * here is copied or written by a model.
 *
 * - experimentPageData: the finding, the figures and the tables.
 * - experimentLayout: a notebook page for one experiment, with a column for
 *   each of its conditions and scorers.
 */
import type { ViewComponent } from './a2ui/view.js';
import { experimentVerdict, sharedWords, verdictWords } from './experiment-measures.js';
import { experimentConditions, passProgress, scoreSummaries, type Experiment, type ExperimentCell, type ExperimentScore } from './experiments.js';
import type { NotebookLayout } from './notebook-layout.js';

const num = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
const pct = (n: number) => `${String(Math.round(n * 100))}%`;

/** What a page shows of an experiment. Table cells are text, so they read the same everywhere. */
export interface ExperimentPageData {
  id: string;
  name: string;
  /** The experiment's own page: every run, Run it, Stop. */
  href: string;
  /** "What it found", "So far" while it runs, "Not run yet". */
  label: string;
  /** The finding in a sentence (bold), then how much each change altered, as one paragraph. */
  headline: string;
  /** What it rests on: the sample, and what couldn't be used. */
  rests: string;
  /** How it stands, in a few words ("6 of 6 runs", "running 2 of 6"). */
  runs: string;
  figures: Array<{ label: string; value: string; sub?: string; tone?: 'ok' }>;
  /** One row per condition: condition, runs, found, shared, then a cell per scorer (s0, s1…). */
  conditions: Array<Record<string, string>>;
  /** The same change with everything else held at one setting: changing, from, to, shared. */
  changes: Array<Record<string, string>>;
  /** One row per item any run listed: item, link, then where it turned up under each condition (c0, c1…). */
  items: Array<Record<string, string>>;
}

/** The page data for an experiment's latest pass (its cells and scores; none when it hasn't run). Pure. */
export function experimentPageData(e: Experiment, cells: readonly ExperimentCell[], scores: readonly ExperimentScore[] = [], opts: { running?: boolean } = {}): ExperimentPageData {
  const conditions = experimentConditions(e.factors);
  const p = passProgress(cells);
  const read = cells.flatMap((c) => (c.status === 'done' && c.items ? [{ conditionId: c.conditionId, repeat: c.repeat, keys: c.items.map((i) => i.key) }] : []));
  const v = experimentVerdict({ factors: e.factors, conditions, cells: read });
  const w = verdictWords(v);
  const sums = scoreSummaries(e.scorers, cells, scores);
  // An item's words, from the first run that listed it.
  const seen = new Map(cells.flatMap((c) => (c.items ?? []).map((i) => [i.key, i] as const)).reverse());
  const nameOf = new Map(conditions.map((c) => [c.id, c.name] as const));
  const unusable = p.invalid + p.failed;
  const ran = cells.length > 0;
  return {
    id: e.id, name: e.name, href: `/experiments/${encodeURIComponent(e.id)}`,
    label: !ran ? 'Not run yet' : opts.running ? 'So far' : 'What it found',
    headline: !ran
      ? `**Nothing has run yet.** Open the experiment and press Run: a pass runs ${e.task.agentId} ${String(conditions.length * e.repeats)} times.`
      : [`**${w.headline}**`, ...w.lines].join(' '),
    rests: !ran ? 'Its numbers appear here as the runs come back.' : `${w.sample}${unusable ? ` ${String(unusable)} ${unusable === 1 ? 'run' : 'runs'} couldn't be used and ${unusable === 1 ? 'is' : 'are'} not counted.` : ''}`,
    runs: !ran ? 'not run yet' : opts.running ? `running ${String(p.done)} of ${String(p.total)}` : p.stopped ? `stopped at ${String(p.done)} of ${String(p.total)} runs` : `${String(p.done)} of ${String(p.total)} runs`,
    figures: [
      ...v.effects.map((f) => ({
        label: `of what they found was in both, when ${f.name.toLowerCase()} changed`, value: pct(f.share),
        sub: `${sharedWords(f)}${f.beyondNoise === undefined ? '' : f.beyondNoise ? '; less than any two runs of the same version' : '; no less than two runs of the same version'}`,
        ...(f.beyondNoise ? { tone: 'ok' as const } : {}),
      })),
      ...(v.noise ? [{ label: 'of what they found was in both, for two runs of the same version', value: pct(v.noise.share), sub: sharedWords(v.noise) }] : []),
    ],
    conditions: conditions.map((c, i) => {
      const m = v.conditions.find((x) => x.id === c.id);
      const mine = cells.filter((x) => x.conditionId === c.id);
      const row: Record<string, string> = {
        condition: i === 0 ? `${c.name} (baseline)` : c.name,
        runs: ran ? `${String(mine.filter((x) => x.status === 'done').length)} of ${String(mine.length)}` : '',
        found: m && m.repeats ? num(m.items) : '',
        shared: i === 0 || !m?.vsBaseline ? '' : `${pct(m.vsBaseline.share)} (${num(m.vsBaseline.shared)} of ${num(m.vsBaseline.of)})`,
      };
      e.scorers.forEach((s, j) => {
        const sm = sums.find((x) => x.scorerId === s.id && x.conditionId === c.id);
        row[`s${String(j)}`] = sm ? `${pct(sm.mean)}${sm.n > 1 && sm.min !== sm.max ? ` (${pct(sm.min)} to ${pct(sm.max)})` : ''}` : '';
      });
      return row;
    }),
    changes: v.effects.flatMap((f) => (f.parts.length > 1 ? f.parts.map((part) => ({
      changing: f.name, from: nameOf.get(part.from) ?? part.from, to: nameOf.get(part.to) ?? part.to,
      shared: `${pct(part.share)} (${num(part.shared)} of ${num(part.of)})`,
    })) : [])),
    items: v.items.map((it) => {
      const item = seen.get(it.key);
      const row: Record<string, string> = { item: item?.title ?? it.key, link: item?.link ?? '' };
      conditions.forEach((c, i) => {
        const runs = v.conditions.find((x) => x.id === c.id)?.repeats ?? 0;
        const n = Math.round((it.found[c.id] ?? 0) * runs);
        row[`c${String(i)}`] = !runs ? '' : n === 0 ? 'not found' : `${n === runs ? (runs === 1 ? 'found' : `all ${String(runs)}`) : `${String(n)} of ${String(runs)}`}${it.place[c.id] !== undefined ? `, place ${num(it.place[c.id])}` : ''}`;
      });
      return row;
    }),
  };
}

/** The page data of a notebook whose experiment is gone. */
export function missingExperimentData(id: string): ExperimentPageData {
  return { id, name: id, href: '/experiments', label: 'Not found', headline: '**This notebook\'s experiment is no longer there.**', rests: 'It may have been removed.', runs: '', figures: [], conditions: [], changes: [], items: [] };
}

const E = (key: string) => ({ path: `/notebook/experiment/${key}` });

/**
 * The page of a notebook that shows this experiment: the finding first,
 * then the figures, each condition against the baseline (with a column a
 * scorer), each change by itself, and where each item turned up (a column
 * a condition). Its columns are this experiment's, so it is made for it.
 * Pure.
 */
export function experimentLayout(e: Pick<Experiment, 'factors' | 'scorers'>): NotebookLayout {
  const conditions = experimentConditions(e.factors);
  const multi = e.factors.length > 1;
  const panel = (id: string, title: string, child: string, note: string): ViewComponent => ({ id, component: 'Panel', title, child, note, treatment: 'feature' });
  const components: ViewComponent[] = [
    { id: 'root', component: 'Column', children: ['header', 'finding', 'figures', 'conditions_p', ...(multi ? ['changes_p'] : []), 'items_p', 'open'] },
    { id: 'header', component: 'NotebookHeader', subtitle: 'Experiment', steps: 'fold', cover: 'none' },
    { id: 'finding', component: 'Callout', label: E('label'), text: E('headline'), next: E('rests'), nextLabel: 'Rests on:' },
    { id: 'figures', component: 'StatStrip', items: E('figures') },
    panel('conditions_p', 'Each version against the baseline', 'conditions', `how many items its runs listed, and how much of that the baseline also found${e.scorers.length ? ', and each score' : ''}`),
    {
      id: 'conditions', component: 'Table', rows: E('conditions'),
      columns: [
        { key: 'condition', label: 'Version' }, { key: 'runs', label: 'Runs' }, { key: 'found', label: 'Items found' }, { key: 'shared', label: 'In both' },
        ...e.scorers.map((s, j) => ({ key: `s${String(j)}`, label: s.name.slice(0, 80) })),
      ],
    },
    ...(multi ? [
      panel('changes_p', 'Each change by itself', 'changes', 'the same change with everything else held at one setting'),
      { id: 'changes', component: 'Table', rows: E('changes'), columns: [{ key: 'changing', label: 'Changing' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'shared', label: 'In both' }] } as ViewComponent,
    ] : []),
    panel('items_p', 'What each version found', 'items', 'every item any run listed; the ones some versions found and others didn\'t are first'),
    {
      id: 'items', component: 'Table', rows: E('items'), maxRows: 100,
      columns: [{ key: 'item', label: 'Item' }, ...conditions.map((c, i) => ({ key: `c${String(i)}`, label: c.name.slice(0, 80) }))],
    },
    { id: 'open', component: 'Link', text: 'Open the experiment: its setup, every run, and Run it again', url: E('href') },
  ];
  return { components, about: 'An experiment\'s finding first, then the numbers behind it: each version, each change by itself, and what each version found.' };
}
