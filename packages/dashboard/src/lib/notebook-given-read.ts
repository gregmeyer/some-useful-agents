/**
 * Reading what you pasted for a notebook (ADR-0077): the `notebook-given-reader`
 * agent turns a paste (a LinkedIn profile, a résumé, a spec) into a short
 * summary and a list of facts, each with the words of the paste it comes
 * from. Code keeps only the facts whose quote is in the paste, so nothing
 * on the card is the model's own. The notebook keeps the reading next to
 * the paste (NotebookStore.answerGiven), its page shows it for correction,
 * and its steps receive it in place of the raw text (core givenForStep).
 *
 * It runs in the background. While it does, the notebook's steps wait
 * (givenReadingReason); a reading that fails never blocks them: they start
 * on the text as pasted.
 */
import { randomUUID } from 'node:crypto';
import { NotebookStore, cleanGivenRead, executeAgentDag, extractTaggedJson, type Notebook, type NotebookGiven, type NotebookGivenFact, type NotebookGivenRead } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_GIVEN_READER_ID = 'notebook-given-reader';
/** A reading that hasn't answered in this long is over (steps stop waiting on it). */
const STALE_MS = 3 * 60 * 1000;

/** A reading under way, or that the last one failed, per notebook and given thing (in memory: a restart forgets it). */
export interface GivenReadState { since: string; status: 'working' | 'failed' }

const stateKey = (notebookId: string, key: string) => `${notebookId}\n${key}`;

/** Letters and digits only, lower case, single spaces: how a quote is looked for in a paste. */
const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/** The agent's inputs. Pure. */
export function givenReadInputs(nb: Pick<Notebook, 'title' | 'statement'>, g: Pick<NotebookGiven, 'label' | 'text'>, errors = ''): Record<string, string> {
  return {
    LABEL: g.label,
    FOR: nb.statement || nb.title,
    TEXT: g.text ?? '',
    ERRORS: errors ? `Your last answer couldn't be used: ${errors} Answer again, fixing that.` : '',
  };
}

/**
 * The agent's answer as a reading, or why it can't be used. A fact stays
 * only when its quote (8 characters or more) is in the paste, compared by
 * letters and digits alone, so punctuation and line breaks don't matter
 * and a reworded or made-up quote does. Pure.
 */
export function parseGivenRead(raw: string | undefined, text: string, now = new Date().toISOString()): { read: NotebookGivenRead; dropped: number } | { error: string } {
  let v: unknown;
  try { v = JSON.parse(extractTaggedJson(raw ?? '', 'read') ?? 'null'); } catch { return { error: 'Its <read> block is not valid JSON.' }; }
  const cleaned = cleanGivenRead(v, now);
  if (!cleaned) return { error: 'It has no <read> JSON object with a summary and facts.' };
  const hay = plain(text);
  const facts = cleaned.facts.filter((f) => { const q = plain(f.quote ?? ''); return q.length >= 8 && hay.includes(q); }).map(({ byYou: _b, ...f }) => f);
  if (!facts.length) return { error: 'None of its facts has a quote that is in the paste word for word. Copy each quote from the paste exactly.' };
  return { read: { ...cleaned, facts }, dropped: cleaned.facts.length - facts.length };
}

/**
 * Your correction of a reading, from lines of "Label: value": a line that
 * matches a fact sua read keeps its quote; any other is yours. Pure.
 */
export function correctedRead(before: NotebookGivenRead | undefined, linesRaw: string, now = new Date().toISOString()): NotebookGivenRead | undefined {
  const facts: NotebookGivenFact[] = [];
  for (const line of linesRaw.split(/\r?\n/)) {
    const m = /^\s*([^:]{1,60}):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    const same = before?.facts.find((f) => f.label === label && f.value === value.slice(0, 300));
    facts.push(same ?? { label, value, byYou: true });
  }
  return cleanGivenRead({ summary: before?.summary ?? '', facts, at: now }, now);
}

/** Whether the reader can run here (a test's stand-in, or the agent in the catalog). */
function readerAgent(ctx: Ctx) {
  if (ctx.notebookGivenReaderRun) return true;
  return Boolean(ctx.agentStore.getAgent(NOTEBOOK_GIVEN_READER_ID));
}

/** Put the reader in the catalog and keep it current (at startup). */
export function installGivenReader(ctx: Ctx): boolean {
  return ensureSystemAgentCurrent(ctx, NOTEBOOK_GIVEN_READER_ID, 'reading what you paste for a notebook');
}

