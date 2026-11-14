/**
 * An experiment as something else can read it (experiment-read: an agent, an
 * MCP client, sua in a conversation): what it set out to find, what it
 * found and what that rests on, how it is set up, each condition, each
 * change by itself, where each item landed, and its runs. Everything here
 * is counted from the stored runs (experimentPageData); a reader repeats it,
 * it does not re-derive it.
 */
import { experimentConditions, passProgress, type Experiment, type ExperimentCase, type ExperimentCell, type ExperimentPass, type ExperimentScore, type ExperimentStore } from './experiments.js';
import { experimentPageData } from './experiment-notebook.js';

export const EXPERIMENT_READ_PARTS = ['all', 'finding', 'setup', 'conditions', 'items', 'runs'] as const;
export type ExperimentReadPart = (typeof EXPERIMENT_READ_PARTS)[number];

/** An experiment with what its latest pass holds. */
export interface ExperimentRead { experiment: Experiment; cases: ExperimentCase[]; pass?: ExperimentPass; cells: ExperimentCell[]; scores: ExperimentScore[] }

/** Read an experiment and its latest pass from the store. */
export function readExperiment(store: ExperimentStore, id: string): ExperimentRead | undefined {
  const experiment = store.get(id);
  if (!experiment) return undefined;
  const pass = store.passes(id, 1)[0];
  return { experiment, cases: store.cases(id), ...(pass ? { pass } : {}), cells: pass ? store.cells(pass.id) : [], scores: pass ? store.scores(pass.id) : [] };
}

/**
 * The experiment asked for: by id, by a /experiments/<id> link, by its exact
 * name, or by words from its name (several matches come back as a list).
 * Archived ones too.
 */
