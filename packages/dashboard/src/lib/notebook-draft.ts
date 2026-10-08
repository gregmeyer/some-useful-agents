/**
 * New notebook from a sentence (canvas artboard 28): sua's `notebook-drafter`
 * turns what you said into a draft (title, limits, done-when, what to note,
 * checks, stages, which of your agents search), cleaned here and shown for
 * you to edit. Nothing is created until you start it. Drafts live in memory
 * for an hour; one per id.
 */
import { randomUUID } from 'node:crypto';
import {
  NotebookStore, SYSTEM_AGENT_IDS, cleanFields, executeAgentDag, extractTaggedJson, validateScheduleInterval,
  type NotebookField,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_DRAFTER_ID = 'notebook-drafter';
const KEEP_MS = 60 * 60 * 1000;

export interface NotebookDraft {
  title: string;
  statement: string;
  params: string[];
  criteria: string[];
  fields: NotebookField[];
  checks: string[];
  stages: string[];
  pipeline: string[];
  cadence: string;
  why?: string;
}

export type DraftState =
  | { status: 'working'; text: string; at: number }
  | { status: 'ready'; text: string; at: number; draft: NotebookDraft }
  | { status: 'failed'; text: string; at: number; error: string };

const phrases = (v: unknown, n: number, len: number): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, len))
    .filter(Boolean)
    .filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
    .slice(0, n);

/**
 * The agents that could search for a notebook: active, yours, not sua's own.
 * Ones that already fill a notebook come first, with the notebooks they fill.
 */
export function searchAgents(ctx: Ctx): Array<{ id: string; description: string; feeds?: string[] }> {
  const feeds = NotebookStore.fromHandle(ctx.runStore.databaseHandle()).notebooksByAgent(SYSTEM_AGENT_IDS);
  return ctx.agentStore.listAgents()
    .filter((a) => a.status === 'active' && !SYSTEM_AGENT_IDS.has(a.id))
    .map((a) => ({
      id: a.id, description: (a.description ?? a.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
      ...(feeds.has(a.id) ? { feeds: feeds.get(a.id)!.map((n) => n.title) } : {}),
    }))
    .sort((x, y) => Number(!!y.feeds) - Number(!!x.feeds))
    .slice(0, 60);
}

/** The drafter's <draft> as a clean draft, or why it isn't one. Pure. */
export function parseNotebookDraft(raw: string, agentIds: ReadonlySet<string>): NotebookDraft | { error: string } {
  const block = extractTaggedJson(raw, 'draft');
  if (!block) return { error: "sua didn't come back with a draft." };
  let v: Record<string, unknown>;
  try { v = JSON.parse(block) as Record<string, unknown>; } catch { return { error: "sua's draft wasn't readable." }; }
  const title = typeof v.title === 'string' ? v.title.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!title) return { error: "sua's draft had no title. Try saying a little more." };
  let cadence = typeof v.cadence === 'string' ? v.cadence.trim() : '';
  if (cadence) { try { validateScheduleInterval(cadence, {}); } catch { cadence = ''; } }
  return {
    title,
    statement: typeof v.statement === 'string' ? v.statement.replace(/\s+/g, ' ').trim().slice(0, 400) : '',
    params: phrases(v.params, 10, 80),
    criteria: phrases(v.criteria, 6, 120),
    fields: cleanFields(Array.isArray(v.fields) ? v.fields : []).slice(0, 10),
    checks: phrases(v.checks, 5, 60),
    stages: phrases(v.stages, 6, 30),
    pipeline: phrases(v.pipeline, 6, 60).filter((id) => agentIds.has(id)),
    cadence,
    ...(typeof v.why === 'string' && v.why.trim() ? { why: v.why.trim().slice(0, 240) } : {}),
  };
}

export function readDraft(ctx: Ctx, id: string): DraftState | undefined {
  const d = ctx.notebookDrafts?.get(id);
  if (d && Date.now() - d.at > KEEP_MS) { ctx.notebookDrafts!.delete(id); return undefined; }
  return d;
}

/** Start drafting in the background; returns the draft's id. `from` is a draft to change. */
export function startNotebookDraft(ctx: Ctx, text: string, from?: { draft: NotebookDraft; change: string }): string | { error: string } {
  const said = text.replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!said) return { error: 'Say what the notebook is for first.' };
  const fake = ctx.notebookDrafterRun;
  if (!fake && !ensureSystemAgentCurrent(ctx, NOTEBOOK_DRAFTER_ID, 'notebook drafts')) return { error: "sua couldn't start the notebook drafter." };
  const agent = fake ? undefined : ctx.agentStore.getAgent(NOTEBOOK_DRAFTER_ID);
  if (!fake && !agent) return { error: "sua couldn't start the notebook drafter." };
  const agents = searchAgents(ctx);
  const ids = new Set(agents.map((a) => a.id));
  const id = randomUUID();
  ctx.notebookDrafts ??= new Map();
  // Old drafts go; the map stays small.
  for (const [k, d] of ctx.notebookDrafts) if (Date.now() - d.at > KEEP_MS) ctx.notebookDrafts.delete(k);
  ctx.notebookDrafts.set(id, { status: 'working', text: said, at: Date.now() });
  const inputs = {
    TEXT: said,
    TODAY: new Date().toISOString().slice(0, 10),
    AGENTS: agents.length ? agents.map((a) => `${a.id}: ${a.description}${a.feeds ? ` [already fills: ${a.feeds.slice(0, 3).join('; ')}]` : ''}`).join('\n') : '(none)',
    CURRENT: from ? JSON.stringify(from.draft) : '',
    CHANGE: from?.change.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '',
  };
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  const done = (s: DraftState) => { ctx.notebookDrafts?.set(id, s); };
  void (async () => {
    try {
      let result: string | undefined;
      let error: string | undefined;
      if (fake) result = await fake(inputs);
      else {
        await executeAgentDag(agent!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
          runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
          dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
        });
        const run = ctx.runStore.getRun(runId);
        if (run?.status === 'completed') result = run.result ?? undefined;
        else error = run?.error ?? 'sua stopped before it finished.';
      }
      const parsed = result ? parseNotebookDraft(result, ids) : { error: error ?? "sua didn't come back with a draft." };
      done('error' in parsed ? { status: 'failed', text: said, at: Date.now(), error: parsed.error } : { status: 'ready', text: said, at: Date.now(), draft: parsed });
    } catch (err) {
      done({ status: 'failed', text: said, at: Date.now(), error: err instanceof Error ? err.message : String(err) });
    } finally {
      ctx.activeRuns.delete(runId);
    }
  })();
  return id;
}