/** One run of the agent (or the test's stand-in): its answer, or undefined. Never throws. */
async function runGivenReader(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
  try {
    if (ctx.notebookGivenReaderRun) return await ctx.notebookGivenReaderRun(inputs);
    const agent = ctx.agentStore.getAgent(NOTEBOOK_GIVEN_READER_ID);
    if (!agent) return undefined;
    const runId = randomUUID();
    const ac = new AbortController();
    ctx.activeRuns.set(runId, ac);
    try {
      // No onRunFailure: a paste that can't be read is used as pasted, not an inbox thread.
      await executeAgentDag(agent, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
        runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
      });
      const run = ctx.runStore.getRun(runId);
      return run?.status === 'completed' ? run.result ?? undefined : undefined;
    } finally {
      ctx.activeRuns.delete(runId);
    }
  } catch {
    return undefined;
  }
}

/** How a given thing's reading stands: working (unless it's gone stale), failed, or nothing. */
export function givenReadState(ctx: Ctx, notebookId: string, key: string): GivenReadState | undefined {
  const s = ctx.notebookGivenReads?.get(stateKey(notebookId, key));
  if (s?.status === 'working' && Date.now() - Date.parse(s.since) > STALE_MS) return { ...s, status: 'failed' };
  return s;
}

/** How each of a notebook's given things stands, by key (for its page). */
export function givenReadStates(ctx: Ctx, nb: Pick<Notebook, 'id' | 'given'>): Record<string, GivenReadState['status']> {
  const out: Record<string, GivenReadState['status']> = {};
  for (const g of nb.given ?? []) { const s = givenReadState(ctx, nb.id, g.key); if (s) out[g.key] = s.status; }
  return out;
}

/** Why a notebook's steps can't start yet: sua is still reading something you pasted. Undefined when it isn't. */
export function givenReadingReason(ctx: Ctx, nb: Pick<Notebook, 'id' | 'given'>): string | undefined {
  const g = (nb.given ?? []).find((x) => givenReadState(ctx, nb.id, x.key)?.status === 'working');
  return g ? `sua is reading ${g.label}, which you pasted. Its steps start when that's done (a minute at most).` : undefined;
}

/**
 * Read a given thing in the background and keep the reading. Returns whether
 * it started (false: nothing pasted for it, no reader here, or one is under
 * way). `then` runs when it's over, read or not, so what was waiting on it
 * can start either way.
 */
export function startGivenRead(ctx: Ctx, notebookId: string, key: string, opts: { then?: () => void; onDone?: (p: Promise<void>) => void } = {}): boolean {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  const g = nb?.given?.find((x) => x.key === key);
  if (!nb || !g || g.state !== 'given' || !g.text || !readerAgent(ctx) || givenReadState(ctx, notebookId, key)?.status === 'working') return false;
  ctx.notebookGivenReads ??= new Map();
  const state: GivenReadState = { since: new Date().toISOString(), status: 'working' };
  const k = stateKey(notebookId, key);
  ctx.notebookGivenReads.set(k, state);
  const text = g.text;
  const work = (async () => {
    let out = parseGivenRead(await runGivenReader(ctx, givenReadInputs(nb, g)), text);
    if ('error' in out) out = parseGivenRead(await runGivenReader(ctx, givenReadInputs(nb, g, out.error)), text);
    // Replaced meanwhile (it went stale and was asked again): this answer isn't kept.
    if (ctx.notebookGivenReads?.get(k) !== state) return;
    let kept = false;
    if (!('error' in out)) {
      try {
        // Only if what was pasted is still what was read (it wasn't replaced, skipped or removed meanwhile).
        const now = store.get(notebookId)?.given?.find((x) => x.key === key);
        if (now?.state === 'given' && now.text === text) { store.answerGiven(notebookId, key, { read: out.read }); kept = true; }
      } catch { /* the paste stands as it is */ }
    }
    if (kept) ctx.notebookGivenReads.delete(k); else ctx.notebookGivenReads.set(k, { ...state, status: 'failed' });
    // The notebook's history says it happened (and when), read or not.
    try {
      if (kept && !('error' in out)) {
        const n = out.read.facts.length;
        store.addEntry(notebookId, { kind: 'note', title: `Read ${g.label}: ${String(n)} ${n === 1 ? 'fact' : 'facts'}`, body: `${out.read.summary ? `${out.read.summary} ` : ''}Its steps work from this in place of the text you gave. It's on the notebook's page to check and fix.`, by: 'sua' });
      } else if (store.get(notebookId)?.given?.find((x) => x.key === key)?.text === text) {
        store.addEntry(notebookId, { kind: 'note', title: `Couldn't read ${g.label} into a short form`, body: 'Its steps use the first part of the text as you gave it. Read it again from the notebook\'s page.', by: 'sua' });
      }
    } catch { /* the page still says how it stands */ }
    try { opts.then?.(); } catch { /* what was waiting says why itself */ }
  })();
  opts.onDone?.(work);
  return true;
}
