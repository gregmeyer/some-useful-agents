/**
 * Changing Today's edition by asking (ADR-0076): "lead with markets", "drop
 * the evening routine", "what's stale?". The `edition-editor` agent sees the
 * edition with how fresh each part is (its age, whether its last run failed,
 * why it's shown, whether it can run again, the scheduler) and answers with
 * edition ops and actions (run a part again); they are checked here (only
 * agents that exist, only what the edition takes) and kept as a proposal:
 * one row per change, each applied or skipped on its own. Actions that cost a
 * run have their own Run button and are never inside "Apply all". Undo goes
 * back to before the whole ask. One ask at a time, kept in memory: a restart
 * drops a proposal nobody applied.
 */
import { randomUUID } from 'node:crypto';
import {
  EditionOpError, applyEditionOps, checkEditionActions, describeEditionAction, describeEditionOp, editionOpSchema, executeAgentDag, extractTaggedJson, SYSTEM_AGENT_IDS,
  type EditionAction, type EditionOp, type EditionPartFacts, type EditionPrefs,
} from '@some-useful-agents/core';
import { schedulerProblem } from './scheduler-tile.js';
import { lastRunInputs, startAgentRun } from '../routes/widget-run.js';
import { draftForBoard } from './board-build.js';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { withTileSignal } from '../views/pulse-tile-builder.js';
import { BoardsStore } from '@some-useful-agents/core';
import { editionKnownAgents } from './board-review.js';
import { TODAY_BOARD_ID, editionPrefsOf, editionPrefsStoreOf, editionWideNow, todayEdition } from './today-edition.js';

type Ctx = ReturnType<typeof getContext>;

export const EDITION_EDITOR_ID = 'edition-editor';
export const EDITION_ASK_MAX = 500;
const OPS_MAX = 8;

/** One row of a proposal: a change to how the edition is made, or a part to run again. */
export type EditionAskRow =
  | { kind: 'op'; op: EditionOp; text: string; state: 'open' | 'applied' | 'skipped' }
  | { kind: 'action'; action: EditionAction; text: string; state: 'open' | 'ran' | 'skipped' };

export interface EditionAsk {
  id: string;
  ask: string;
  status: 'running' | 'ready' | 'failed';
  /** The changes, checked; empty when sua says it can't be done here. */
  ops: EditionOp[];
  /** Each change in plain words. */
  changes: string[];
  /** Every change and action, in order, each with where it stands. */
  rows?: EditionAskRow[];
  /** A change from this ask was applied already: the next one keeps the same Undo point. */
  appliedAny?: boolean;
  /** sua's line on what will change, or why nothing will. */
  say?: string;
  error?: string;
  at: number;
}

