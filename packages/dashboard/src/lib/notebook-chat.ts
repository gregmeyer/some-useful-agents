/**
 * A notebook's conversation with sua: as you talk, sua adds what you said to
 * the notebook (notes, options, evidence, ruled-out decisions, parameters,
 * criteria) with a `notebook-add` action, and suggests a pipeline with a
 * `notebook-pipeline` card you approve. Triage sees the notebook it's in.
 */
import {
  NotebookStore, entryKey, NOTEBOOK_ENTRY_KINDS, validateScheduleInterval, cronToHuman,
  type Notebook, type NotebookEntryKind,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export const notebooksOf = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());

const strList = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean).slice(0, max);

export interface NotebookAdd {
  entries: Array<{ kind: NotebookEntryKind; title: string; body: string }>;
  params: string[];
  criteria: string[];
  statement?: string;
}

/** CHANGES as sua sends it: {entries?, params?, criteria?, statement?}. */
export function parseNotebookAdd(raw: string): { add?: NotebookAdd; error?: string } {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { error: 'CHANGES is not JSON.' }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'CHANGES must be an object.' };
  const o = v as { entries?: unknown; params?: unknown; criteria?: unknown; statement?: unknown };
  const entries: NotebookAdd['entries'] = [];
  for (const e of Array.isArray(o.entries) ? o.entries.slice(0, 12) : []) {
    const x = e as { kind?: unknown; title?: unknown; body?: unknown };
    if (typeof x.title !== 'string' || !x.title.trim() || !(NOTEBOOK_ENTRY_KINDS as readonly string[]).includes(String(x.kind))) continue;
    entries.push({ kind: x.kind as NotebookEntryKind, title: x.title.trim(), body: typeof x.body === 'string' ? x.body : '' });
  }
  const add: NotebookAdd = {
    entries,
    params: strList(o.params, 10),
    criteria: strList(o.criteria, 10),
    ...(typeof o.statement === 'string' && o.statement.trim() ? { statement: o.statement.trim().slice(0, 500) } : {}),
  };
  if (!add.entries.length && !add.params.length && !add.criteria.length && !add.statement) return { error: 'Nothing to add.' };
  return { add };
}

/** Apply it: new entries (skipping ones it has), parameters, criteria, and the statement if it had none. */
export function applyNotebookAdd(store: NotebookStore, notebookId: string, add: NotebookAdd, by = 'sua'): { added: string[]; skipped: number } {
  const nb = store.get(notebookId);
  if (!nb) throw new Error(`No notebook "${notebookId}".`);
  const seen = new Set(store.entries(nb.id, 1000).map((e) => entryKey(e.title)));
  const added: string[] = [];
  let skipped = 0;
  for (const e of add.entries) {
    const k = entryKey(e.title);
    if (!k || seen.has(k)) { skipped++; continue; }
    seen.add(k);
    store.addEntry(nb.id, { kind: e.kind, title: e.title, body: e.body, by });
    added.push(`${e.kind}: ${e.title}`);
  }
  const before = { params: nb.params.length, criteria: nb.criteria.length };
  const after = store.extend(nb.id, { params: add.params, criteria: add.criteria });
  for (const p of after.params.slice(before.params)) added.push(`parameter: ${p}`);
  for (const c of after.criteria.slice(before.criteria)) added.push(`done when: ${c.text}`);
  if (add.statement && !nb.statement) { store.update(nb.id, { statement: add.statement }); added.push(`what it's for: ${add.statement}`); }
  return { added, skipped };
}

/** AGENTS / CADENCE as sua sends them, checked against installed agents. */
export function parseNotebookPipeline(ctx: Ctx, agentsRaw: string, cadence: string): { agents?: string[]; cadence?: string; error?: string } {
  let list: unknown;
  try { list = JSON.parse(agentsRaw); } catch { list = agentsRaw.split(/[\s,]+/); }
  const agents = strList(list, 10);
  if (agents.length === 0) return { error: 'No agents for the pipeline.' };
  const missing = agents.filter((a) => !ctx.agentStore.getAgent(a));
  if (missing.length) return { error: `Not installed: ${missing.join(', ')}.` };
  const c = cadence.trim();
  if (c) {
    try { validateScheduleInterval(c, {}); } catch { return { error: `"${c}" isn't a schedule sua understands.` }; }
  }
  return { agents, cadence: c };
}

export function describePipelineChange(nb: Notebook | undefined, agents: string[], cadence: string): Array<{ what: string; before: string; after: string }> {
  const out = [{ what: 'Pipeline', before: nb?.pipeline.length ? nb.pipeline.join(' → ') : '(none)', after: agents.join(' → ') }];
  if (cadence || nb?.cadence) out.push({ what: 'Runs', before: nb?.cadence ? cronToHuman(nb.cadence) : 'when you ask', after: cadence ? cronToHuman(cadence) : 'when you ask' });
  return out;
}

/** The notebook a conversation is about: linked to it, or started from its page. */
export function notebookForThread(ctx: Ctx, threadId: string, contextJson?: string): Notebook | undefined {
  const store = notebooksOf(ctx);
  try {
    const page = (JSON.parse(contextJson ?? '{}') as { page?: { kind?: string; id?: string } }).page;
    if (page?.kind === 'notebook' && page.id) return store.get(page.id);
  } catch { /* no context */ }
  return store.list().find((n) => n.conversationId === threadId);
}

/** The notebook, for triage: what it is, what it has, what agents could feed it. */
export function describeNotebookForTriage(ctx: Ctx, nb: Notebook): string {
  const store = notebooksOf(ctx);
  const entries = store.entries(nb.id, 60).map((e) => `${e.kind}: ${e.title}`);
  return JSON.stringify({
    id: nb.id, title: nb.title, for: nb.statement, status: nb.status,
    params: nb.params, criteria: nb.criteria, pipeline: nb.pipeline, cadence: nb.cadence,
    entries, link: `/notebooks/${encodeURIComponent(nb.id)}`,
  });
}
