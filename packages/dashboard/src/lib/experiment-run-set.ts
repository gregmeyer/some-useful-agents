/**
 * A run's results as the set an experiment holds fixed (ADR-0078). Most of
 * what someone has to test with is in their agents' runs, not in notebooks:
 * a search run that found twelve jobs has the twelve jobs in its output.
 * This reads a list of items out of a run's output, in code:
 *
 * - JSON anywhere in the output (the whole thing, a fenced block, a tagged
 *   block): the largest list of objects in it. An item's title is its
 *   title-like field; its other short fields are its facts.
 * - Otherwise a bulleted or numbered list: a line an item.
 *
 * Nothing is guessed: when fewer than two items can be read, the run isn't
 * offered. What was read is shown before anything is copied.
 */
import type { getContext } from '../context.js';
import { SYSTEM_AGENT_IDS, experimentAgentOf } from '@some-useful-agents/core';

type Ctx = ReturnType<typeof getContext>;

export interface RunItem { title: string; facts: Record<string, string> }

const TITLE_KEYS = ['title', 'name', 'headline', 'role', 'job_title', 'jobtitle', 'position', 'label', 'product', 'item', 'subject', 'company'];
/** Fields that say nothing about the item for ranking, or would hand a ranker its answer. */
const SKIP_KEYS = /^(id|uuid|url|link|href|image|img|photo|thumbnail|score|fit|fit_score|match|match_score|rank|ranking|position_in_list|index|reason|why|rationale|verdict|recommendation|recommended)$/i;

const short = (v: unknown): string | undefined => {
  if (typeof v === 'string') { const s = v.replace(/\s+/g, ' ').trim(); return s ? s.slice(0, 400) : undefined; }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    // A range ({min, max}) reads as "min–max"; a small object of scalars as "k: v, k: v".
    if (typeof o.min === 'number' && typeof o.max === 'number') return `${String(o.min)}–${String(o.max)}`;
    const parts = Object.entries(o).filter(([, x]) => typeof x === 'string' || typeof x === 'number').slice(0, 4).map(([k, x]) => `${k}: ${String(x)}`);
    return parts.length ? parts.join(', ').slice(0, 400) : undefined;
  }
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.slice(0, 8).join(', ').slice(0, 400);
  return undefined;
};
const label = (k: string) => { const s = k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

/** One object as an item: its title-like field, and its other short fields as facts. Undefined when it has no title. */
function itemOf(o: Record<string, unknown>): RunItem | undefined {
  const keys = Object.keys(o);
  const titleKey = TITLE_KEYS.map((t) => keys.find((k) => k.toLowerCase() === t)).find((k) => k && typeof o[k] === 'string' && (o[k] as string).trim())
    ?? keys.find((k) => typeof o[k] === 'string' && (o[k] as string).trim().length > 2 && !/^https?:/i.test(o[k] as string) && !SKIP_KEYS.test(k));
  if (!titleKey) return undefined;
  const facts: Record<string, string> = {};
  for (const k of keys) {
    if (k === titleKey || SKIP_KEYS.test(k)) continue;
    const v = short(o[k]);
    if (v && !/^https?:\/\/\S+$/i.test(v)) facts[label(k)] = v;
    if (Object.keys(facts).length === 12) break;
  }
  return { title: (o[titleKey] as string).replace(/\s+/g, ' ').trim().slice(0, 200), facts };
}

/** Every list of objects inside a value, to a few levels down. */
function lists(v: unknown, depth = 0, out: Array<Array<Record<string, unknown>>> = []): Array<Array<Record<string, unknown>>> {
  if (depth > 4 || !v || typeof v !== 'object') return out;
  if (Array.isArray(v)) {
    const objs = v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
    if (objs.length >= 2 && objs.length === v.length) out.push(objs);
    for (const x of v.slice(0, 50)) lists(x, depth + 1, out);
  } else for (const x of Object.values(v as Record<string, unknown>)) lists(x, depth + 1, out);
  return out;
}

/** The JSON values a text holds: the whole text, fenced blocks, tagged blocks, and its outermost brackets. */
function jsonIn(text: string): unknown[] {
  const tries = [text, ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]), ...[...text.matchAll(/<([a-z][a-z0-9_-]*)>\s*([[{][\s\S]*?[\]}])\s*<\/\1>/gi)].map((m) => m[2])];
  const a = text.indexOf('['); const b = text.lastIndexOf(']');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  const c = text.indexOf('{'); const d = text.lastIndexOf('}');
  if (c >= 0 && d > c) tries.push(text.slice(c, d + 1));
  const out: unknown[] = [];
  for (const t of tries) { try { out.push(JSON.parse(t.trim())); } catch { /* not JSON */ } }
  return out;
}

/**
 * The items a run's output lists (at most 60): from JSON when it has a list
 * of objects, else from a bulleted or numbered list. Items of the same
 * title are kept once. Empty when fewer than two can be read. Pure.
 */
