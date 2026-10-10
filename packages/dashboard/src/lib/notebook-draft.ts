/**
 * New notebook from a sentence (canvas artboard 28): sua's `notebook-drafter`
 * turns what you said into a draft (title, limits, done-when, what to note,
 * checks, stages, which of your agents search), cleaned here and shown for
 * you to edit. Nothing is created until you start it. Drafts are kept in the
 * database (NotebookStore's notebook_drafts) with your edits, so leaving the
 * page or a restart doesn't lose one; they go when started or discarded, or
 * after two weeks untouched.
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
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
/** A draft still "working" this long after it started was cut off (a restart): it reads as failed. */
const STALE_WORKING_MS = 10 * 60 * 1000;

export interface NotebookDraft {
  title: string;
  statement: string;
  params: string[];
  criteria: string[];
  fields: NotebookField[];
  checks: string[];
  stages: string[];
  pipeline: string[];
  /** The agents sua suggested, so one you unticked is still offered after a reload. */
  suggested?: string[];
  cadence: string;
  why?: string;
}

export type DraftState =
  | { status: 'working'; text: string; at: number; draft?: NotebookDraft }
  /** `error`: a change sua couldn't make; the draft is the one before it. */
  | { status: 'ready'; text: string; at: number; draft: NotebookDraft; error?: string }
  | { status: 'failed'; text: string; at: number; error: string };

const draftsOf = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());

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

function toState(r: { status: string; text: string; draft?: unknown; error?: string; updatedAt: string }): DraftState {
  const at = Date.parse(r.updatedAt);
  const draft = r.draft as NotebookDraft | undefined;
  if (r.status === 'working') {
    if (Date.now() - at <= STALE_WORKING_MS) return { status: 'working', text: r.text, at, ...(draft ? { draft } : {}) };
    // Cut off (the dashboard restarted mid-draft): back to the last draft, else failed.
    const why = 'sua stopped before it finished. Draft it again.';
    return draft ? { status: 'ready', text: r.text, at, draft, error: why } : { status: 'failed', text: r.text, at, error: why };
  }
  if (r.status === 'ready' && draft) return { status: 'ready', text: r.text, at, draft, ...(r.error ? { error: r.error } : {}) };
  return { status: 'failed', text: r.text, at, error: r.error ?? "sua couldn't draft it." };
}

export function readDraft(ctx: Ctx, id: string): DraftState | undefined {
  const r = draftsOf(ctx).getDraft(id);
  if (!r) return undefined;
  if (Date.now() - Date.parse(r.updatedAt) > KEEP_MS) { draftsOf(ctx).deleteDraft(id); return undefined; }
  return toState(r);
}

/** Drafts not started yet (newest first), for "pick up where you left off". */
export function listDrafts(ctx: Ctx): Array<{ id: string } & DraftState> {
  return draftsOf(ctx).listDrafts(10)
    .filter((r) => Date.now() - Date.parse(r.updatedAt) <= KEEP_MS)
    .map((r) => ({ id: r.id, ...toState(r) }));
}

export function discardDraft(ctx: Ctx, id: string): boolean {
  return draftsOf(ctx).deleteDraft(id);
}

const formList = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === 'string');

/**
 * Keep what you changed on the draft (its form, as it posts to POST
 * /notebooks), so it's there when you come back. Only a ready draft.
 */
export function saveDraftEdits(ctx: Ctx, id: string, body: Record<string, unknown>): boolean {
  const cur = readDraft(ctx, id);
  if (!cur || cur.status !== 'ready') return false;
  const clean = (v: string[], n: number, len: number) => phrases(v, n, len);
  const fields = formList(body.field).map((f) => { try { return JSON.parse(f) as unknown; } catch { return undefined; } }).filter(Boolean);
  let cadence = typeof body.cadence === 'string' ? body.cadence.trim() : cur.draft.cadence;
  if (cadence) { try { validateScheduleInterval(cadence, {}); } catch { cadence = cur.draft.cadence; } }
  const suggested = cur.draft.suggested ?? cur.draft.pipeline;
  const draft: NotebookDraft = {
    title: typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, 80) : cur.draft.title,
    statement: typeof body.statement === 'string' ? body.statement.trim().slice(0, 400) : cur.draft.statement,
    params: clean(formList(body.params), 10, 80),
    criteria: clean(formList(body.criteria), 6, 120),
    fields: cleanFields(fields).slice(0, 10),
    checks: clean(formList(body.checks), 5, 60),
    stages: formList(body.stages).flatMap((x) => x.split(/\s*(?:→|->|,)\s*/)).map((x) => x.trim()).filter(Boolean).slice(0, 6),
    pipeline: formList(body.pipeline).filter((a) => suggested.includes(a)),
    suggested,
    cadence,
    ...(cur.draft.why ? { why: cur.draft.why } : {}),
  };
  draftsOf(ctx).saveDraft(id, { status: 'ready', text: cur.text, draft });
  return true;
}

/** Start drafting in the background; returns the draft's id. `from` is a draft to change (it keeps its id). */
export function startNotebookDraft(ctx: Ctx, text: string, from?: { id: string; draft: NotebookDraft; change: string }): string | { error: string } {
  const said = text.replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!said) return { error: 'Say what the notebook is for first.' };
  const fake = ctx.notebookDrafterRun;
  if (!fake && !ensureSystemAgentCurrent(ctx, NOTEBOOK_DRAFTER_ID, 'notebook drafts')) return { error: "sua couldn't start the notebook drafter." };
  const agent = fake ? undefined : ctx.agentStore.getAgent(NOTEBOOK_DRAFTER_ID);
  if (!fake && !agent) return { error: "sua couldn't start the notebook drafter." };
  const agents = searchAgents(ctx);
  const ids = new Set(agents.map((a) => a.id));
  const id = from?.id ?? randomUUID();
  const store = draftsOf(ctx);
  // Drafts untouched for two weeks go.
  store.pruneDrafts(new Date(Date.now() - KEEP_MS).toISOString());
  store.saveDraft(id, { status: 'working', text: said, ...(from ? { draft: from.draft } : {}) });
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
  // Discarded while sua worked: don't bring it back.
  const done = (s: DraftState) => {
    if (!store.getDraft(id)) return;
    if (s.status === 'failed' && from) { store.saveDraft(id, { status: 'ready', text: said, draft: from.draft, error: `sua couldn't change it: ${s.error}` }); return; }
    store.saveDraft(id, s.status === 'ready' ? { status: 'ready', text: said, draft: { ...s.draft, suggested: s.draft.pipeline } } : { status: s.status, text: said, ...(s.status === 'failed' ? { error: s.error } : {}) });
  };
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
