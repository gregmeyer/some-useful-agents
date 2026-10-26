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
  NotebookStore, SYSTEM_AGENT_IDS, cleanFields, cleanSteps, executeAgentDag, extractTaggedJson, validateScheduleInterval,
  type NotebookField, type NotebookStep,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { fitStepAgents } from './notebook-steps.js';

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
  /** The work in steps, in order (profile, find, source, check, decide), each with its agent. */
  steps?: NotebookStep[];
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

/**
 * Steps as the drafter or the form gives them ({title, kind, agent|agentId,
 * target}): cleaned, and an agent kept only when it's one of yours (else the
 * step needs one; a check or find step uses sua's checker or finder).
 */
export function draftSteps(raw: unknown, agentIds: ReadonlySet<string>): { steps?: NotebookStep[] } {
  const list = (Array.isArray(raw) ? raw : []).map((x) => {
    if (!x || typeof x !== 'object') return x;
    const o = x as Record<string, unknown>;
    const agent = typeof o.agentId === 'string' ? o.agentId : typeof o.agent === 'string' ? o.agent : '';
    return { title: o.title, kind: o.kind, ...(agentIds.has(agent) ? { agentId: agent } : {}), ...(o.target !== undefined && o.target !== '' ? { target: Number(o.target) } : {}), ...(Array.isArray(o.facts) ? { facts: o.facts } : {}), ...(typeof o.subject === 'string' ? { subject: o.subject } : {}), ...(o.shape === 'answer' || o.shape === 'plan' ? { shape: o.shape } : {}) };
  });
  const steps = cleanSteps(list).map(({ status: _s, tries: _t, note: _n, doneAt: _d, ...rest }) => ({ ...rest, status: 'todo' as const, tries: 0 }));
  return steps.length ? { steps } : {};
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
    ...draftSteps(v.steps, agentIds),
    cadence,
    // A long one ends at a sentence (else a word) with "…", never mid-word.
    ...(typeof v.why === 'string' && v.why.trim() ? { why: clipSentence(v.why.replace(/\s+/g, ' ').trim(), 400) } : {}),
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

/** The review form's steps (parallel step_title / step_kind / step_agent / step_target lists). */
export function stepsFromForm(body: Record<string, unknown>): Array<Record<string, string>> {
  const titles = formList(body.step_title);
  const kinds = formList(body.step_kind);
  const agents = formList(body.step_agent);
  const targets = formList(body.step_target);
  return titles.map((title, i) => ({ title, kind: kinds[i] ?? '', agentId: agents[i] ?? '', target: targets[i] ?? '' }));
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
    ...draftSteps(stepsFromForm(body), new Set(searchAgents(ctx).map((a) => a.id))),
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
  // Discarded while sua worked: don't bring it back.
  const done = (s: DraftState) => {
    if (!store.getDraft(id)) return;
    if (s.status === 'failed' && from) { store.saveDraft(id, { status: 'ready', text: said, draft: from.draft, error: `sua couldn't change it: ${s.error}` }); return; }
    store.saveDraft(id, s.status === 'ready' ? { status: 'ready', text: said, draft: { ...s.draft, suggested: s.draft.pipeline } } : { status: s.status, text: said, ...(s.status === 'failed' ? { error: s.error } : {}) });
  };
  void runDrafter(ctx, agent, inputs).then(({ result, error }) => {
    const parsed = result ? parseNotebookDraft(result, ids) : { error: error ?? "sua didn't come back with a draft." };
    done('error' in parsed ? { status: 'failed', text: said, at: Date.now(), error: parsed.error } : { status: 'ready', text: said, at: Date.now(), draft: parsed });
  });
  return id;
}

/** One drafter run: its answer, or why there isn't one. Never throws. */
export async function runDrafter(ctx: Ctx, agent: ReturnType<Ctx['agentStore']['getAgent']> | undefined, inputs: Record<string, string>): Promise<{ result?: string; error?: string }> {
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  try {
    if (ctx.notebookDrafterRun) return { result: await ctx.notebookDrafterRun(inputs) };
    await executeAgentDag(agent!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
      runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
      dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
    });
    const run = ctx.runStore.getRun(runId);
    return run?.status === 'completed' ? { result: run.result ?? undefined } : { error: run?.error ?? 'sua stopped before it finished.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    ctx.activeRuns.delete(runId);
  }
}

/**
 * A notebook started without steps (Skip the draft, or a draft that had
 * none): sua lays them out from its goal and what it tracks, the way a
 * draft would, changing nothing else. Returns the steps it set, if any;
 * never throws, and leaves steps someone set meanwhile alone.
 */
export async function layOutNotebookSteps(ctx: Ctx, notebookId: string): Promise<NotebookStep[] | undefined> {
  const store = draftsOf(ctx);
  const nb = store.get(notebookId);
  if (!nb || nb.steps?.length) return undefined;
  const text = (nb.statement || nb.title).replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!text) return undefined;
  if (!ctx.notebookDrafterRun && !ensureSystemAgentCurrent(ctx, NOTEBOOK_DRAFTER_ID, 'notebook steps')) return undefined;
  const agent = ctx.notebookDrafterRun ? undefined : ctx.agentStore.getAgent(NOTEBOOK_DRAFTER_ID);
  if (!ctx.notebookDrafterRun && !agent) return undefined;
  const agents = searchAgents(ctx);
  const current: NotebookDraft = {
    title: nb.title, statement: nb.statement, params: nb.params, criteria: nb.criteria.map((c) => c.text),
    fields: nb.fields, checks: nb.checks, stages: nb.stages, pipeline: nb.pipeline, steps: [], cadence: nb.cadence,
  };
  const { result } = await runDrafter(ctx, agent, {
    TEXT: text,
    TODAY: new Date().toISOString().slice(0, 10),
    AGENTS: agents.length ? agents.map((a) => `${a.id}: ${a.description}${a.feeds ? ` [already fills: ${a.feeds.slice(0, 3).join('; ')}]` : ''}`).join('\n') : '(none)',
    CURRENT: JSON.stringify(current),
    CHANGE: 'Lay out its "steps" (the work in order, starting with find and ending with decide). Keep everything else exactly as it is.',
  });
  const parsed = result ? parseNotebookDraft(result, new Set(agents.map((a) => a.id))) : undefined;
  const steps = parsed && !('error' in parsed) ? parsed.steps : undefined;
  if (!steps?.length) return undefined;
  // Someone set steps while sua worked: theirs stand.
  if (store.get(notebookId)?.steps?.length) return undefined;
  store.setSteps(notebookId, fitStepAgents(ctx, steps).steps);
  return store.get(notebookId)?.steps;
}

/** Text up to `n` characters: whole when it fits, else to the last full sentence, else the last word, with "…". Pure. */
export function clipSentence(t: string, n: number): string {
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  if (end > n * 0.5) return cut.slice(0, end + 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:—-]+$/, '')}…`;
}
