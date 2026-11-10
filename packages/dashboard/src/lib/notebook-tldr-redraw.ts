/**
 * Redraw a notebook's TL;DR picture from an ask ("make it suitable for
 * LinkedIn", "more editorial"): the `notebook-tldr` agent chooses a spec
 * (core TldrSpec: a size, tone, layout, parts, and at most a headline and a
 * takeaway), and the notebook keeps it (NotebookStore.setTldr; Undo puts the
 * one before back). The agent never draws and never supplies a number: any
 * number in the words it writes has to be in the picture's own data, or the
 * words are asked for once more and then left out. It runs in the
 * background; the Redraw page shows it working and then the new picture.
 */
import { randomUUID } from 'node:crypto';
import { NotebookStore, cleanTldrSpec, executeAgentDag, extractTaggedJson, tldrOptionsGuide, TLDR_LAYOUTS, TLDR_SIZES, TLDR_TONES, type Notebook, type TldrSpec } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import type { TldrData } from '../views/notebook-tldr.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_TLDR_ID = 'notebook-tldr';
/** A redraw that hasn't answered in this long is over (the page stops waiting). */
const STALE_MS = 4 * 60 * 1000;

/** A redraw under way, or how the last one ended, per notebook (in memory: a restart forgets it, the picture stays as it was). */
export interface TldrRedrawState { ask: string; since: string; status: 'working' | 'done' | 'failed'; error?: string }

/** What the picture says, for the agent: words and numbers only (no pictures, no markup). Pure. */
export function cardForAgent(t: TldrData): Record<string, unknown> {
  return {
    // What pictures there are, so a layout that leads with one is chosen only when it can be drawn.
    lead: { label: t.leadLabel, text: t.lead, facts: t.leadFacts, ...(t.note ? { note: t.note } : {}), ...(t.who ? { about: t.who } : {}), picture: t.leadPicture ? t.leadPictureKind ?? 'photo' : 'none' },
    stats: t.stats,
    ...(t.chart ? { bars: { by: t.chart.label, order: t.chart.order, shown: t.chart.bars.map((b) => ({ name: b.name, value: b.text, ...(b.lead ? { lead: true } : {}) })), more: t.chart.more, topOptionsWithPictures: t.chart.bars.slice(0, 4).filter((b) => b.picture).length } } : {}),
    ...(t.points.length ? { points: { label: t.pointsLabel ?? 'What it found', items: t.points } } : {}),
  };
}

/** The agent's inputs. Pure. */
export function tldrRedrawInputs(nb: Pick<Notebook, 'title' | 'statement' | 'tldr'>, card: TldrData, ask: string, errors = ''): Record<string, string> {
  return {
    NOTEBOOK: JSON.stringify({ title: nb.title, for: nb.statement }),
    CARD: JSON.stringify(cardForAgent(card)),
    OPTIONS: tldrOptionsGuide(),
    ASK: ask,
    CURRENT: nb.tldr ? JSON.stringify({ size: nb.tldr.size, tone: nb.tldr.tone, layout: nb.tldr.layout, parts: nb.tldr.parts, ...(nb.tldr.headline ? { headline: nb.tldr.headline } : {}), ...(nb.tldr.takeaway ? { takeaway: nb.tldr.takeaway } : {}) }) : '',
    ERRORS: errors ? `Your last answer couldn't be used: ${errors} Answer again, fixing that and keeping the rest.` : '',
  };
}

/** The numbers in a text, as digits ("$2,130.99" → "2130.99", "8" → "8"). */
const numbers = (text: string): string[] => (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.$/, ''));

/** Numbers in the written words that the picture's data doesn't have (so they'd be the model's own). Pure. */
export function strayNumbers(words: readonly (string | undefined)[], nb: Pick<Notebook, 'title' | 'statement'>, card: TldrData): string[] {
  const known = new Set(numbers(`${JSON.stringify(cardForAgent(card))} ${nb.title} ${nb.statement}`));
  // A price said to the dollar ("$140" for $139.99) isn't in the data as written: it has to be said as it is there.
  return [...new Set(words.flatMap((w) => numbers(w ?? '')).filter((n) => !known.has(n)))];
}

/**
 * The agent's answer as a spec, or why it can't be used: no `<tldr>` JSON,
 * a size, tone or layout that isn't one of the choices (named, so a retry
 * can fix it), or words with a number the picture's data doesn't have. Pure.
 */
