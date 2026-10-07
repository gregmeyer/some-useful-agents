/**
 * How a notebook was made: the runs that filed into it, the runs those
 * started (agent calls, loops, agents used as tools), and what each left in
 * the notebook. The notebook's Workflow view draws it as one graph, the way
 * a single run's DAG is drawn.
 */
import type { Run } from './types.js';
import type { NotebookEntryKind, NotebookPassKind, NotebookStore } from './notebooks.js';

/**
 * The runs a run started and the runs those started, depth-first, each with
 * its depth (0 = direct child). Agent calls nest at most 3 deep; the cap
 * guards against a bad parent link looping.
 */
export function collectSubRunTree(
  runStore: { listChildRuns(id: string): Run[] },
  rootId: string,
  maxDepth = 4,
): Array<Run & { depth: number }> {
  const out: Array<Run & { depth: number }> = [];
  const seen = new Set<string>([rootId]);
  const walk = (id: string, depth: number) => {
    if (depth >= maxDepth) return;
    for (const child of runStore.listChildRuns(id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push({ ...child, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(rootId, 0);
  return out;
}

export interface LineageRun {
  id: string;
  agentId: string;
  status: Run['status'];
  startedAt: string;
  completedAt?: string;
  triggeredBy: string;
  error?: string;
  /** The run (and node) that started this one; undefined for a run that filed into the notebook. */
  parentRunId?: string;
  parentNodeId?: string;
}

export interface LineageFeeder {
  run: LineageRun;
  /** Options its search found (when it recorded a search). */
  found?: number;
  /** What it left in the notebook, by kind. */
  kinds: Partial<Record<NotebookEntryKind, number>>;
  /** Options already there that it saw again. */
  seenAgain: number;
  /** Every run it started, at any depth. */
  subRuns: LineageRun[];
}

/** One go at filling the notebook and its runs; `earlier` = a run from before passes were kept. */
export interface LineagePass {
  id: string;
  kind: NotebookPassKind | 'earlier';
  startedAt: string;
  finishedAt?: string;
  note?: string;
  feeders: LineageFeeder[];
}

export interface NotebookLineage {
  /** Runs that filed into the notebook, newest first. */
  feeders: LineageFeeder[];
  /** Feeders not shown (older than the newest `limit`). */
  more: number;
  /** The same runs grouped into passes, newest first (at most `passLimit`). */
  passes: LineagePass[];
}

const toLineageRun = (r: Run): LineageRun => ({
  id: r.id, agentId: r.agentName, status: r.status, startedAt: r.startedAt, triggeredBy: r.triggeredBy,
  ...(r.completedAt ? { completedAt: r.completedAt } : {}),
  ...(r.error ? { error: r.error.slice(0, 200) } : {}),
  ...(r.parentRunId ? { parentRunId: r.parentRunId } : {}),
  ...(r.parentNodeId ? { parentNodeId: r.parentNodeId } : {}),
});

/** The notebook's runs (newest `limit`) and its passes, each run with its sub-runs and what it left. */
export function notebookLineage(
  store: Pick<NotebookStore, 'runFootprints' | 'passes'>,
  runs: { getRun(id: string): Run | null; listChildRuns(id: string): Run[] },
  notebookId: string,
  limit = 12,
  passLimit = 20,
): NotebookLineage {
  const prints = store.runFootprints(notebookId);
  const stored = store.passes(notebookId, passLimit);
  const byId = new Map<string, LineageFeeder>();
  const feederFor = (runId: string): LineageFeeder | undefined => {
    if (byId.has(runId)) return byId.get(runId);
    const run = runs.getRun(runId);
    if (!run) return undefined;
    const f = prints.get(runId);
    const feeder: LineageFeeder = { run: toLineageRun(run), ...(f?.found !== undefined ? { found: f.found } : {}), kinds: f?.kinds ?? {}, seenAgain: f?.seenAgain ?? 0, subRuns: [] };
    byId.set(runId, feeder);
    return feeder;
  };
  const inPass = new Set(stored.flatMap((p) => p.runIds));
  const passes: LineagePass[] = stored.map((p) => ({
    id: p.id, kind: p.kind, startedAt: p.startedAt,
    ...(p.finishedAt ? { finishedAt: p.finishedAt } : {}), ...(p.note ? { note: p.note } : {}),
    feeders: p.runIds.map(feederFor).filter((f): f is LineageFeeder => !!f),
  }));
  // Runs from before passes were kept: one pass each.
  for (const runId of prints.keys()) {
    if (inPass.has(runId)) continue;
    const f = feederFor(runId);
    if (f) passes.push({ id: `run:${runId}`, kind: 'earlier', startedAt: f.run.startedAt, feeders: [f] });
  }
  passes.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const shownPasses = passes.slice(0, passLimit);
  const feeders = [...prints.keys()].map(feederFor).filter((f): f is LineageFeeder => !!f)
    .sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
  const shown = feeders.slice(0, limit);
  for (const f of new Set([...shown, ...shownPasses.flatMap((p) => p.feeders)])) f.subRuns = collectSubRunTree(runs, f.run.id).map(toLineageRun);
  return { feeders: shown, more: Math.max(0, feeders.length - shown.length), passes: shownPasses };
}
