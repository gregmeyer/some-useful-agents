/**
 * A write step: sua's writer (`notebook-writer`) writes what the notebook
 * was for from what it has. For a meeting, the talking points: each a point
 * to raise, why it matters to them, a question, and the themes it rests on
 * (by id: the quotes and sources shown with it are the themes' own, never
 * the writer's words), then more questions and what to watch for. Kept on
 * the notebook (Notebook.briefing); the agenda and the brief show it.
 * For a plan (shape "plan"), the plan in order, a day or slot each, with
 * what to do first and what's open (Notebook.plan); the Plan page shows it.
 * For a question (a step with shape "answer"), the answer: how sure and
 * why, the findings it rests on (by id, the same way), and what's still
 * open (Notebook.answer); the Answer page and the brief show it.
 */
import { notebookAffiliations } from './notebook-widgets.js';
import { NotebookStore, openConflicts, cleanBriefing, cleanAnswer, cleanPlan, extractTaggedJson, notebookViewData, type Notebook, type NotebookEntry, type NotebookStep } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { NOTEBOOK_WRITER_ID } from './notebook-step-agents.js';
import { reconcileAbout } from './notebook-reconcile.js';

type Ctx = ReturnType<typeof getContext>;

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');

/** Whole days from today to a meeting's date, both as local dates (not UTC: an evening isn't tomorrow). */
export function daysUntil(when: string, now = new Date()): number {
  const [y, m, d] = when.split('T')[0].split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
}

