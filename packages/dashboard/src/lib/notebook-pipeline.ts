/**
 * A notebook's pipeline (goal surfaces G2–G3): run each agent in order with
 * the notebook's goal as context, then have the notebook keeper turn what it
 * found into entries (options, evidence, notes, ruled-out decisions), skipping
 * anything the notebook already has. Entries carry the agent and run they came
 * from. One pipeline run per notebook at a time.
 */
import { randomUUID } from 'node:crypto';
import {
  NotebookStore, executeAgentDag, extractTaggedJson, entryKey, NOTEBOOK_ENTRY_KINDS,
  type Agent, type Notebook, type NotebookEntryKind,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_KEEPER_ID = 'notebook-keeper';
const OUTPUT_CAP = 12_000;
const MAX_ENTRIES_PER_RUN = 8;

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
  let parsed: { entries?: unknown; criteriaMet?: unknown; summary?: unknown };
  try { parsed = JSON.parse(block) as typeof parsed; } catch { return { added: 0, skipped: 0, criteriaMet: 0, error: "The keeper's block wasn't JSON." }; }
  const seen = new Set(store.entries(nb.id, 1000).map((e) => entryKey(e.title)));
  let added = 0;
  let skipped = 0;
  for (const e of (Array.isArray(parsed.entries) ? parsed.entries : []).slice(0, MAX_ENTRIES_PER_RUN)) {
    const x = e as { kind?: unknown; title?: unknown; body?: unknown };
    if (typeof x.title !== 'string' || !(NOTEBOOK_ENTRY_KINDS as readonly string[]).includes(String(x.kind))) { skipped++; continue; }
    const key = entryKey(x.title);
    if (!key || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    store.addEntry(nb.id, { kind: x.kind as NotebookEntryKind, title: x.title, body: typeof x.body === 'string' ? x.body : '', by: `agent:${agentId}`, runId });
    added++;
  }
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
  return { added, skipped, criteriaMet, ...(typeof parsed.summary === 'string' ? { summary: parsed.summary.slice(0, 200) } : {}) };
}

/** Run the keeper over one agent's output; returns what it added. */
export async function keepIntoNotebook(ctx: Ctx, nb: Notebook, agentId: string, runId: string, output: string): Promise<KeeperOutcome> {
  return keep(ctx, NotebookStore.fromHandle(ctx.runStore.databaseHandle()), nb, agentId, runId, output);
}

async function keep(ctx: Ctx, store: NotebookStore, nb: Notebook, agentId: string, runId: string, output: string): Promise<KeeperOutcome> {
  if (!ensureSystemAgentCurrent(ctx, NOTEBOOK_KEEPER_ID, 'notebook pipeline')) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The notebook keeper agent is missing.' };
  const keeper = ctx.agentStore.getAgent(NOTEBOOK_KEEPER_ID);
  if (!keeper) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The notebook keeper agent is missing.' };
  const existing = store.entries(nb.id, 200).map((e) => `${e.kind}: ${e.title}`).join('\n');
  const keepRunId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(keepRunId, ac);
  try {
    // No onRunFailure: a keeper hiccup shouldn't open an inbox thread.
    await executeAgentDag(keeper, {
      triggeredBy: 'dashboard',
      runId: keepRunId,
      signal: ac.signal,
      inputs: {
        NOTEBOOK: JSON.stringify({ title: nb.title, statement: nb.statement, params: nb.params, criteria: nb.criteria.map((c, index) => ({ index, text: c.text, met: c.met })) }),
        SOURCE_AGENT: agentId,
        RUN_OUTPUT: output.length > OUTPUT_CAP ? `${output.slice(0, OUTPUT_CAP)}\n(truncated)` : output,
        EXISTING: existing || '(nothing yet)',
      },
    }, {
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
  return applyKeeperResult(store, store.get(nb.id) ?? nb, agentId, runId, run.result);
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
      notes.push(out.error ? `${agentId}: ran, but ${out.error}` : `${agentId}: ${String(out.added)} new${out.criteriaMet ? `, ${String(out.criteriaMet)} criteria met` : ''}`);
    } catch (err) {
      notes.push(`${agentId}: ${err instanceof Error ? err.message.slice(0, 80) : 'failed'}`);
    }
  }
  store.noteRun(nb.id, `${String(total)} new entr${total === 1 ? 'y' : 'ies'} · ${notes.join(' · ')}`);
}
