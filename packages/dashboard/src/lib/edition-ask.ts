/**
 * Changing Today's edition by asking (ADR-0076): "lead with markets", "drop
 * the evening routine". The `edition-editor` agent turns the ask into
 * edition ops; they are checked here (only agents that exist, only what the
 * edition takes) by trying them on the current preferences, and kept as a
 * proposal for the person to apply or discard. Nothing changes until they
 * apply it. One ask at a time, kept in memory: a restart drops a proposal
 * nobody applied.
 */
import { randomUUID } from 'node:crypto';
import {
  EditionOpError, applyEditionOps, describeEditionOp, editionOpSchema, executeAgentDag, extractTaggedJson, SYSTEM_AGENT_IDS,
  type EditionOp, type EditionPrefs,
} from '@some-useful-agents/core';
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

export interface EditionAsk {
  id: string;
  ask: string;
  status: 'running' | 'ready' | 'failed';
  /** The changes, checked; empty when sua says it can't be done here. */
  ops: EditionOp[];
  /** Each change in plain words. */
  changes: string[];
  /** sua's line on what will change, or why nothing will. */
  say?: string;
  error?: string;
  at: number;
}

/** The edition as the editor reads it: what's showing and where, what was left out, what could be brought in. */
export function editionForAsk(ctx: Ctx): { edition: Record<string, unknown>; known: Set<string>; title: (id: string) => string } {
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
  return {
    edition: {
      ...(boards.goal(TODAY_BOARD_ID) ? { goal: boards.goal(TODAY_BOARD_ID)!.text } : {}),
      showing: showing.map((id) => ({ id, title: title(id), column: wide.has(id) ? 'wide' : 'narrow', ...(lead === id ? { leads: true } : {}) })),
      leftOut: prefs.hidden.map((id) => ({ id, title: title(id) })),
      couldShow: could.map((id) => ({ id, title: title(id), ...(ctx.agentStore.getAgent(id)?.description ? { about: ctx.agentStore.getAgent(id)!.description!.replace(/\s+/g, ' ').slice(0, 120) } : {}) })),
      numbersBand: prefs.numbers !== false,
      ...(prefs.topStory ? { topItemOf: prefs.topStory } : {}), ...(prefs.note ? { yourLine: prefs.note } : {}),
    },
    known, title,
  };
}

/**
 * The editor's `<edition>` answer, checked against the preferences as they
 * are: every op must be one the edition takes and name a real agent, and
 * together they must apply. An answer with no ops is sua saying it can't be
 * done here. Undefined when there is no usable answer. Pure.
 */
export function parseEditionAnswer(raw: string | undefined, prefs: EditionPrefs, known: ReadonlySet<string>, title: (id: string) => string): { ops: EditionOp[]; changes: string[]; say?: string } | { error: string } | undefined {
  const block = extractTaggedJson(raw ?? '', 'edition');
  if (!block) return undefined;
  let v: { ops?: unknown; say?: unknown };
  try { v = JSON.parse(block) as typeof v; } catch { return undefined; }
  if (!v || typeof v !== 'object') return undefined;
  const say = typeof v.say === 'string' ? v.say.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const list = Array.isArray(v.ops) ? v.ops.slice(0, OPS_MAX) : [];
  if (!list.length) return { ops: [], changes: [], ...(say ? { say } : {}) };
  const ops: EditionOp[] = [];
  for (const o of list) {
    const p = editionOpSchema.safeParse(o);
    if (!p.success) return { error: "sua came back with a change the edition doesn't take. Say it another way." };
    ops.push(p.data);
  }
  try { applyEditionOps(prefs, ops, known); } catch (err) {
    return { error: err instanceof EditionOpError ? err.message : 'Those changes could not be applied.' };
  }
  return { ops, changes: ops.map((op) => describeEditionOp(op, title)), ...(say ? { say } : {}) };
}

async function runEditor(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
  if (ctx.editionEditorRun) return ctx.editionEditorRun(inputs);
  // A page test that submits the box would otherwise start a real model run.
  if (process.env.VITEST) return undefined;
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
  const { edition, known, title } = editionForAsk(ctx);
  const work = (async () => {
    let next: EditionAsk;
    try {
      const out = parseEditionAnswer(await runEditor(ctx, { ASK: said, EDITION: JSON.stringify(edition) }), editionPrefsOf(ctx), known, title);
      next = !out ? { ...ask, status: 'failed', error: "sua didn't come back with changes that could be used. Ask again." }
        : 'error' in out ? { ...ask, status: 'failed', error: out.error }
          : { ...ask, status: 'ready', ops: out.ops, changes: out.changes, ...(out.say ? { say: out.say } : {}) };
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
  if (!ask || ask.id !== id || ask.status !== 'ready' || !ask.ops.length) return { ok: false, message: 'There was nothing to apply.' };
  try {
    const store = editionPrefsStoreOf(ctx);
    store.save(applyEditionOps(store.get(), ask.ops, editionKnownAgents(ctx)));
  } catch (err) {
    return { ok: false, message: err instanceof EditionOpError ? err.message : 'That could not be applied.' };
  }
  ctx.editionAsk = undefined;
  return { ok: true, message: `${ask.changes.join('; ')}. The edition follows ${ask.changes.length === 1 ? 'it' : 'them'} from now on; Undo last change goes back.` };
}

export function discardEditionAsk(ctx: Ctx, id: string): void {
  if (ctx.editionAsk?.id === id) ctx.editionAsk = undefined;
}

/** Agents the editor may name, for callers that need the same set. */
export function editionAskKnown(ctx: Ctx): Set<string> {
  return new Set([...editionKnownAgents(ctx)].filter((id) => !SYSTEM_AGENT_IDS.has(id) && !!withTileSignal(ctx.agentStore.getAgent(id))?.signal));
}
