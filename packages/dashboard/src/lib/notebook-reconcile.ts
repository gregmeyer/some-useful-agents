/**
 * Who a notebook is about, against what its steps found (PR 2 of the meeting
 * plan): sua's reconciler (`notebook-reconciler`) names where what was found
 * says something else about the present (their role, their company, where
 * they're based), each side with its source, and the question it raises.
 * The conflicts are kept on who they're about (core NotebookAboutOne.conflicts)
 * and shown at the top of the notebook until settled: you pick one, or sua
 * checks it (research-one, as of today) and the sourced answer is kept.
 */
import { NotebookStore, cleanConflicts, extractTaggedJson, notebookViewData, openConflicts, type Notebook, type NotebookAboutWho, type NotebookEntry } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { publishInboxEvent } from '../routes/inbox-shared.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { research, readResearch } from './notebook-profile.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_RECONCILER_ID = 'notebook-reconciler';

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');

/** What the reconciler reads: who it's about (facts with sources) and what was found (each with its id, facts, source, when). Pure. */
export function reconcilerInputs(nb: Notebook, entries: readonly NotebookEntry[], today = new Date().toISOString().slice(0, 10)): Record<string, string> {
  const people = Object.fromEntries((['person', 'company'] as const).filter((w) => nb.about?.[w]).map((w) => {
    const one = nb.about![w]!;
    return [w, { name: one.name, facts: one.facts.map((f) => ({ key: f.key, label: f.label, value: f.value, ...(f.source ? { source: f.source } : {}) })) }];
  }));
  const options = notebookViewData(nb, entries).notebook.options.filter((o) => !o.ruledOut);
  const found = options.slice(0, 30).map((o) => {
    const facts = Object.fromEntries(nb.fields.filter((f) => f.role !== 'link' && f.role !== 'image' && text(o.fields[f.key])).map((f) => [f.label, text(o.fields[f.key]).slice(0, 300)]));
    return { id: o.id, title: o.name, ...(Object.keys(facts).length ? { facts } : {}), ...(o.link ? { source: o.link } : {}), ...(o.when ? { when: o.when } : {}) };
  });
  return { PEOPLE: JSON.stringify(people), FOUND: JSON.stringify(found), TODAY: today };
}

async function runReconciler(ctx: Ctx, inputs: Record<string, string>): Promise<{ result?: string; error?: string }> {
  if (ctx.notebookReconcilerRun) return { result: await ctx.notebookReconcilerRun(inputs) };
  if (!ensureSystemAgentCurrent(ctx, NOTEBOOK_RECONCILER_ID, 'notebook conflicts')) return { error: `${NOTEBOOK_RECONCILER_ID} isn't installed` };
  const agent = ctx.agentStore.getAgent(NOTEBOOK_RECONCILER_ID);
  if (!agent) return { error: `${NOTEBOOK_RECONCILER_ID} isn't installed` };
  const run = await runDispatchedAgentToTerminal(ctx, agent, inputs);
  return run.status === 'completed' ? { result: run.result } : { error: run.error ?? run.status };
}

/**
 * Check who it's about against what was found, and keep what disagrees.
 * Only for a notebook that knows who it's about and has found something.
 * Returns a line for the step's log; never throws.
 */