/** The edition as the editor reads it: what's showing and where, what was left out, what could be brought in. */
export function editionForAsk(ctx: Ctx, nowMs = Date.now()): { edition: Record<string, unknown>; known: Set<string>; title: (id: string) => string; parts: Map<string, EditionPartFacts> } {
  const prefs = editionPrefsOf(ctx);
  const boards = new BoardsStore(ctx.runStore.databaseHandle());
  const title = (id: string) => boards.tileTitle(id) ?? ctx.agentStore.getAgent(id)?.name ?? id;
  const now = todayEdition(ctx);
  const showing = [...(now?.tiles.keys() ?? [])];
  const wide = now ? editionWideNow(now.doc) : new Set<string>();
  const lead = now?.doc.components.find((c) => c.id === 'lede')?.when;
  const known = editionKnownAgents(ctx);
  const on = new Set(showing);
  const could = [...known].filter((id) => !on.has(id) && !prefs.hidden.includes(id)).slice(0, 40);
  // How fresh each part is, from its tile: its age, a newer failed run, why it's shown, whether it can run again.
  const parts = new Map<string, EditionPartFacts & { why: 'scheduled' | 'always shown' }>();
  for (const id of showing) {
    const t = now!.tiles.get(id)!;
    const at = t.lastRun ? t.lastRun.completedAt ?? t.lastRun.startedAt : undefined;
    const agent = ctx.agentStore.getAgent(id);
    const needs = Object.values(agent?.inputs ?? {}).some((spec) => spec.required === true && spec.default === undefined);
    parts.set(id, {
      ageHours: at ? Math.max(0, Math.round((nowMs - Date.parse(at)) / 360_000) / 10) : 0,
      failed: !!t.failedRun,
      canRunAgain: agent?.status === 'active' && (!needs || Object.keys(lastRunInputs(ctx, agent)).length > 0),
      why: prefs.include.includes(id) ? 'always shown' : 'scheduled',
    });
  }
  const scheduler = schedulerProblem(ctx);
  return {
    edition: {
      ...(boards.goal(TODAY_BOARD_ID) ? { goal: boards.goal(TODAY_BOARD_ID)!.text } : {}),
      showing: showing.map((id) => { const f = parts.get(id)!; return { id, title: title(id), column: wide.has(id) ? 'wide' : 'narrow', ...(lead === id ? { leads: true } : {}), ageHours: f.ageHours, lastRun: f.failed ? 'failed' : 'ok', why: f.why, canRunAgain: f.canRunAgain }; }),
      scheduler: scheduler ? { running: false, says: scheduler } : { running: true },
      leftOut: prefs.hidden.map((id) => ({ id, title: title(id) })),
      couldShow: could.map((id) => ({ id, title: title(id), ...(ctx.agentStore.getAgent(id)?.description ? { about: ctx.agentStore.getAgent(id)!.description!.replace(/\s+/g, ' ').slice(0, 120) } : {}) })),
      numbersBand: prefs.numbers !== false,
      ...(prefs.topStory ? { topItemOf: prefs.topStory } : {}), ...(prefs.note ? { yourLine: prefs.note } : {}),
    },
    known, title, parts,
  };
}

/**
 * The editor's `<edition>` answer, checked against the preferences as they
 * are: every op must be one the edition takes and name a real agent, and
 * together they must apply. An answer with no ops is sua saying it can't be
 * done here. Undefined when there is no usable answer. Pure.
 */
export function parseEditionAnswer(raw: string | undefined, prefs: EditionPrefs, known: ReadonlySet<string>, title: (id: string) => string, parts: ReadonlyMap<string, EditionPartFacts> = new Map(), existing: ReadonlySet<string> = new Set()): { ops: EditionOp[]; changes: string[]; rows: EditionAskRow[]; say?: string } | { error: string } | undefined {
  const block = extractTaggedJson(raw ?? '', 'edition');
  if (!block) return undefined;
  let v: { ops?: unknown; actions?: unknown; say?: unknown };
  try { v = JSON.parse(block) as typeof v; } catch { return undefined; }
  if (!v || typeof v !== 'object') return undefined;
  // Its line is said only when it carries no number (ages and counts come from the rows, worked out here).
  const said = typeof v.say === 'string' ? v.say.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const say = /\d/.test(said) ? '' : said;
  const checked = checkEditionActions(Array.isArray(v.actions) ? v.actions : [], parts, existing);
  if ('error' in checked) return { error: checked.error };
  const actionRows: EditionAskRow[] = checked.actions.map((action) => ({ kind: 'action', action, text: describeEditionAction(action, title, parts), state: 'open' }));
  const list = Array.isArray(v.ops) ? v.ops.slice(0, OPS_MAX) : [];
  if (!list.length) return { ops: [], changes: [], rows: actionRows, ...(say ? { say } : {}) };
  const ops: EditionOp[] = [];
  for (const o of list) {
    const p = editionOpSchema.safeParse(o);
    if (!p.success) return { error: "sua came back with a change the edition doesn't take. Say it another way." };
    ops.push(p.data);
  }
  try { applyEditionOps(prefs, ops, known); } catch (err) {
    return { error: err instanceof EditionOpError ? err.message : 'Those changes could not be applied.' };
  }
  const changes = ops.map((op) => describeEditionOp(op, title));
  return { ops, changes, rows: [...ops.map((op, i): EditionAskRow => ({ kind: 'op', op, text: changes[i], state: 'open' })), ...actionRows], ...(say ? { say } : {}) };
}

