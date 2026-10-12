/**
 * Short filter labels for long facts (notebooks): when the options' values for
 * a text fact read as sentences ("Office-of-CFO suite: close, consolidation,
 * compliance, disclosure"), the `notebook-facets` agent groups them into a few
 * short labels, kept on the notebook (NotebookStore.setFacetLabels). Each
 * option then carries its labels (notebook-widgets optionFacets), and the
 * shortlist's chips read those. It runs in the background when a notebook's
 * page opens and some value has no label yet; a failed try waits a day.
 */
import { randomUUID } from 'node:crypto';
import { NotebookStore, executeAgentDag, extractTaggedJson, type Notebook, type NotebookEntry } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { notebookWidgetData, defaultFilters, facetValueKey } from './notebook-widgets.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_FACETS_ID = 'notebook-facets';
/** A fact whose values average more than this is too long for a chip, so it gets labels (option-filters.js MAX_CHIP_CHARS). */
export const LONG_FACT_CHARS = 32;
const RETRY_MS = 24 * 60 * 60 * 1000;
/** Values sent per fact in one run. */
const MAX_VALUES = 40;

export interface FacetWork { key: string; label: string; existing: string[]; values: string[] }

/**
 * The long facts that need labels: text facts the shortlist filters by,
 * whose values (among options in the running) average over LONG_FACT_CHARS,
 * with the values that have no label yet. Pure.
 */
export function facetWork(nb: Notebook, options: ReadonlyArray<{ fields: Record<string, unknown>; ruledOut?: unknown }>, now = Date.now()): FacetWork[] {
  const out: FacetWork[] = [];
  for (const key of defaultFilters(nb)) {
    const field = nb.fields.find((f) => f.key === key);
    if (!field) continue;
    const values = [...new Set(options.filter((o) => !o.ruledOut).map((o) => facetValueKey(o.fields[key])).filter(Boolean))];
    if (values.length < 2 || values.reduce((n, v) => n + v.length, 0) / values.length <= LONG_FACT_CHARS) continue;
    const kept = nb.facets?.[key];
    if (kept?.failedAt && now - Date.parse(kept.failedAt) < RETRY_MS) continue;
    const todo = values.filter((v) => !kept?.labels[v]).slice(0, MAX_VALUES);
    if (!todo.length) continue;
    out.push({ key, label: field.label, existing: [...new Set(Object.values(kept?.labels ?? {}))], values: todo });
  }
  return out;
}

/** Keep the agent's labels: each fact's numbered values → their label. Facts it didn't answer are marked failed. */
export function applyFacets(store: NotebookStore, notebookId: string, work: readonly FacetWork[], raw: string | undefined): number {
  let labelled = 0;
  let answer: Record<string, unknown> = {};
  try { answer = (JSON.parse(extractTaggedJson(raw ?? '', 'facets') ?? '{}') as { fields?: Record<string, unknown> }).fields ?? {}; } catch { answer = {}; }
  for (const w of work) {
    const groups = Array.isArray(answer[w.key]) ? answer[w.key] as unknown[] : [];
    const labels: Record<string, string> = {};
    for (const g of groups) {
      const { label, values } = (g ?? {}) as { label?: unknown; values?: unknown };
      if (typeof label !== 'string' || !label.trim() || !Array.isArray(values)) continue;
      for (const i of values) if (typeof i === 'number' && w.values[i] !== undefined && !labels[w.values[i]]) labels[w.values[i]] = label;
    }
    if (Object.keys(labels).length) { store.setFacetLabels(notebookId, w.key, labels); labelled += Object.keys(labels).length; }
    else store.markFacetsFailed(notebookId, w.key);
  }
  return labelled;
}

/** Label a notebook's long facts in the background, if any value needs one. Returns whether it started. */
export function startNotebookFacets(ctx: Ctx, notebookId: string, entries?: readonly NotebookEntry[]): boolean {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!nb || !nb.fields.length) return false;
  ctx.notebookFacets ??= new Set();
  if (ctx.notebookFacets.has(notebookId)) return false;
  const work = facetWork(nb, notebookWidgetData(nb, entries ?? store.entries(nb.id, 1000)).notebook.options);
  if (!work.length) return false;
  const fake = ctx.notebookFacetsRun;
  if (!fake && !ensureSystemAgentCurrent(ctx, NOTEBOOK_FACETS_ID, 'notebook filter labels')) return false;
  const agent = fake ? undefined : ctx.agentStore.getAgent(NOTEBOOK_FACETS_ID);
  if (!fake && !agent) return false;
  ctx.notebookFacets.add(notebookId);
  const inputs = { NOTEBOOK: nb.statement || nb.title, FIELDS: JSON.stringify(work.map((w) => ({ key: w.key, label: w.label, existing: w.existing, values: w.values }))) };
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  void (async () => {
    let result: string | undefined;
    try {
      if (fake) result = await fake(inputs);
      else {
        // No onRunFailure: a labelling hiccup shouldn't open an inbox thread.
        await executeAgentDag(agent!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
          runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
          dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
        });
        const run = ctx.runStore.getRun(runId);
        result = run?.status === 'completed' ? run.result ?? undefined : undefined;
      }
    } catch { result = undefined; }
    try { applyFacets(store, notebookId, work, result); } catch { /* the notebook is gone */ }
    ctx.activeRuns.delete(runId);
    ctx.notebookFacets?.delete(notebookId);
  })();
  return true;
}
