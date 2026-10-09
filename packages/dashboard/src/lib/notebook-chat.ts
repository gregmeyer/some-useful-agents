/**
 * A notebook's conversation with sua: as you talk, sua adds what you said to
 * the notebook (notes, options, evidence, ruled-out decisions, parameters,
 * criteria) with a `notebook-add` action, and suggests a pipeline with a
 * `notebook-pipeline` card you approve. Triage sees the notebook it's in.
 */
import {
  NotebookStore, entryKey, NOTEBOOK_ENTRY_KINDS, validateScheduleInterval, cronToHuman,
  type Notebook, type NotebookEntryKind, type NotebookFieldValue,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { formatFieldValue } from '../views/notebooks.js';

type Ctx = ReturnType<typeof getContext>;

export const notebooksOf = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());

const strList = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean).slice(0, max);

export interface NotebookAdd {
  /** Options may carry their facts (by the notebook's field keys) and a fingerprint. */
  entries: Array<{ kind: NotebookEntryKind; title: string; body: string; data?: Record<string, unknown>; fingerprint?: string }>;
  params: string[];
  criteria: string[];
  statement?: string;
  /** The params given are the whole new list (they replace limits they contradict). */
  replaceParams?: boolean;
  /** The steps options go through (replaces the list). */
  stages?: string[];
  /** Options to move to a stage, named by title (or part of it), fingerprint or id. */
  moves: Array<{ option: string; stage: string }>;
  /** Options to rule out, with why ("no callback", "didn't like it"). */
  ruleOut: Array<{ option: string; reason: string }>;
  /** Ruled-out options to bring back. */
  reinstate: string[];
  /** Options that aren't available any more (sold, filled, taken down). */
  gone: string[];
  /** Done-when criteria now met, by their text (or part of it). */
  met: string[];
  /** Corrections to an option's facts, on their word: {option, data: {price: 136.64}}. */
  update: Array<{ option: string; data: Record<string, unknown> }>;
}