export async function reconcileAbout(ctx: Ctx, store: NotebookStore, notebookId: string): Promise<string | undefined> {
  const nb = store.get(notebookId);
  if (!nb || !(nb.about?.person || nb.about?.company)) return undefined;
  const entries = store.entries(nb.id, 1000);
  const ids = new Set(entries.filter((e) => e.kind === 'option' && !e.ruledOut).map((e) => e.id));
  if (!ids.size) return undefined;
  try {
    const { result, error } = await runReconciler(ctx, reconcilerInputs(nb, entries));
    if (!result) return `${NOTEBOOK_RECONCILER_ID}: ${error ?? 'no answer'}`;
    const block = extractTaggedJson(result, 'conflicts');
    let raw: unknown;
    try { raw = block ? JSON.parse(block) : undefined; } catch { raw = undefined; }
    if (raw === undefined) return `${NOTEBOOK_RECONCILER_ID}: no answer came back`;
    const now = store.get(nb.id);
    if (!now) return undefined;
    const found = cleanConflicts(raw, now.about, ids);
    for (const who of ['person', 'company'] as const) if (now.about?.[who]) store.setAboutConflicts(nb.id, who, found[who] ?? []);
    const open = (['person', 'company'] as const).flatMap((w) => openConflicts(store.get(nb.id)?.about?.[w]));
    return open.length ? `${String(open.length)} thing${open.length === 1 ? '' : 's'} found disagree${open.length === 1 ? 's' : ''} with who they are` : undefined;
  } catch (err) {
    return `${NOTEBOOK_RECONCILER_ID}: ${err instanceof Error ? err.message.slice(0, 120) : 'it failed'}`;
  }
}

const same = (a: string, b: string) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
};

/**
 * Check it: sua looks up the fact as it is today, with both sides as leads;
 * a sourced answer settles it (the fact takes it, with its source), else it
 * stays open, said in the notebook. Runs in the background.
 */
export function startConflictCheck(ctx: Ctx, notebookId: string, who: NotebookAboutWho, fact: string): { started: boolean; reason?: string } {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  const one = nb?.about?.[who];
  const c = openConflicts(one).find((x) => x.fact === fact);
  if (!nb || !one || !c) return { started: false, reason: "That isn't an open question about them." };
  const key = `${notebookId}|${who}|${fact}`;
  ctx.notebookConflictChecks ??= new Set();
  if (ctx.notebookConflictChecks.has(key)) return { started: false, reason: 'sua is already checking it.' };
  ctx.notebookConflictChecks.add(key);
  const today = new Date().toISOString().slice(0, 10);
  const leads = c.claims.map((x) => `"${x.value}"${x.source ? ` (${x.source}${x.when ? `, ${x.when}` : ''})` : x.when ? ` (${x.when})` : ''}`).join(' vs ');
  const ask = JSON.stringify([{ key: fact, label: c.label, hint: `as of today, ${today}: sources disagree, ${leads}. Give the current one, with the page that says so and its date.` }]);
  void (async () => {
    try {
      const out = await research(ctx, { SUBJECT: one.name, ASK: ask, CONTEXT: nb.statement || nb.title, DEPTH: 'quick' });
      const got = readResearch(out.result)?.found?.[fact];
      const value = text(got?.value);
      const source = typeof got?.source === 'string' && /^https?:\/\//i.test(got.source) ? got.source : undefined;
      if (value && source) {
        const match = c.claims.find((x) => same(x.value, value));
        const quote = text(got?.quote);
        store.settleConflict(notebookId, who, fact, { value: match?.value ?? value, by: 'research', source, why: quote ? `“${quote.slice(0, 200)}”` : `Checked ${today}` });
        store.addEntry(notebookId, { kind: 'note', title: `Checked: ${c.label} is ${match?.value ?? value}`, body: `${one.name}. ${quote ? `“${quote.slice(0, 200)}” ` : ''}${source}`, by: 'agent:research-one' });
      } else {
        store.addEntry(notebookId, { kind: 'note', title: `Couldn't confirm ${c.label.toLowerCase()} for ${one.name}`, body: out.error ? `research-one: ${out.error.slice(0, 160)}` : 'No page today says which is current. Pick the one you know is right.', by: 'agent:research-one' });
      }
    } catch { /* stays open */ } finally {
      ctx.notebookConflictChecks?.delete(key);
      const threadId = store.get(notebookId)?.conversationId;
      if (threadId) { try { publishInboxEvent(ctx, threadId, 'thread:updated', {}); } catch { /* no live page */ } }
    }
  })();
  return { started: true };
}

/** Whether sua is checking a conflict on this notebook now. */
export function checkingConflict(ctx: Ctx, notebookId: string, who: NotebookAboutWho, fact: string): boolean {
  return !!ctx.notebookConflictChecks?.has(`${notebookId}|${who}|${fact}`);
}