export function itemsFromOutput(text: string | undefined): RunItem[] {
  const raw = (text ?? '').slice(0, 400_000);
  let best: RunItem[] = [];
  for (const v of jsonIn(raw)) {
    for (const l of lists(v)) {
      const items = l.map(itemOf).filter((x): x is RunItem => !!x);
      // Most of the list has to read as items, or it's some other list (log lines, steps).
      if (items.length >= 2 && items.length * 2 >= l.length && items.length > best.length) best = items;
    }
  }
  if (best.length < 2) {
    const lines = raw.split(/\r?\n/).map((x) => /^\s*(?:[-*•]|\d{1,3}[.)])\s+(.+)$/.exec(x)?.[1]?.trim()).filter((x): x is string => !!x && x.length > 2);
    if (lines.length >= 2) best = lines.map((x) => ({ title: x.replace(/\*\*/g, '').slice(0, 200), facts: {} }));
  }
  const seen = new Set<string>();
  const out = best.filter((i) => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 60);
  return out.length >= 2 ? out : [];
}

/** A run whose results could be the set, as offered. */
export interface RunSetCandidate { runId: string; agentId: string; agentName: string; at: string; items: number; sample: string[]; title: string }

const when = (iso: string) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return iso.slice(0, 10); } };

/** The items a run's output lists: its result, else its steps' outputs, the last first. */
export function runItems(ctx: Ctx, runId: string): { items: RunItem[]; agentId: string; at: string } | undefined {
  const run = ctx.runStore.getRun(runId);
  if (!run) return undefined;
  let items = itemsFromOutput(run.result);
  if (!items.length) {
    try { for (const n of [...ctx.runStore.listNodeExecutions(runId)].reverse()) { items = itemsFromOutput(n.result ?? undefined); if (items.length) break; } } catch { /* its result was all there was */ }
  }
  return { items, agentId: run.agentName, at: run.startedAt };
}

/** How much each agent has been run (completed runs), and when it last was. Its own agents only: not sua's, not an experiment's copies. */
export function agentRunCounts(ctx: Ctx): Array<{ id: string; name: string; description?: string; runs: number; versions: number; current?: number; takesItems: boolean }> {
  return ctx.agentStore.listAgents().filter((a) => !SYSTEM_AGENT_IDS.has(a.id) && !experimentAgentOf(a.id)).map((a) => {
    let runs = 0;
    try { runs = ctx.runStore.queryRuns({ agentName: a.id, statuses: ['completed'], limit: 1 }).total; } catch { runs = 0; }
    let versions = 0;
    try { versions = ctx.agentStore.listVersions(a.id).length; } catch { versions = 0; }
    return { id: a.id, name: a.name, ...(a.description ? { description: a.description } : {}), runs, versions, ...(a.version !== undefined ? { current: a.version } : {}), takesItems: !!a.inputs && 'ITEMS' in a.inputs };
  });
}

/**
 * Runs whose results could be the set: for the agents that match `search`
 * (or, with none, the ones run the most), their latest completed runs that
 * list two or more items. A few of each, newest first.
 */
export function runSetCandidates(ctx: Ctx, search = '', limit = 6): RunSetCandidate[] {
  const q = search.trim().toLowerCase();
  const agents = agentRunCounts(ctx).filter((a) => a.runs > 0 && (!q || `${a.name} ${a.id}`.toLowerCase().includes(q)))
    .sort((a, b) => b.runs - a.runs).slice(0, q ? 6 : 8);
  const out: RunSetCandidate[] = [];
  for (const a of agents) {
    let kept = 0;
    let rows: Array<{ id: string; startedAt: string; parentRunId?: string }> = [];
    try { rows = ctx.runStore.queryRuns({ agentName: a.id, statuses: ['completed'], limit: 4 }).rows; } catch { rows = []; }
    for (const r of rows) {
      if (kept >= (q ? 2 : 1)) break;
      const read = runItems(ctx, r.id);
      if (!read || read.items.length < 2) continue;
      kept++;
      out.push({ runId: r.id, agentId: a.id, agentName: a.name, at: r.startedAt, items: read.items.length, sample: read.items.slice(0, 3).map((i) => i.title), title: `${a.name}, run of ${when(r.startedAt)}` });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** A run's results as an experiment's case, or why they can't be. */
export function freezeRun(ctx: Ctx, runId: string): { cases: unknown[]; fromRun: { runId: string; title: string } } | { error: string } {
  const read = runItems(ctx, runId);
  if (!read) return { error: 'No such run.' };
  if (read.items.length < 2) return { error: 'That run\'s results don\'t list two or more items sua can read. Choose another run, a notebook, or paste the list.' };
  const agent = ctx.agentStore.getAgent(read.agentId);
  const title = `${agent?.name ?? read.agentId}, run of ${when(read.at)}`;
  return { cases: [{ name: title, items: read.items }], fromRun: { runId, title } };
}