async function runEditor(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
  if (ctx.editionEditorRun) return ctx.editionEditorRun(inputs);
  // Only the real dashboard runs the model; a page test that submits the box doesn't.
  if (!ctx.live) return undefined;
  if (!ensureSystemAgentCurrent(ctx, EDITION_EDITOR_ID, "changes to Today's edition")) return undefined;
  const agent = ctx.agentStore.getAgent(EDITION_EDITOR_ID);
  if (!agent) return undefined;
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  try {
    await executeAgentDag(agent, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
      runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
      dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
    });
    const run = ctx.runStore.getRun(runId);
    return run?.status === 'completed' ? run.result ?? undefined : undefined;
  } finally {
    ctx.activeRuns.delete(runId);
  }
}

/** Ask for a change, in the background. Returns the ask (running), or why not. */
export function startEditionAsk(ctx: Ctx, text: string): { ask?: EditionAsk; error?: string; work?: Promise<void> } {
  const said = text.replace(/\s+/g, ' ').trim().slice(0, EDITION_ASK_MAX);
  if (!said) return { error: 'Say what to change about the edition.' };
  if (ctx.editionAsk?.status === 'running' && Date.now() - ctx.editionAsk.at < 5 * 60_000) return { error: 'sua is still working out your last change.' };
  const ask: EditionAsk = { id: randomUUID(), ask: said, status: 'running', ops: [], changes: [], at: Date.now() };
  ctx.editionAsk = ask;
  const { edition, known, title, parts } = editionForAsk(ctx);
  const work = (async () => {
    let next: EditionAsk;
    try {
      // Agents that exist (ids and names): a new one drafted for a gap can't be one of them.
      const existing = new Set(ctx.agentStore.listAgents().flatMap((a) => [a.id.toLowerCase(), (a.name ?? '').toLowerCase()]).filter(Boolean));
      const out = parseEditionAnswer(await runEditor(ctx, { ASK: said, EDITION: JSON.stringify(edition) }), editionPrefsOf(ctx), known, title, parts, existing);
      next = !out ? { ...ask, status: 'failed', error: "sua didn't come back with changes that could be used. Ask again." }
        : 'error' in out ? { ...ask, status: 'failed', error: out.error }
          : { ...ask, status: 'ready', ops: out.ops, changes: out.changes, rows: out.rows, ...(out.say ? { say: out.say } : {}) };
    } catch (err) {
      next = { ...ask, status: 'failed', error: err instanceof Error ? err.message : 'That failed.' };
    }
    // A newer ask replaced this one meanwhile: its answer isn't shown.
    if (ctx.editionAsk?.id === ask.id) ctx.editionAsk = next;
  })();
  return { ask, work };
}

/** Apply the proposal: the edition's preferences change (one step, undone with Undo). */
export function applyEditionAsk(ctx: Ctx, id: string): { ok: boolean; message: string } {
  const ask = ctx.editionAsk;
  if (!ask || ask.id !== id || ask.status !== 'ready') return { ok: false, message: 'There was nothing to apply.' };
  // Apply all: the changes still open. Runs are never in it; they keep their own button.
  const rows = askRows(ask).filter((r): r is Extract<EditionAskRow, { kind: 'op' }> => r.kind === 'op' && r.state === 'open');
  if (!rows.length) return { ok: false, message: 'There was nothing to apply.' };
  try {
    const store = editionPrefsStoreOf(ctx);
    // Checked again now: the edition may have changed since sua answered.
    store.save(applyEditionOps(store.get(), rows.map((r) => r.op), editionKnownAgents(ctx)), Date.now(), { keepPrevious: !!ask.appliedAny });
  } catch (err) {
    return { ok: false, message: err instanceof EditionOpError ? err.message : 'That could not be applied.' };
  }
  const left = askRows(ask).filter((r) => r.kind === 'action' && r.state === 'open');
  const msg = `${rows.map((r) => r.text).join('; ')}. The edition follows ${rows.length === 1 ? 'it' : 'them'} from now on; Undo last change goes back.`;
  if (left.length) {
    ctx.editionAsk = { ...ask, appliedAny: true, rows: askRows(ask).map((r) => (r.kind === 'op' && r.state === 'open' ? { ...r, state: 'applied' } : r)) };
    return { ok: true, message: `${msg} The run${left.length === 1 ? '' : 's'} sua offered ${left.length === 1 ? 'is' : 'are'} still there, each with its own button.` };
  }
  ctx.editionAsk = undefined;
  return { ok: true, message: msg };
}