export function parseTldrAnswer(raw: string | undefined, nb: Pick<Notebook, 'title' | 'statement'>, card: TldrData, ask: string, now = new Date().toISOString()): { spec: TldrSpec } | { error: string; spec?: TldrSpec } {
  let v: Record<string, unknown>;
  try {
    const parsed = JSON.parse(extractTaggedJson(raw ?? '', 'tldr') ?? 'null') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'It has no <tldr> JSON object.' };
    v = parsed as Record<string, unknown>;
  } catch { return { error: 'Its <tldr> block is not valid JSON.' }; }
  const unknown = ([['size', TLDR_SIZES], ['tone', TLDR_TONES], ['layout', TLDR_LAYOUTS]] as const)
    .filter(([k, known]) => v[k] !== undefined && !(typeof v[k] === 'string' && (v[k] as string) in known))
    .map(([k, known]) => `"${String(v[k])}" is not a ${k} (use one of: ${Object.keys(known).join(', ')}).`);
  if (unknown.length) return { error: unknown.join(' ') };
  const spec = cleanTldrSpec({ ...v, ask, at: now });
  if (!spec) return { error: 'It is not a way to draw the picture.' };
  const stray = strayNumbers([spec.headline, spec.takeaway], nb, card);
  if (stray.length) {
    // Usable without the words, if a second try doesn't fix them.
    const { headline: _h, takeaway: _t, ...plain } = spec;
    return { error: `The headline or takeaway has ${stray.length === 1 ? 'a number' : 'numbers'} that CARD doesn't (${stray.join(', ')}). Use only numbers that are in CARD, written as they are there, or none.`, spec: plain };
  }
  return { spec };
}

/** One run of the agent (or the test's stand-in): its answer, or undefined. Never throws. */
async function runTldrAgent(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
  if (ctx.notebookTldrRun) return ctx.notebookTldrRun(inputs);
  if (!ensureSystemAgentCurrent(ctx, NOTEBOOK_TLDR_ID, 'notebook TL;DR pictures')) return undefined;
  const agent = ctx.agentStore.getAgent(NOTEBOOK_TLDR_ID);
  if (!agent) return undefined;
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  try {
    // No onRunFailure: a picture that can't be redrawn stays as it was, not an inbox thread.
    await executeAgentDag(agent, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
      runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
      dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
    });
    const run = ctx.runStore.getRun(runId);
    return run?.status === 'completed' ? run.result ?? undefined : undefined;
  } catch {
    return undefined;
  } finally {
    ctx.activeRuns.delete(runId);
  }
}

/**
 * Choose a spec for an ask: one try, and one more with the reason when the
 * first can't be used. Words with a number of the model's own are left out
 * if the second try still has them (the drawing itself stands).
 */
export async function chooseTldrSpec(ctx: Ctx, nb: Notebook, card: TldrData, ask: string): Promise<{ spec: TldrSpec } | { error: string }> {
  const first = parseTldrAnswer(await runTldrAgent(ctx, tldrRedrawInputs(nb, card, ask)), nb, card, ask);
  if (!('error' in first)) return first;
  const second = parseTldrAnswer(await runTldrAgent(ctx, tldrRedrawInputs(nb, card, ask, first.error)), nb, card, ask);
  if (!('error' in second)) return second;
  const usable = second.spec ?? first.spec;
  return usable ? { spec: usable } : { error: second.error };
}

/** How a notebook's redraw stands: working (unless it's gone stale), how the last one ended, or nothing. */
export function tldrRedrawState(ctx: Ctx, notebookId: string): TldrRedrawState | undefined {
  const s = ctx.notebookTldrRedraws?.get(notebookId);
  if (s?.status === 'working' && Date.now() - Date.parse(s.since) > STALE_MS) return { ...s, status: 'failed', error: 'sua stopped before it finished. Ask again.' };
  return s;
}

/** Forget how the last redraw ended (once the page has shown it). */
export function clearTldrRedraw(ctx: Ctx, notebookId: string): void {
  if (ctx.notebookTldrRedraws?.get(notebookId)?.status !== 'working') ctx.notebookTldrRedraws?.delete(notebookId);
}

/**
 * Redraw in the background. Returns whether it started (false: nothing was
 * asked, no such notebook, or one is already under way). `card` is what the
 * picture says now (the route builds it, with the notebook's history).
 */
export function startTldrRedraw(ctx: Ctx, notebookId: string, card: TldrData, askRaw: string, onDone?: (p: Promise<void>) => void): boolean {
  const ask = askRaw.replace(/\s+/g, ' ').trim().slice(0, 300);
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!ask || !nb || tldrRedrawState(ctx, notebookId)?.status === 'working') return false;
  ctx.notebookTldrRedraws ??= new Map();
  const state: TldrRedrawState = { ask, since: new Date().toISOString(), status: 'working' };
  ctx.notebookTldrRedraws.set(notebookId, state);
  const work = (async () => {
    let out: { spec: TldrSpec } | { error: string };
    try { out = await chooseTldrSpec(ctx, nb, card, ask); } catch (err) { out = { error: err instanceof Error ? err.message : String(err) }; }
    // Replaced by a newer ask meanwhile (a stale one timed out): this one's answer isn't kept.
    if (ctx.notebookTldrRedraws?.get(notebookId) !== state) return;
    if ('error' in out) { ctx.notebookTldrRedraws.set(notebookId, { ...state, status: 'failed', error: `sua couldn't redraw it: ${out.error}` }); return; }
    try {
      store.setTldr(notebookId, out.spec);
      ctx.notebookTldrRedraws.set(notebookId, { ...state, status: 'done' });
    } catch (err) {
      ctx.notebookTldrRedraws.set(notebookId, { ...state, status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  })();
  onDone?.(work);
  return true;
}
