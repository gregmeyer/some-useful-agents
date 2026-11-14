/**
 * An experiment's results as a notebook's page (ADR-0078). The experiment
 * holds the runs; a notebook can show them and is where you talk to sua
 * about them. The page is drawn from the experiment's latest pass every
 * time it is opened, so it never goes stale and nothing here is copied or
 * written by a model.
 *
 * - experimentPageData: what the page binds to (/notebook/experiment).
 * - experimentLayout: the page itself, with a column for each of this
 *   experiment's conditions and scorers.
 */
import type { ViewComponent } from './a2ui/view.js';
import { experimentVerdict, verdictWords } from './experiment-measures.js';
import { experimentConditions, passProgress, scoreSummaries, type Experiment, type ExperimentCase, type ExperimentCell, type ExperimentScore } from './experiments.js';
import type { NotebookLayout } from './notebook-layout.js';

const num = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
const pct = (n: number) => `${String(Math.round(n * 100))}%`;

/** What a notebook's page shows of an experiment. Table cells are text, so they read the same everywhere. */
export interface ExperimentPageData {
  id: string;
  name: string;
  /** The experiment's own page: every run, Run it, Stop. */
  href: string;
  /** "What it found", "So far" while it runs, "Not run yet". */
  label: string;
  /** The finding in a sentence (bold), then how far each thing moved it, as one paragraph. */
  headline: string;
  /** What it rests on: the sample, and what couldn't be used. */
  rests: string;
  /** How it stands, in a few words ("12 of 12 runs", "running 5 of 12"). */
  runs: string;
  figures: Array<{ label: string; value: string; sub?: string; tone?: 'ok' }>;
  /** One row per condition: condition, runs, kept, moved, then a cell per scorer (s0, s1…). */
  conditions: Array<Record<string, string>>;
  /** The same change with everything else held at one setting: changing, from, to, kept, moved. */
  changes: Array<Record<string, string>>;
  /** One row per item: item, its place under each condition (c0, c1…), moved. Furthest moved first. */
  items: Array<Record<string, string>>;
}