/** A proposal's rows (an older one, from before rows, as op rows). */
export function askRows(ask: EditionAsk): EditionAskRow[] {
  return ask.rows ?? ask.ops.map((op, i): EditionAskRow => ({ kind: 'op', op, text: ask.changes[i] ?? '', state: 'open' }));
}

/**
 * One row of the proposal: apply a change (Undo still goes back to before
 * the whole ask), skip it, or run a part again (its own run, with its last
 * inputs). The proposal goes once nothing in it is left open.
 */
export function actOnEditionRow(ctx: Ctx, id: string, n: number, what: 'apply' | 'skip' | 'run' | 'draft'): { ok: boolean; message: string } {
  const ask = ctx.editionAsk;
  const rows = ask && ask.id === id && ask.status === 'ready' ? askRows(ask) : [];
  const row = rows[n];
  if (!ask || !row || row.state !== 'open') return { ok: false, message: 'That change is no longer open.' };
  let next: EditionAskRow;
  let message: string;
  let appliedAny = !!ask.appliedAny;
  if (what === 'skip') {
    next = { ...row, state: 'skipped' } as EditionAskRow;
    message = `Skipped: ${row.text}.`;
  } else if (row.kind === 'op' && what === 'apply') {
    try {
      const store = editionPrefsStoreOf(ctx);
      store.save(applyEditionOps(store.get(), [row.op], editionKnownAgents(ctx)), Date.now(), { keepPrevious: appliedAny });
    } catch (err) {
      return { ok: false, message: err instanceof EditionOpError ? err.message : 'That could not be applied.' };
    }
    appliedAny = true;
    next = { ...row, state: 'applied' };
    message = `${row.text}. Undo last change goes back to before this ask.`;
  } else if (row.kind === 'action' && row.action.do === 'draft' && what === 'draft') {
    // A new agent for a gap (ADR-0101): drafted in the background behind one approval in your inbox; approved, it runs once and is always shown.
    try {
      const work = draftForBoard(ctx, TODAY_BOARD_ID, [{ purpose: row.action.purpose, ...(row.action.suggestedName ? { suggestedName: row.action.suggestedName } : {}) }], new BoardsStore(ctx.runStore.databaseHandle()).goal(TODAY_BOARD_ID)?.text ?? '').work;
      ctx.boardReviewWork = work;
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'The draft could not be started.' };
    }
    next = { ...row, state: 'ran' };
    message = "sua is drafting that agent. When it's ready, your inbox asks you to approve it; nothing runs until then.";
  } else if (row.kind === 'action' && row.action.do === 'rerun' && what === 'run') {
    const agent = ctx.agentStore.getAgent(row.action.agentId);
    if (!agent || agent.status !== 'active') return { ok: false, message: 'That agent can\'t run now.' };
    startAgentRun(ctx, agent, lastRunInputs(ctx, agent));
    next = { ...row, state: 'ran' };
    message = `Running ${agent.name || agent.id} again. Its part updates when it's done.`;
  } else {
    return { ok: false, message: 'That isn\'t something this row does.' };
  }
  const updated = rows.map((r, i) => (i === n ? next : r));
  ctx.editionAsk = updated.some((r) => r.state === 'open') ? { ...ask, rows: updated, appliedAny } : undefined;
  return { ok: true, message };
}

export function discardEditionAsk(ctx: Ctx, id: string): void {
  if (ctx.editionAsk?.id === id) ctx.editionAsk = undefined;
}

/** Agents the editor may name, for callers that need the same set. */
export function editionAskKnown(ctx: Ctx): Set<string> {
  return new Set([...editionKnownAgents(ctx)].filter((id) => !SYSTEM_AGENT_IDS.has(id) && !!withTileSignal(ctx.agentStore.getAgent(id))?.signal));
}