export function findExperiment(store: Pick<ExperimentStore, 'get' | 'list'>, ask: string): { experiment: Experiment } | { matches: Experiment[] } | undefined {
  const q = ask.trim();
  if (!q) return undefined;
  const id = /\/experiments\/([A-Za-z0-9_-]+)/.exec(q)?.[1] ?? q;
  const byId = store.get(id);
  if (byId) return { experiment: byId };
  const all = store.list({ archived: true });
  const lower = q.toLowerCase();
  const exact = all.filter((e) => e.name.toLowerCase() === lower);
  if (exact.length === 1) return { experiment: exact[0] };
  const words = lower.split(/[^a-z0-9.]+/).filter((w) => w.length > 1);
  if (!words.length) return undefined;
  const hits = all.filter((e) => { const t = `${e.name} ${e.id}`.toLowerCase(); return words.every((w) => t.includes(w)); });
  if (hits.length === 1) return { experiment: hits[0] };
  return hits.length ? { matches: hits } : undefined;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** An experiment as JSON, whole or one part. Pure. */
export function experimentReadoutJson(r: ExperimentRead, part: ExperimentReadPart = 'all'): Record<string, unknown> {
  const { experiment: e, cases, cells, scores } = r;
  const d = experimentPageData(e, cases, cells, scores);
  const conditions = experimentConditions(e.factors);
  const p = passProgress(cells);
  const ran = cells.length > 0;
  const want = (x: ExperimentReadPart) => part === 'all' || part === x;
  return {
    id: e.id, name: e.name, link: d.href, ...(e.question ? { question: e.question } : {}), ...(e.archivedAt ? { archived: true } : {}),
    stands: d.runs,
    ...(want('finding') ? { finding: ran ? { found: d.headline.replace(/\*\*/g, ''), restsOn: d.rests, figures: d.figures.map((f) => ({ what: f.label, value: f.value, ...(f.sub ? { detail: f.sub } : {}) })) } : { found: 'Nothing has run yet, so it has found nothing.' } } : {}),
    ...(want('setup') ? {
      setup: {
        runs: e.task.agentId, timesEach: e.repeats, topK: e.topK,
        holdsFixed: cases.map((c) => ({ items: c.items.length, ...(e.from ? { copiedFrom: e.from.title, notebook: `/notebooks/${encodeURIComponent(e.from.notebookId)}` } : {}), ...(e.fromRun ? { takenFrom: e.fromRun.title, run: `/runs/${encodeURIComponent(e.fromRun.runId)}` } : {}) })),
        changes: e.factors.map((f) => ({
          name: f.name,
          versions: f.levels.map((l) => ({ name: l.name, ...(l.instructions ? { instructions: l.instructions } : {}), ...(l.inputs ? { inputs: l.inputs } : {}), ...(l.provider ? { provider: l.provider } : {}), ...(l.model ? { model: l.model } : {}), ...(l.version !== undefined ? { agentVersion: l.version } : {}) })),
        })),
        scoredBy: e.scorers.map((s) => (s.kind === 'top'
          ? { name: s.name, how: `counted: the share of ${String(s.items.length)} named items ${s.avoid ? 'kept out of' : 'in'} the top ${String(s.k)}` }
          : { name: s.name, how: 'judged by a model against a rubric', rubric: s.rubric })),
      },
    } : {}),
    ...(want('conditions') ? {
      // The score columns by their names, not their positions.
      conditions: d.conditions.map((row) => ({ condition: row.condition, runs: row.runs, ...(row.kept ? { topKept: row.kept, placesMoved: row.moved } : {}), ...Object.fromEntries(e.scorers.map((s, j) => [s.name, row[`s${String(j)}`] ?? ''])) })),
      eachChangeByItself: d.changes,
    } : {}),
    ...(want('items') ? { items: d.items.map((row) => ({ item: row.item, moved: row.moved, places: Object.fromEntries(conditions.map((c, i) => [c.name, row[`c${String(i)}`] ?? ''])) })) } : {}),
    ...(want('runs') ? {
      runs: {
        made: p.total, usable: p.done, unusable: p.invalid + p.failed, stopped: p.stopped, ...(p.costUsd ? { costUsd: Math.round(p.costUsd * 1000) / 1000 } : {}),
        each: cells.map((c) => ({ condition: conditions.find((x) => x.id === c.conditionId)?.name ?? c.conditionId, run: c.repeat, status: c.status, ...(c.runId ? { runId: c.runId } : {}), ...(c.error ? { why: c.error } : {}) })),
      },
    } : {}),
  };
}

/** An experiment as text, whole or one part: what a reader needs, in the page's words. Pure. */
export function experimentReadoutText(r: ExperimentRead, part: ExperimentReadPart = 'all'): string {
  const { experiment: e, cases, cells, scores } = r;
  const d = experimentPageData(e, cases, cells, scores);
  const conditions = experimentConditions(e.factors);
  const p = passProgress(cells);
  const ran = cells.length > 0;
  const want = (x: ExperimentReadPart) => part === 'all' || part === x;
  const out: string[] = [`# ${e.name}${e.archivedAt ? ' (archived)' : ''}`, `Experiment ${e.id} · ${d.href} · ${d.runs}`];
  if (e.question) out.push('', `Sets out to find: ${e.question}`);
  if (want('finding')) {
    out.push('', '## What it found');
    if (!ran) out.push('Nothing has run yet, so it has found nothing.');
    else {
      out.push(d.headline.replace(/\*\*/g, ''), `Rests on: ${d.rests}`);
      out.push('These numbers are counted from its runs. Repeat them as they are; do not restate them differently or apply them to other sets.');
    }
  }
  if (want('setup')) {
    out.push('', '## How it is set up');
    out.push(`Runs ${e.task.agentId}, ${String(e.repeats)} ${e.repeats === 1 ? 'time' : 'times'} for each condition; "the top" is the first ${String(e.topK)}.`);
    for (const c of cases) out.push(`Holds fixed: ${String(c.items.length)} items${e.from ? `, copied from the notebook "${e.from.title}" (/notebooks/${e.from.notebookId})` : ''}${e.fromRun ? `, taken from ${e.fromRun.title} (/runs/${e.fromRun.runId})` : ''}.`);
    for (const f of e.factors) {
      out.push(`Changes ${f.name.toLowerCase()}:`);
      for (const l of f.levels) {
        const says = [l.version !== undefined ? `agent version ${String(l.version)}` : '', l.provider || l.model ? `runs on ${[l.provider, l.model].filter(Boolean).join(' ')}` : '', l.instructions ? `instructions: "${clip(l.instructions, 300)}"` : '', ...Object.entries(l.inputs ?? {}).map(([k, v]) => `${k.toLowerCase()}: "${clip(v, 300)}"`)].filter(Boolean);
        out.push(`- ${l.name}: ${says.length ? says.join('; ') : 'the agent as it is'}`);
      }
    }
    if (!e.factors.length) out.push('Changes nothing: it shows how much the result moves by itself.');
    for (const s of e.scorers) out.push(`Scores "${s.name}": ${s.kind === 'top' ? `counted, the share of ${String(s.items.length)} named items ${s.avoid ? 'kept out of' : 'in'} the top ${String(s.k)}` : `judged by a model against "${clip(s.rubric, 300)}"`}.`);
  }
  if (want('conditions') && ran) {
    out.push('', '## Each condition against the baseline');
    for (const row of d.conditions) {
      const scored = e.scorers.map((s, j) => (row[`s${String(j)}`] ? `${s.name} ${row[`s${String(j)}`]}` : '')).filter(Boolean);
      out.push(`- ${row.condition}: ${row.runs} runs${row.kept ? `; ${row.kept} of the baseline's top kept; items moved ${row.moved} places on average` : ''}${scored.length ? `; ${scored.join('; ')}` : ''}`);
    }
    if (d.changes.length) {
      out.push('', '## Each change by itself');
      for (const c of d.changes) out.push(`- ${c.changing}, from "${c.from}" to "${c.to}": ${c.kept} of the top kept; items moved ${c.moved} places on average`);
    }
  }
  if (want('items') && d.items.length) {
    out.push('', '## Where each item landed (1 is first; furthest moved first)');
    for (const row of d.items.slice(0, 30)) out.push(`- ${clip(row.item, 100)}: ${conditions.map((c, i) => `${c.name} ${row[`c${String(i)}`] || '-'}`).join('; ')} (moved ${row.moved})`);
    if (d.items.length > 30) out.push(`… and ${String(d.items.length - 30)} more.`);
  }
  if (want('runs') && ran) {
    out.push('', '## Its runs');
    out.push(`${String(p.total)} made: ${String(p.done)} usable${p.invalid + p.failed ? `, ${String(p.invalid + p.failed)} that couldn't be used` : ''}${p.stopped ? `, ${String(p.stopped)} stopped` : ''}.`);
    for (const c of cells.filter((x) => x.error)) out.push(`- ${conditions.find((x) => x.id === c.conditionId)?.name ?? c.conditionId}, run ${String(c.repeat)}: ${c.status}: ${clip(c.error!, 200)}`);
  }
  return out.join('\n');
}
