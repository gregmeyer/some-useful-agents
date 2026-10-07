/**
 * How a notebook was made: the runs that filed into it, the runs those
 * started (agent calls, loops, agents used as tools), and what each left in
 * the notebook. The notebook's Workflow view draws it as one graph, the way
 * a single run's DAG is drawn.
 */
import type { Run } from './types.js';
import type { NotebookEntryKind, NotebookStore } from './notebooks.js';

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

export interface NotebookLineage {
  /** Runs that filed into the notebook, newest first. */
  feeders: LineageFeeder[];
  /** Feeders not shown (older than the newest `limit`). */
  more: number;
}

const toLineageRun = (r: Run): LineageRun => ({
  id: r.id, agentId: r.agentName, status: r.status, startedAt: r.startedAt, triggeredBy: r.triggeredBy,
  ...(r.completedAt ? { completedAt: r.completedAt } : {}),
  ...(r.error ? { error: r.error.slice(0, 200) } : {}),
  ...(r.parentRunId ? { parentRunId: r.parentRunId } : {}),
  ...(r.parentNodeId ? { parentNodeId: r.parentNodeId } : {}),
});

/** The notebook's runs (newest `limit`), each with its sub-runs and what it left. */
export function notebookLineage(
  store: Pick<NotebookStore, 'runFootprints'>,
  runs: { getRun(id: string): Run | null; listChildRuns(id: string): Run[] },
  notebookId: string,
  limit = 12,
): NotebookLineage {
  const prints = store.runFootprints(notebookId);
  const feeders: LineageFeeder[] = [];
  for (const [runId, f] of prints) {
    const run = runs.getRun(runId);
    if (!run) continue;
    // A sub-run that filed directly is drawn under its parent, not as its own feeder.
    feeders.push({ run: toLineageRun(run), ...(f.found !== undefined ? { found: f.found } : {}), kinds: f.kinds, seenAgain: f.seenAgain, subRuns: [] });
  }
  feeders.sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
  const shown = feeders.slice(0, limit);
  for (const f of shown) f.subRuns = collectSubRunTree(runs, f.run.id).map(toLineageRun);
  return { feeders: shown, more: Math.max(0, feeders.length - shown.length) };
}