/** The page data for an experiment's latest pass (cells and scores of that pass; none when it hasn't run). Pure. */
export function experimentPageData(e: Experiment, cases: readonly ExperimentCase[], cells: readonly ExperimentCell[], scores: readonly ExperimentScore[] = [], opts: { running?: boolean } = {}): ExperimentPageData {
  const conditions = experimentConditions(e.factors);
  const p = passProgress(cells);
  const ranked = cells.flatMap((c) => (c.status === 'done' && c.ranking ? [{ caseId: c.caseId, conditionId: c.conditionId, repeat: c.repeat, ranking: c.ranking }] : []));
  const v = experimentVerdict({ factors: e.factors, conditions, cells: ranked, topK: e.topK });
  const w = verdictWords(v);
  const sums = scoreSummaries(e.scorers, cells, scores);
  const titleOf = new Map(cases.flatMap((c) => c.items.map((i) => [i.id, i.title] as const)));
  const nameOf = new Map(conditions.map((c) => [c.id, c.name] as const));
  const unusable = p.invalid + p.failed;
  const ran = cells.length > 0;
  return {
    id: e.id, name: e.name, href: `/experiments/${encodeURIComponent(e.id)}`,
    label: !ran ? 'Not run yet' : opts.running ? 'So far' : 'What it found',
    headline: !ran
      ? `**Nothing has run yet.** Open the experiment and press Run: a pass makes ${String(cases.length * conditions.length * e.repeats)} runs of ${e.task.agentId}.`
      : [`**${w.headline}**`, ...w.lines].join(' '),
    rests: !ran ? 'Its numbers appear here as the runs come back.' : `${w.sample}${unusable ? ` ${String(unusable)} ${unusable === 1 ? 'run' : 'runs'} couldn't be used and ${unusable === 1 ? 'is' : 'are'} not counted.` : ''}`,
    runs: !ran ? 'not run yet' : opts.running ? `running ${String(p.done)} of ${String(p.total)}` : p.stopped ? `stopped at ${String(p.done)} of ${String(p.total)} runs` : `${String(p.done)} of ${String(p.total)} runs`,
    figures: [
      ...v.effects.map((f) => ({
        label: `places moved by changing ${f.name.toLowerCase()}`, value: num(f.shift),
        sub: `${num(f.overlap)} of the top ${String(v.topK)} stayed${f.beyondNoise === undefined ? '' : f.beyondNoise ? ', more than a repeat' : ', no more than a repeat'}`,
        ...(f.beyondNoise ? { tone: 'ok' as const } : {}),
      })),
      ...(v.noise ? [{ label: 'places moved between two runs of the same thing', value: num(v.noise.shift), sub: `${num(v.noise.overlap)} of the top ${String(v.topK)} stayed` }] : []),
    ],
    conditions: conditions.map((c, i) => {
      const m = v.conditions.find((x) => x.id === c.id);
      const mine = cells.filter((x) => x.conditionId === c.id);
      const row: Record<string, string> = {
        condition: i === 0 ? `${c.name} (baseline)` : c.name,
        runs: ran ? `${String(mine.filter((x) => x.status === 'done').length)} of ${String(mine.length)}` : '',
        kept: i === 0 || !m?.vsBaseline ? '' : `${num(m.vsBaseline.overlap)} of ${String(v.topK)}`,
        moved: i === 0 || !m?.vsBaseline ? '' : num(m.vsBaseline.shift),
      };
      e.scorers.forEach((s, j) => {
        const sm = sums.find((x) => x.scorerId === s.id && x.conditionId === c.id);
        row[`s${String(j)}`] = sm ? `${pct(sm.mean)}${sm.n > 1 && sm.min !== sm.max ? ` (${pct(sm.min)} to ${pct(sm.max)})` : ''}` : '';
      });
      return row;
    }),
    changes: v.effects.flatMap((f) => (f.parts.length > 1 ? f.parts.map((part) => ({
      changing: f.name, from: nameOf.get(part.from) ?? part.from, to: nameOf.get(part.to) ?? part.to,
      kept: `${num(part.overlap)} of ${String(v.topK)}`, moved: num(part.shift),
    })) : [])),
    items: v.items.map((it) => {
      const row: Record<string, string> = { item: titleOf.get(it.id) ?? it.id, moved: num(it.spread) };
      conditions.forEach((c, i) => { row[`c${String(i)}`] = it.ranks[c.id] !== undefined ? num(it.ranks[c.id]) : ''; });
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
 * scorer), each change by itself, and where each item landed (a column a
 * condition). Its columns are this experiment's, so it is made for it. Pure.
 */
export function experimentLayout(e: Pick<Experiment, 'factors' | 'scorers' | 'topK'>): NotebookLayout {
  const conditions = experimentConditions(e.factors);
  const multi = e.factors.length > 1;
  const panel = (id: string, title: string, child: string, note: string): ViewComponent => ({ id, component: 'Panel', title, child, note, treatment: 'feature' });
  const components: ViewComponent[] = [
    { id: 'root', component: 'Column', children: ['header', 'finding', 'figures', 'conditions_p', ...(multi ? ['changes_p'] : []), 'items_p', 'open'] },
    { id: 'header', component: 'NotebookHeader', subtitle: 'Experiment', steps: 'fold', cover: 'none' },
    { id: 'finding', component: 'Callout', label: E('label'), text: E('headline'), next: E('rests'), nextLabel: 'Rests on:' },
    { id: 'figures', component: 'StatStrip', items: E('figures') },
    panel('conditions_p', 'Each condition against the baseline', 'conditions', `how many of the baseline's top ${String(e.topK)} stayed, how far items moved${e.scorers.length ? ', and each score' : ''}`),
    {
      id: 'conditions', component: 'Table', rows: E('conditions'),
      columns: [
        { key: 'condition', label: 'Condition' }, { key: 'runs', label: 'Runs' }, { key: 'kept', label: `Top ${String(e.topK)} kept` }, { key: 'moved', label: 'Places moved' },
        ...e.scorers.map((s, j) => ({ key: `s${String(j)}`, label: s.name.slice(0, 80) })),
      ],
    },
    ...(multi ? [
      panel('changes_p', 'Each change by itself', 'changes', 'the same change with everything else held at one setting'),
      { id: 'changes', component: 'Table', rows: E('changes'), columns: [{ key: 'changing', label: 'Changing' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'kept', label: `Top ${String(e.topK)} kept` }, { key: 'moved', label: 'Places moved' }] } as ViewComponent,
    ] : []),
    panel('items_p', 'Where each item landed', 'items', 'its place under each condition, the ones that moved furthest first'),
    {
      id: 'items', component: 'Table', rows: E('items'), maxRows: 60,
      columns: [{ key: 'item', label: 'Item' }, ...conditions.map((c, i) => ({ key: `c${String(i)}`, label: c.name.slice(0, 80) })), { key: 'moved', label: 'Moved' }],
    },
    { id: 'open', component: 'Link', text: 'Open the experiment: its setup, every run, and Run it again', url: E('href') },
  ];
  return { components, about: 'An experiment\'s finding first, then the numbers behind it: each condition, each change by itself, and where each item landed.' };
}