/** What the writer reads: the notebook (what it's for, who it's about) and its themes (what they said, each with its id). Pure. */
export function writerInputs(nb: Notebook, entries: readonly NotebookEntry[], step: Pick<NotebookStep, 'target' | 'shape'>): Record<string, string> {
  const quoteF = nb.fields.find((f) => f.role === 'quote');
  const askF = nb.fields.find((f) => f.role === 'ask');
  const options = notebookViewData(nb, entries).notebook.options.filter((o) => !o.ruledOut);
  const about = (who: 'person' | 'company') => {
    const one = nb.about?.[who];
    // A fact sources disagree on isn't stated as true: the writer gets both sides.
    const open = openConflicts(one);
    return one ? {
      name: one.name, ...(one.summary ? { summary: one.summary } : {}), facts: one.facts.filter((f) => !open.some((c) => c.fact === f.key)).map((f) => `${f.label}: ${f.value}`),
      ...(open.length ? { unsettled: open.map((c) => ({ fact: c.label, sides: c.claims.map((x) => `${x.value}${x.when ? ` (${x.when})` : ''}`), question: c.question })) } : {}),
      // Its competitors, named on a page, with how each competes.
      ...(one.competitors?.length ? { competitors: one.competitors.map((c) => `${c.name}${c.how ? `: ${c.how}` : ''}`) } : {}),
      // A person's other companies (and any a settled conflict set aside).
      ...(who === 'person' && notebookAffiliations(nb).length ? { otherCompanies: notebookAffiliations(nb).map((a) => `${a.name}${a.role ? ` (${a.role})` : ''}`) } : {}),
    } : undefined;
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
  // An answer also reads the notes its research left (what a search said it found, or couldn't).
  const notes = step.shape === 'answer' || step.shape === 'plan'
    ? entries.filter((e) => e.kind === 'note' && !/^Met: /.test(e.title)).slice(0, 12).map((e) => `${e.title}${e.body ? `: ${e.body}` : ''}`.replace(/\s+/g, ' ').slice(0, 400))
    : [];
  // The meeting it prepares for: when (and how soon), your goal, what you know.
  const m = nb.meeting;
  const meeting = m ? {
    ...(m.when ? { when: m.when, daysAway: daysUntil(m.when) } : {}),
    ...(m.goal ? { goal: m.goal } : {}), ...(m.notes ? { notes: m.notes } : {}),
  } : undefined;
  return {
    NOTEBOOK: JSON.stringify({
      title: nb.title, for: nb.statement, limits: nb.params, doneWhen: nb.criteria.map((c) => c.text),
      ...(person ? { person } : {}), ...(company ? { company } : {}), ...(notes.length ? { notes } : {}),
      ...(meeting && Object.keys(meeting).length ? { meeting } : {}),
    }),
    THEMES: JSON.stringify(themes.slice(0, 30)),
    COUNT: String(Math.min(8, Math.max(3, step.target ?? 4))),
    SHAPE: step.shape === 'answer' ? 'answer' : step.shape === 'plan' ? 'plan' : 'talking points',
  };
}

async function runWriter(ctx: Ctx, inputs: Record<string, string>, onRun?: (runId: string) => void): Promise<{ result?: string; error?: string }> {
  if (ctx.notebookWriterRun) return { result: await ctx.notebookWriterRun(inputs) };
  const agent = ctx.agentStore.getAgent(NOTEBOOK_WRITER_ID);
  if (!agent) return { error: `${NOTEBOOK_WRITER_ID} isn't installed` };
  const run = await runDispatchedAgentToTerminal(ctx, agent, inputs);
  onRun?.(run.id);
  return run.status === 'completed' ? { result: run.result } : { error: run.error ?? run.status };
}

/** Write what the notebook was for (a write step's run): its talking points, or its answer. Returns what happened, a line each; never throws. */
export async function writeBriefing(ctx: Ctx, store: NotebookStore, notebookId: string, step: NotebookStep, onRun?: (runId: string) => void): Promise<string[]> {
  if (!store.get(notebookId)) return [];
  // Talking points: first check who they are against what was found, so the points don't state a contested fact.
  const reconciled = !step.shape ? await reconcileAbout(ctx, store, notebookId) : undefined;
  if (reconciled) store.noteRun(notebookId, reconciled);
  const nb = store.get(notebookId);
  if (!nb) return [];
  const entries = store.entries(nb.id, 1000);
  const ids = new Set(entries.filter((e) => e.kind === 'option' && !e.ruledOut).map((e) => e.id));
  if (!ids.size) return [step.shape === 'answer' ? 'there is nothing to answer from yet: nothing found is in the running' : step.shape === 'plan' ? 'there is nothing to plan with yet: nothing found is in the running' : 'there is nothing to write from yet: no themes in the running'];
  try {
    const { result, error } = await runWriter(ctx, writerInputs(nb, entries, step), onRun);
    if (!result) return [`${NOTEBOOK_WRITER_ID}: ${error ?? 'no answer'}`];
    if (step.shape === 'plan') {
      const block = extractTaggedJson(result, 'plan');
      let raw: unknown;
      try { raw = block ? JSON.parse(block) : undefined; } catch { raw = undefined; }
      const plan = cleanPlan(raw, ids, NOTEBOOK_WRITER_ID);
      if (!plan) return [`${NOTEBOOK_WRITER_ID}: no plan came back`];
      store.setPlan(nb.id, plan);
      const days = new Set(plan.items.map((i) => i.when)).size;
      return [`wrote the plan: ${String(plan.items.length)} thing${plan.items.length === 1 ? '' : 's'} over ${String(days)} day${days === 1 ? '' : 's'} or slots`];
    }
    if (step.shape === 'answer') {
      const block = extractTaggedJson(result, 'answer');
      let raw: unknown;
      try { raw = block ? JSON.parse(block) : undefined; } catch { raw = undefined; }
      const answer = cleanAnswer(raw, ids, nb.statement || nb.title, NOTEBOOK_WRITER_ID);
      if (!answer) return [`${NOTEBOOK_WRITER_ID}: no answer came back`];
      store.setAnswer(nb.id, answer);
      return [`wrote the answer (${answer.confidence} confidence) with ${String(answer.findings.length)} finding${answer.findings.length === 1 ? '' : 's'}`];
    }
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