/** CHANGES as sua sends it: {entries?, params?, criteria?, statement?}. */
export function parseNotebookAdd(raw: string): { add?: NotebookAdd; error?: string } {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { error: 'CHANGES is not JSON.' }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'CHANGES must be an object.' };
  const o = v as { entries?: unknown; params?: unknown; criteria?: unknown; statement?: unknown; stages?: unknown; moves?: unknown; ruleOut?: unknown; reinstate?: unknown };
  const refs = <K extends string>(list: unknown, key: K): Array<{ option: string } & Record<K, string>> =>
    (Array.isArray(list) ? list.slice(0, 20) : [])
      .map((x) => x as { option?: unknown } & Record<K, unknown>)
      .filter((x) => typeof x.option === 'string' && x.option.trim() && typeof x[key] === 'string')
      .map((x) => ({ option: String(x.option).trim(), [key]: String(x[key]).trim() }) as { option: string } & Record<K, string>);
  const entries: NotebookAdd['entries'] = [];
  for (const e of Array.isArray(o.entries) ? o.entries.slice(0, 12) : []) {
    const x = e as { kind?: unknown; title?: unknown; body?: unknown; data?: unknown; fingerprint?: unknown };
    if (typeof x.title !== 'string' || !x.title.trim() || !(NOTEBOOK_ENTRY_KINDS as readonly string[]).includes(String(x.kind))) continue;
    entries.push({
      kind: x.kind as NotebookEntryKind, title: x.title.trim(), body: typeof x.body === 'string' ? x.body : '',
      ...(x.kind === 'option' && x.data && typeof x.data === 'object' && !Array.isArray(x.data) ? { data: x.data as Record<string, unknown> } : {}),
      ...(x.kind === 'option' && typeof x.fingerprint === 'string' && x.fingerprint.trim() ? { fingerprint: x.fingerprint } : {}),
    });
  }
  const add: NotebookAdd = {
    entries,
    params: strList(o.params, 10),
    criteria: strList(o.criteria, 10),
    ...(typeof o.statement === 'string' && o.statement.trim() ? { statement: o.statement.trim().slice(0, 500) } : {}),
    ...((o as { replaceParams?: unknown }).replaceParams === true ? { replaceParams: true } : {}),
    ...(Array.isArray(o.stages) && strList(o.stages, 8).length ? { stages: strList(o.stages, 8) } : {}),
    moves: refs(o.moves, 'stage'),
    ruleOut: refs(o.ruleOut, 'reason'),
    reinstate: strList(o.reinstate, 20),
    met: strList((o as { met?: unknown }).met, 10),
    gone: strList((o as { gone?: unknown }).gone, 20),
    update: (Array.isArray((o as { update?: unknown }).update) ? (o as { update: unknown[] }).update.slice(0, 20) : [])
      .map((x) => x as { option?: unknown; data?: unknown })
      .filter((x) => typeof x.option === 'string' && x.option.trim() && x.data && typeof x.data === 'object' && !Array.isArray(x.data) && Object.keys(x.data).length)
      .map((x) => ({ option: String(x.option).trim(), data: x.data as Record<string, unknown> })),
  };
  if (!add.entries.length && !add.params.length && !add.criteria.length && !add.statement && !add.stages && !add.moves.length && !add.ruleOut.length && !add.reinstate.length && !add.met.length && !add.gone.length && !add.update.length) return { error: 'Nothing to add.' };
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
    // An option with facts is filed as data (and found again by its fingerprint).
    if (e.kind === 'option') {
      const r = store.upsertOption(nb.id, { title: e.title, body: e.body, by, ...(e.data ? { data: e.data } : {}), ...(e.fingerprint ? { fingerprint: e.fingerprint } : {}) });
      if (r.seenAgain) { skipped++; continue; }
    } else {
      store.addEntry(nb.id, { kind: e.kind, title: e.title, body: e.body, by });
    }
    added.push(`${e.kind}: ${e.title}`);
  }
  if (add.replaceParams && add.params.length) {
    // The new list replaces the old: say what changed, not just what's new.
    const was = new Set(nb.params.map((p) => p.toLowerCase()));
    store.update(nb.id, { params: add.params });
    for (const p of add.params) if (!was.has(p.toLowerCase())) added.push(`parameter: ${p}`);
    const now = new Set(add.params.map((p) => p.toLowerCase()));
    for (const p of nb.params) if (!now.has(p.toLowerCase())) added.push(`dropped parameter: ${p}`);
  }
  const before = { params: (add.replaceParams && add.params.length ? add.params : nb.params).length, criteria: nb.criteria.length };
  const after = store.extend(nb.id, { params: add.replaceParams ? [] : add.params, criteria: add.criteria });
  for (const p of after.params.slice(before.params)) added.push(`parameter: ${p}`);
  for (const c of after.criteria.slice(before.criteria)) added.push(`done when: ${c.text}`);
  if (add.statement && !nb.statement) { store.update(nb.id, { statement: add.statement }); added.push(`what it's for: ${add.statement}`); }
  if (add.stages) { store.setStages(nb.id, add.stages); added.push(`stages: ${add.stages.join(' → ')}`); }
  // Moves and rulings name an option; one that matches nothing (or several) is reported, not guessed.
  const option = (ref: string) => {
    const o = store.findOption(nb.id, ref);
    if (!o) added.push(`couldn't find an option matching "${ref}"`);
    return o;
  };
  for (const m of add.moves) {
    const o = option(m.option);
    if (!o) continue;
    try { store.moveOption(nb.id, o.id, m.stage); added.push(`moved: ${o.title} → ${m.stage}`); } catch (err) { added.push(err instanceof Error ? err.message : `couldn't move ${o.title}`); }
  }
  for (const r of add.ruleOut) {
    const o = option(r.option);
    if (!o) continue;
    store.ruleOut(nb.id, o.id, r.reason, by);
    added.push(`ruled out: ${o.title} (${r.reason})`);
  }
  for (const ref of add.gone) {
    const o = option(ref);
    if (!o) continue;
    store.ruleOut(nb.id, o.id, 'No longer available', by, { gone: true });
    added.push(`no longer available: ${o.title}`);
  }
  for (const ref of add.reinstate) {
    const o = option(ref);
    if (!o) continue;
    store.reinstate(nb.id, o.id);
    added.push(`brought back: ${o.title}`);
  }
  // Corrections change the option's own facts (and its card, page and chart), not a note beside it.
  for (const u of add.update) {
    const o = option(u.option);
    if (!o) continue;
    const { changed } = store.correctOption(nb.id, o.id, u.data, by);
    const fields = store.get(nb.id)!.fields;
    const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
    const show = (k: string, v: NotebookFieldValue) => { const f = fields.find((x) => x.key === k); return f ? formatFieldValue(f, v) : String(v); };
    if (changed.length) added.push(`corrected: ${o.title} (${changed.map((c) => `${label(c.key)} ${c.from !== undefined ? `${show(c.key, c.from)} → ` : ''}${show(c.key, c.to)}`).join(', ')})`);
    else added.push(`no change: ${o.title} already has that`);
  }
  for (const text of add.met) {
    const cur = store.get(nb.id)!;
    const k = entryKey(text);
    const i = cur.criteria.findIndex((c) => entryKey(c.text) === k || (k.length > 3 && entryKey(c.text).includes(k)));
    if (i < 0) { added.push(`couldn't find a done-when matching "${text}"`); continue; }
    if (cur.criteria[i].met) continue;
    store.markCriterion(nb.id, i, true);
    added.push(`met: ${cur.criteria[i].text}`);
  }
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
  const entries = store.entries(nb.id, 60).map((e) => `${e.kind}: ${e.title}${e.ruledOut ? ` — RULED OUT at ${e.ruledOut.stage ?? 'start'}: ${e.ruledOut.reason}` : e.stage ? ` [${e.stage}]` : ''}`);
  return JSON.stringify({
    id: nb.id, title: nb.title, for: nb.statement, status: nb.status,
    params: nb.params, criteria: nb.criteria, stages: nb.stages, pipeline: nb.pipeline, cadence: nb.cadence,
    fields: nb.fields.map((f) => ({ key: f.key, type: f.type, ...(f.unit ? { unit: f.unit } : {}), ...(f.role ? { role: f.role } : {}) })),
    entries, link: `/notebooks/${encodeURIComponent(nb.id)}`,
  });
}

