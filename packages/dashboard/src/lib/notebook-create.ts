/**
 * Start a notebook: the one way, for the New notebook form (from a draft or
 * not) and for sua starting one from a template. It's created with what it's
 * for and its limits; given its steps, fields, stages and checks when it has
 * them (setup is then skipped); otherwise sua sets those up and lays out its
 * steps. Then it decides its page (unless it came with one, a template's),
 * and sua says hello in the notebook's conversation.
 */
import { NotebookStore, templateFromNotebook, type Notebook, type NotebookStep, type NotebookLayout, type NotebookMeeting } from '@some-useful-agents/core';
import { fitStepAgents, startNotebookStep, stopNotebookStep } from './notebook-steps.js';
import { reconcileStepCards } from './notebook-step-queue.js';
import type { getContext } from '../context.js';
import { layOutNotebookSteps } from './notebook-draft.js';
import { startNotebookSetup } from './notebook-pipeline.js';
import { greetNotebook } from './notebook-chat.js';
import { decideNotebookPage } from './notebook-page.js';
import { startNotebookTags } from './notebook-tags.js';
import { publishInboxChanged } from '../routes/inbox-shared.js';

type Ctx = ReturnType<typeof getContext>;

export interface NewNotebookSetup {
  title: string;
  statement: string;
  params: string[];
  criteria: string[];
  pipeline?: string[];
  cadence?: string;
  /** What each option notes: with these, sua's setup is skipped. */
  fields?: unknown[];
  stages?: string[];
  checks?: string[];
  /** The steps sua takes; without them, sua lays them out once it's set up. */
  steps?: NotebookStep[];
  /** Its page's layout (a template's); without it, the default. */
  layout?: NotebookLayout;
  /** Whose the page is (`layoutBy`): a template's unless said (a rerun keeps the old notebook's, so sua still composes it). */
  layoutBy?: string;
  /** The meeting it prepares for. */
  meeting?: NotebookMeeting;
  /** A notebook whose tags it starts with (run again: the same topic, and your changes to its tags). */
  tagsFrom?: string;
}

export function createNotebookFrom(ctx: Ctx, input: NewNotebookSetup): Notebook {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.create({
    title: input.title,
    statement: input.statement,
    params: input.params,
    criteria: input.criteria,
    pipeline: input.pipeline ?? [],
    cadence: input.cadence ?? '',
  });
  // Its fields first: a source step's facts are kept only when they name the notebook's fields.
  if (input.fields?.length) {
    store.setFields(nb.id, input.fields);
    if (input.stages?.length) store.setStages(nb.id, input.stages);
    if (input.checks?.length) store.setChecks(nb.id, input.checks);
    store.markSetup(nb.id);
  }
  // A page reader can't find or check: those steps go to sua's finder or checker.
  const steps = input.steps?.length ? fitStepAgents(ctx, input.steps).steps : undefined;
  if (steps) store.setSteps(nb.id, steps);
  if (input.layout) store.setLayout(nb.id, input.layout, input.layoutBy ?? 'template');
  if (input.meeting) store.setMeeting(nb.id, input.meeting);
  // Its topic tags: another notebook's (run again), or sua tags it in the background.
  if (input.tagsFrom) store.copyTags(input.tagsFrom, nb.id);
  try { startNotebookTags(ctx); } catch { /* it's tagged when the list next opens */ }
  // sua sets up what options record and the stages they go through, from the
  // goal (unless that came with it), then says hello in the notebook's
  // conversation with what it set up.
  const greet = () => {
    if (!store.get(nb.id)) return;
    const threadId = greetNotebook(ctx, nb.id);
    if (threadId) { publishInboxChanged(ctx, threadId, 'awaiting_user'); store.touch(nb.id); }
  };
  // Set up with its steps: it decides its page from what it's for, then sua says hello.
  const pageThenGreet = () => {
    if (input.layout) { greet(); return; }
    void decideNotebookPage(ctx, nb.id).catch(() => undefined).finally(greet);
  };
  // No steps given: sua lays them out once it's set up first.
  const stepsThenGreet = () => {
    if (steps) { pageThenGreet(); return; }
    void layOutNotebookSteps(ctx, nb.id).catch(() => undefined).finally(pageThenGreet);
  };
  if (!startNotebookSetup(ctx, nb.id, { onDone: stepsThenGreet })) stepsThenGreet();
  return store.get(nb.id)!;
}

/**
 * A notebook's setup for running it again as a new notebook: what a
 * template keeps (what it's for, limits, done-whens, checks, stages, fields,
 * steps reset to todo with their agents, schedule, pipeline, its page) plus
 * its title, meeting and whose the page is. None of its content: options,
 * notes, decision, answer or plan, who it's about, photos, history. Pure.
 */
export function rerunSetup(nb: Notebook): NewNotebookSetup {
  const t = templateFromNotebook(nb);
  return {
    title: nb.title, statement: t.statement, params: t.params, criteria: t.criteria, pipeline: t.pipeline, cadence: t.cadence,
    fields: t.fields, stages: t.stages, checks: t.checks, steps: t.steps,
    ...(t.layout ? { layout: t.layout, ...(nb.layoutBy ? { layoutBy: nb.layoutBy } : {}) } : {}),
    ...(nb.meeting ? { meeting: nb.meeting } : {}),
  };
}

/**
 * Run a notebook again as a new one: a fresh notebook with its setup and
 * none of its content, each noting the other, the old one archived (its
 * options, notes, answer and history stay there; Restore brings it back;
 * one already archived stays so), and the new one's first step started.
 * The old one stops: a step of its that's running is stopped, and its step
 * cards in its conversation are retired.
 * No template is made.
 */
export function rerunNotebook(ctx: Ctx, notebookId: string): { notebook: Notebook; started: boolean; reason?: string } {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const old = store.get(notebookId);
  if (!old) throw new Error('No such notebook.');
  const made = createNotebookFrom(ctx, { ...rerunSetup(old), tagsFrom: old.id });
  const link = (n: Notebook) => `[${n.title}](/notebooks/${encodeURIComponent(n.id)})`;
  store.addEntry(made.id, { kind: 'note', title: 'Started again', body: `Started again from ${link(old)}, with its setup and none of what it found. The old one is archived.`, by: 'you' });
  store.addEntry(old.id, { kind: 'note', title: 'Run again', body: `Run again as ${link(made)}; this one ${old.archivedAt ? 'stays' : 'is'} archived.`, by: 'you' });
  stopNotebookStep(ctx, old.id);
  if (!old.archivedAt) store.archive(old.id);
  reconcileStepCards(ctx, old.id);
  const fresh = store.get(made.id)!;
  if (!fresh.fields.length || !fresh.steps?.length) return { notebook: fresh, started: false, reason: fresh.steps?.length ? 'sua is still setting it up; start its first step from the page once it has.' : 'It has no steps; start a search from its page.' };
  const out = startNotebookStep(ctx, made.id);
  return { notebook: store.get(made.id)!, started: out.started, ...(out.started ? {} : { reason: out.reason ?? 'Its first step didn\'t start; start it from the page.' }) };
}
