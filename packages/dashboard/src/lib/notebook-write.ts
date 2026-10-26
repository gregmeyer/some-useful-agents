/**
 * A write step: sua's writer (`notebook-writer`) writes what the notebook
 * was for from what it has. For a meeting, the talking points: each a point
 * to raise, why it matters to them, a question, and the themes it rests on
 * (by id: the quotes and sources shown with it are the themes' own, never
 * the writer's words), then more questions and what to watch for. Kept on
 * the notebook (Notebook.briefing); the agenda and the brief show it.
 */
import { NotebookStore, cleanBriefing, extractTaggedJson, notebookViewData, type Notebook, type NotebookEntry, type NotebookStep } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { NOTEBOOK_WRITER_ID } from './notebook-step-agents.js';

type Ctx = ReturnType<typeof getContext>;

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');

/** What the writer reads: the notebook (what it's for, who it's about) and its themes (what they said, each with its id). Pure. */
export function writerInputs(nb: Notebook, entries: readonly NotebookEntry[], step: Pick<NotebookStep, 'target'>): Record<string, string> {
  const quoteF = nb.fields.find((f) => f.role === 'quote');
  const askF = nb.fields.find((f) => f.role === 'ask');
  const options = notebookViewData(nb, entries).notebook.options.filter((o) => !o.ruledOut);
  const about = (who: 'person' | 'company') => {
    const one = nb.about?.[who];
    return one ? { name: one.name, ...(one.summary ? { summary: one.summary } : {}), facts: one.facts.map((f) => `${f.label}: ${f.value}`) } : undefined;
  };
  const themes = options.map((o) => {
    const rest = Object.fromEntries(nb.fields.filter((f) => f !== quoteF && f !== askF && f.role !== 'link' && f.role !== 'image' && text(o.fields[f.key])).map((f) => [f.label, text(o.fields[f.key]).slice(0, 200)]));
    return {
      id: o.id, title: o.name,
      ...(quoteF && text(o.fields[quoteF.key]) ? { said: text(o.fields[quoteF.key]).slice(0, 500) } : {}),
      ...(askF && text(o.fields[askF.key]) ? { question: text(o.fields[askF.key]).slice(0, 200) } : {}),
      ...(o.link ? { source: o.link } : {}), ...(o.when ? { when: o.when } : {}),
      ...(o.chosen ? { chosen: true } : {}), ...(o.checked.length ? { checked: o.checked } : {}),
      ...(Object.keys(rest).length ? { facts: rest } : {}),
    };
  });
  const person = about('person');
  const company = about('company');
  return {
    NOTEBOOK: JSON.stringify({
      title: nb.title, for: nb.statement, limits: nb.params, doneWhen: nb.criteria.map((c) => c.text),
      ...(person ? { person } : {}), ...(company ? { company } : {}),
    }),
    THEMES: JSON.stringify(themes.slice(0, 30)),
    COUNT: String(Math.min(8, Math.max(3, step.target ?? 4))),
  };
}

async function runWriter(ctx: Ctx, inputs: Record<string, string>): Promise<{ result?: string; error?: string }> {
  if (ctx.notebookWriterRun) return { result: await ctx.notebookWriterRun(inputs) };
  const agent = ctx.agentStore.getAgent(NOTEBOOK_WRITER_ID);
  if (!agent) return { error: `${NOTEBOOK_WRITER_ID} isn't installed` };
  const run = await runDispatchedAgentToTerminal(ctx, agent, inputs);
  return run.status === 'completed' ? { result: run.result } : { error: run.error ?? run.status };
}

/** Write the notebook's talking points (a write step's run). Returns what happened, a line each; never throws. */
export async function writeBriefing(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep): Promise<string[]> {
  const nb = store.get(notebookId);
  if (!nb) return [];
  const entries = store.entries(nb.id, 1000);
  const ids = new Set(entries.filter((e) => e.kind === 'option' && !e.ruledOut).map((e) => e.id));
  if (!ids.size) return ['there is nothing to write from yet: no themes in the running'];
  try {
    const { result, error } = await runWriter(ctx, writerInputs(nb, entries, step));
    if (!result) return [`${NOTEBOOK_WRITER_ID}: ${error ?? 'no answer'}`];
    const block = extractTaggedJson(result, 'briefing');
    let raw: unknown;
    try { raw = block ? JSON.parse(block) : undefined; } catch { raw = undefined; }
    const briefing = cleanBriefing(raw, ids, NOTEBOOK_WRITER_ID);
    if (!briefing) return [`${NOTEBOOK_WRITER_ID}: no talking points came back`];
    store.setBriefing(nb.id, briefing);
    return [`wrote ${String(briefing.points.length)} talking points${briefing.questions.length ? ` and ${String(briefing.questions.length)} questions` : ''}`];
  } catch (err) {
    return [`${NOTEBOOK_WRITER_ID}: ${err instanceof Error ? err.message.slice(0, 120) : 'it failed'}`];
  }
}