/** The notebook's conversation with sua: the one it has, else a new one linked to it. */
export function notebookThread(ctx: Ctx, nb: Notebook): string | undefined {
  if (!ctx.inboxStore) return undefined;
  const existing = nb.conversationId && ctx.inboxStore.get(nb.conversationId) ? nb.conversationId : undefined;
  if (existing) return existing;
  const created = ctx.inboxStore.add({
    priority: 'medium', source: 'manual', title: `Notebook: ${nb.title}`, body: '(empty)',
    contextJson: JSON.stringify({ page: { path: `/notebooks/${encodeURIComponent(nb.id)}`, title: nb.title, kind: 'notebook', id: nb.id } }),
  });
  notebooksOf(ctx).setConversation(nb.id, created.id);
  return created.id;
}

/**
 * sua's first message in a new notebook: what it set up (what each option
 * records, the stages, what "done" means) and the one most useful thing to
 * say first. Plain words, no tool or field names.
 */
export function notebookGreeting(nb: Notebook, hasOptions = false): string {
  const tracked = nb.fields.filter((f) => f.role !== 'image' && f.type !== 'image').map((f) => f.label.toLowerCase());
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  // The one most useful thing to say first, in sua's own words.
  const first = !nb.statement
    ? "What's this notebook for? A sentence is enough."
    : nb.params.length === 0
      ? 'What are your limits? Budget, must-haves, deal-breakers, and where to look.'
      : !hasOptions
        ? "Tell me about any you've already seen, or ask me to search and I'll add what I find here."
        : 'Tell me what you think of the ones here, or ask me to look for more.';
  // The question first: a preview that cuts the message short still asks it.
  const lines = [
    `I've started **${nb.title}**. ${first}`,
    '',
    "Here's how I'll keep it:",
    tracked.length ? `- **For each option** I'll note its ${list(tracked.slice(0, 7))}, so you can compare them side by side.` : `- **For each option** I'll note what matters for comparing them, once we've seen a few.`,
    nb.stages.length ? `- **Each one moves along:** ${nb.stages.join(' → ')}. Tell me when one moves, or when you rule one out (and why).` : '',
    nb.criteria.length ? `- **Done when:** ${nb.criteria.map((c) => lower(c.text)).join('; ')}.` : `- **When are we done?** Tell me what "done" looks like and I'll track it.`,
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').filter((l) => l !== undefined).join('\n').replace(/\n\n+/g, '\n\n');
}

/** Post the greeting into the notebook's conversation (once: only when it has none yet). */
export function greetNotebook(ctx: Ctx, notebookId: string): string | undefined {
  const store = notebooksOf(ctx);
  const nb = store.get(notebookId);
  if (!nb || nb.conversationId || !ctx.inboxStore) return undefined;
  const threadId = notebookThread(ctx, nb);
  if (!threadId) return undefined;
  const now = store.get(notebookId) ?? nb;
  ctx.inboxStore.addResponse(threadId, 'triage', notebookGreeting(now, store.entries(notebookId, 50).some((e) => e.kind === 'option')));
  ctx.inboxStore.updateStatus(threadId, 'awaiting_user');
  return threadId;
}
