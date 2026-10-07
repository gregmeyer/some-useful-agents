/**
 * A notebook's pipeline (goal surfaces G2–G3): run each agent in order with
 * the notebook's goal as context, then have the notebook keeper turn what it
 * found into entries (options, evidence, notes, ruled-out decisions), skipping
 * anything the notebook already has. Entries carry the agent and run they came
 * from. One pipeline run per notebook at a time.
 */
import { randomUUID } from 'node:crypto';
import {
  NotebookStore, SYSTEM_AGENT_IDS, executeAgentDag, extractTaggedJson, entryKey, cleanData, cleanSources, optionFingerprint, NOTEBOOK_ENTRY_KINDS,
  type Agent, type Notebook, type NotebookEntryKind,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { keepPhotos } from './notebook-photos.js';
import { startNotebookPictures } from './notebook-pictures.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_KEEPER_ID = 'notebook-keeper';
/** The "agent" a setup pass is kept as: no search, just the goal and what the notebook has. */
export const NOTEBOOK_SETUP = 'notebook-setup';
const OUTPUT_CAP = 12_000;
const MAX_ENTRIES_PER_RUN = 12;

/** The notebook in a few lines, for an agent's goal-like inputs. */
export function notebookBrief(nb: Notebook): string {
  return [
    nb.statement || nb.title,
    nb.params.length ? `Parameters: ${nb.params.join('; ')}` : '',
    nb.criteria.length ? `Done when: ${nb.criteria.map((c) => c.text).join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * What a pipeline agent is given: the notebook as its goal, in whichever
 * goal-like inputs it declares. Everything else keeps its default.
 */
export function pipelineInputs(agent: Pick<Agent, 'inputs'>, nb: Notebook): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(agent.inputs ?? {})) {
    const n = name.toUpperCase();
    if (n === 'NOTEBOOK' || n === 'NOTEBOOK_CONTEXT' || n === 'GOAL' || n === 'BRIEF') out[name] = notebookBrief(nb);
    else if (n === 'TOPIC' || n === 'QUERY' || n === 'QUESTION' || n === 'SEARCH') out[name] = nb.statement || nb.title;
  }
  return out;
}

export interface KeeperOutcome {
  added: number;
  /** Options the notebook already had, found again and refreshed. */
  refreshed?: number;
  /** Setup: options given their facts. */
  factsSet?: number;
  skipped: number;
  criteriaMet: number;
  summary?: string;
  error?: string;
}

/**
 * Apply the keeper's <notebook> block: add new entries (skipping titles the
 * notebook already has), tick criteria it showed are met (with a note saying
 * why). Pure apart from the store, so it's tested without a model.
 */
export function applyKeeperResult(store: NotebookStore, nb: Notebook, agentId: string, runId: string, raw: string): KeeperOutcome {
  const block = extractTaggedJson(raw, 'notebook');
  if (!block) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The keeper gave no <notebook> block.' };
  let parsed: { entries?: unknown; criteriaMet?: unknown; summary?: unknown; fields?: unknown; stages?: unknown; facts?: unknown; checks?: unknown; sources?: unknown };
  try { parsed = JSON.parse(block) as typeof parsed; } catch { return { added: 0, skipped: 0, criteriaMet: 0, error: "The keeper's block wasn't JSON." }; }
  const searchAt = new Date().toISOString();
  // A notebook's fields are set once, by the first run that finds options.
  if (nb.fields.length === 0 && Array.isArray(parsed.fields) && parsed.fields.length > 0) {
    nb = store.setFields(nb.id, parsed.fields);
    store.backfillOptions(nb.id);
  }
  // Stages too, once; existing options start at the first.
  if (nb.stages.length === 0 && Array.isArray(parsed.stages) && parsed.stages.length > 0) {
    nb = store.setStages(nb.id, parsed.stages);
  }
  if (nb.checks.length === 0 && Array.isArray(parsed.checks) && parsed.checks.length > 0) {
    nb = store.setChecks(nb.id, parsed.checks);
  }
  // Setup: facts for options the notebook already has, by id.
  let factsSet = 0;
  for (const f of Array.isArray(parsed.facts) ? parsed.facts.slice(0, 100) : []) {
    const x = f as { id?: unknown; data?: unknown; fingerprint?: unknown };
    if (typeof x.id !== 'string' || !x.data || typeof x.data !== 'object') continue;
    if (store.setOptionFacts(nb.id, x.id, x.data as Record<string, unknown>, typeof x.fingerprint === 'string' ? x.fingerprint : undefined)) factsSet++;
  }
  const seen = new Set(store.entries(nb.id, 1000).map((e) => entryKey(e.title)));
  let added = 0;
  let refreshed = 0;
  let skipped = 0;
  let ruledOutSeen = 0;
  for (const e of (Array.isArray(parsed.entries) ? parsed.entries : []).slice(0, MAX_ENTRIES_PER_RUN)) {
    const x = e as { kind?: unknown; title?: unknown; body?: unknown; data?: unknown; fingerprint?: unknown };
    if (typeof x.title !== 'string' || !(NOTEBOOK_ENTRY_KINDS as readonly string[]).includes(String(x.kind))) { skipped++; continue; }
    const body = typeof x.body === 'string' ? x.body : '';
    const key = entryKey(x.title);
    if (x.kind === 'option') {
      const data = x.data && typeof x.data === 'object' ? x.data as Record<string, unknown> : undefined;
      const fingerprint = typeof x.fingerprint === 'string' ? x.fingerprint : undefined;
      // With a fingerprint (or a link) the store decides new vs. seen again; without, fall back to the title.
      if (!optionFingerprint(fingerprint, cleanData(data, nb.fields), nb.fields) && (!key || seen.has(key))) { skipped++; continue; }
      const r = store.upsertOption(nb.id, { title: x.title, body, data, fingerprint, by: `agent:${agentId}`, runId });
      if (r.ruledOut) { skipped++; ruledOutSeen++; }
      else if (r.seenAgain) refreshed++;
      else { added++; seen.add(key); }
      continue;
    }
    if (!key || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    store.addEntry(nb.id, { kind: x.kind as NotebookEntryKind, title: x.title, body, by: `agent:${agentId}`, runId });
    added++;
  }
  // The search counts even when everything it found was known: that's how a
  // later "not in the last 2 searches" knows someone looked.
  if (agentId !== NOTEBOOK_SETUP) store.recordSearch(nb.id, agentId, runId, added + refreshed + ruledOutSeen, searchAt, cleanSources(parsed.sources));
  let criteriaMet = 0;
  for (const c of Array.isArray(parsed.criteriaMet) ? parsed.criteriaMet : []) {
    const x = c as { index?: unknown; why?: unknown };
    const i = Number(x.index);
    const cur = store.get(nb.id);
    if (!cur || !Number.isInteger(i) || !cur.criteria[i] || cur.criteria[i].met) continue;
    store.markCriterion(nb.id, i, true);
    store.addEntry(nb.id, { kind: 'note', title: `Met: ${cur.criteria[i].text}`, body: typeof x.why === 'string' ? x.why : '', by: `agent:${agentId}`, runId });
    criteriaMet++;
  }
  return { added, ...(refreshed ? { refreshed } : {}), ...(factsSet ? { factsSet } : {}), skipped, criteriaMet, ...(typeof parsed.summary === 'string' ? { summary: parsed.summary.slice(0, 200) } : {}) };
}

/** Run the keeper over one agent's output; returns what it added. */
export async function keepIntoNotebook(ctx: Ctx, nb: Notebook, agentId: string, runId: string, output: string): Promise<KeeperOutcome> {
  return keep(ctx, NotebookStore.fromHandle(ctx.runStore.databaseHandle()), nb, agentId, runId, output);
}

async function keep(ctx: Ctx, store: NotebookStore, nb: Notebook, agentId: string, runId: string, output: string): Promise<KeeperOutcome> {
  const setup = agentId === NOTEBOOK_SETUP;
  // Setup needs each option's id and text, to give it its facts.
  const existing = store.entries(nb.id, 200).map((e) => `${e.kind}: ${e.title}${setup && e.kind === 'option' ? ` [id: ${e.id}]${e.body ? ` — ${e.body.replace(/\s+/g, ' ').slice(0, 400)}` : ''}` : ''}${e.fingerprint ? ` [fingerprint: ${e.fingerprint}]` : ''}${e.ruledOut ? ` — RULED OUT: ${e.ruledOut.reason}` : e.stage ? ` (stage: ${e.stage})` : ''}`).join('\n');
  const inputs = {
    NOTEBOOK: JSON.stringify({ title: nb.title, statement: nb.statement, params: nb.params, criteria: nb.criteria.map((c, index) => ({ index, text: c.text, met: c.met })), fields: nb.fields }),
    SOURCE_AGENT: agentId,
    RUN_OUTPUT: output.length > OUTPUT_CAP ? `${output.slice(0, OUTPUT_CAP)}\n(truncated)` : output,
    EXISTING: existing || '(nothing yet)',
  };
  let result: string | undefined;
  if (ctx.notebookKeeperRun) {
    result = await ctx.notebookKeeperRun(inputs);
  } else {
    if (!ensureSystemAgentCurrent(ctx, NOTEBOOK_KEEPER_ID, 'notebook pipeline')) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The notebook keeper agent is missing.' };
    const keeper = ctx.agentStore.getAgent(NOTEBOOK_KEEPER_ID);
    if (!keeper) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The notebook keeper agent is missing.' };
    const keepRunId = randomUUID();
    const ac = new AbortController();
    ctx.activeRuns.set(keepRunId, ac);
    try {
      // No onRunFailure: a keeper hiccup shouldn't open an inbox thread.
      await executeAgentDag(keeper, { triggeredBy: 'dashboard', runId: keepRunId, signal: ac.signal, inputs }, {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot,
        llmSettings: buildLlmSettingsSnapshot(ctx),
        spawnNode: ctx.workflowSpawnNode,
      });
    } finally {
      ctx.activeRuns.delete(keepRunId);
    }
    const run = ctx.runStore.getRun(keepRunId);
    if (!run || run.status !== 'completed' || !run.result) return { added: 0, skipped: 0, criteriaMet: 0, error: run?.error ?? 'The keeper did not finish.' };
    result = run.result;
  }
  if (!result) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The keeper did not finish.' };
  const out = applyKeeperResult(store, store.get(nb.id) ?? nb, agentId, runId, result);
  // Photos for what it found; a slow or failing site never fails the keep.
  try { await keepPhotos(store, nb.id); } catch { /* photos are a nicety */ }
  // Options still without one get a representative picture or a drawing, in the background.
  try { startNotebookPictures(ctx, nb.id); } catch { /* pictures are a nicety */ }
  return out;
}

export function pipelineRunning(ctx: Ctx, notebookId: string) {
  return ctx.notebookPipelines?.get(notebookId);
}

/**
 * Run the notebook's pipeline once, start to finish. Returns false when it's
 * already running (or there's nothing to run). Errors become the run's note;
 * nothing throws to the caller.
 */
export function startNotebookPipeline(ctx: Ctx, notebookId: string): { started: boolean; reason?: string } {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!nb) return { started: false, reason: 'No such notebook.' };
  if (nb.status !== 'active') return { started: false, reason: 'Reopen the notebook to run its pipeline.' };
  if (nb.pipeline.length === 0) return { started: false, reason: 'Add agents to the pipeline under Edit first.' };
  ctx.notebookPipelines ??= new Map();
  if (ctx.notebookPipelines.has(notebookId)) return { started: false, reason: 'Its pipeline is already running.' };
  ctx.notebookPipelines.set(notebookId, { agentId: nb.pipeline[0], step: 1, of: nb.pipeline.length, startedAt: Date.now() });
  void runPipeline(ctx, store, nb).finally(() => ctx.notebookPipelines?.delete(notebookId));
  return { started: true };
}

async function runPipeline(ctx: Ctx, store: NotebookStore, nb: Notebook): Promise<void> {
  const notes: string[] = [];
  let total = 0;
  for (const [i, agentId] of nb.pipeline.entries()) {
    ctx.notebookPipelines?.set(nb.id, { agentId, step: i + 1, of: nb.pipeline.length, startedAt: Date.now() });
    const agent = ctx.agentStore.getAgent(agentId);
    if (!agent || agent.status === 'archived') { notes.push(`${agentId}: not installed`); continue; }
    try {
      const run = await runDispatchedAgentToTerminal(ctx, agent, pipelineInputs(agent, nb));
      if (run.status !== 'completed') { notes.push(`${agentId}: ${run.status}${run.error ? ` (${run.error.slice(0, 80)})` : ''}`); continue; }
      const out = await keep(ctx, store, nb, agentId, run.id, run.result ?? '');
      total += out.added;
      notes.push(out.error ? `${agentId}: ran, but ${out.error}` : `${agentId}: ${String(out.added)} new${out.refreshed ? `, ${String(out.refreshed)} seen again` : ''}${out.criteriaMet ? `, ${String(out.criteriaMet)} criteria met` : ''}`);
    } catch (err) {
      notes.push(`${agentId}: ${err instanceof Error ? err.message.slice(0, 80) : 'failed'}`);
    }
  }
  store.noteRun(nb.id, `${String(total)} new entr${total === 1 ? 'y' : 'ies'} · ${notes.join(' · ')}`);
}

/**
 * Set a notebook up (fields, stages, and facts for the options it already
 * has) with one keeper pass and no search. Runs in the background, once per
 * notebook at a time; marks the notebook so a page visit doesn't retry it.
 */
export function startNotebookSetup(ctx: Ctx, notebookId: string, opts: { onDone?: () => void } = {}): boolean {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!nb || nb.fields.length > 0) return false;
  ctx.notebookSetups ??= new Set();
  if (ctx.notebookSetups.has(notebookId)) return false;
  ctx.notebookSetups.add(notebookId);
  store.markSetup(notebookId);
  void keep(ctx, store, nb, NOTEBOOK_SETUP, randomUUID(), '(Nothing was searched: set this notebook up from its goal and the entries it already has.)')
    .catch(() => { /* the page still works without fields */ })
    .finally(() => {
      ctx.notebookSetups?.delete(notebookId);
      try { opts.onDone?.(); } catch { /* a greeting is a nicety */ }
    });
  return true;
}

export function setupRunning(ctx: Ctx, notebookId: string): boolean {
  return !!ctx.notebookSetups?.has(notebookId);
}

// ── Runs not in the notebook yet ──
// Only a run started from the notebook's conversation (or its pipeline) is
// filed automatically. A run of one of its agents started anywhere else (its
// Run button, a schedule) is offered on the page: Add to notebook.

const UNFILED_DAYS = 14;

export interface UnfiledRun { id: string; agentId: string; startedAt: string }

/** Finished runs of this notebook's agents, from the last two weeks, that aren't in it yet (newest first). */
export function unfiledRuns(ctx: Ctx, nb: Notebook, limit = 5): UnfiledRun[] {
  const s = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const { agents, runIds } = s.runSources(nb.id);
  const filed = new Set(runIds);
  const since = Date.now() - UNFILED_DAYS * 86_400_000;
  const out: UnfiledRun[] = [];
  for (const agentId of agents) {
    if (agentId === NOTEBOOK_SETUP || SYSTEM_AGENT_IDS.has(agentId)) continue;
    for (const r of ctx.runStore.listRuns({ agentName: agentId, status: 'completed', limit: 10 })) {
      // A run another agent started is part of its parent's search, not one to file on its own.
      if (filed.has(r.id) || r.parentRunId || !r.result || Date.parse(r.startedAt) < since) continue;
      out.push({ id: r.id, agentId, startedAt: r.startedAt });
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

/** Runs being added to a notebook right now (run id), so a second click doesn't add one twice. */
export function addingRun(ctx: Ctx, runId: string): boolean {
  return !!ctx.notebookAddingRuns?.has(runId);
}

/** File one of the notebook's unfiled runs into it, in the background. */
export function addRunToNotebook(ctx: Ctx, notebookId: string, runId: string): { started: boolean; reason?: string } {
  const s = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = s.get(notebookId);
  if (!nb) return { started: false, reason: 'No such notebook.' };
  if (nb.status !== 'active') return { started: false, reason: 'This notebook is closed. Reopen it under Edit to add to it.' };
  const run = unfiledRuns(ctx, nb, 50).find((r) => r.id === runId);
  if (!run) return { started: false, reason: 'That run is already in the notebook, or it isn\'t one of its agents\' finished runs.' };
  if (addingRun(ctx, runId)) return { started: false, reason: 'That run is being added already.' };
  const result = ctx.runStore.getRun(runId)?.result ?? '';
  (ctx.notebookAddingRuns ??= new Set()).add(runId);
  void keepIntoNotebook(ctx, nb, run.agentId, runId, result)
    .catch(() => undefined)
    .finally(() => { ctx.notebookAddingRuns?.delete(runId); });
  return { started: true };
}
