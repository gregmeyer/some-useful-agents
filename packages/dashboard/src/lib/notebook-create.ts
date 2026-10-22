/**
 * Start a notebook: the one way, for the New notebook form (from a draft or
 * not) and for sua starting one from a template. It's created with what it's
 * for and its limits; given its steps, fields, stages and checks when it has
 * them (setup is then skipped); otherwise sua sets those up and lays out its
 * steps. Then sua says hello in the notebook's conversation.
 */
import { NotebookStore, type Notebook, type NotebookStep } from '@some-useful-agents/core';
import { fitStepAgents } from './notebook-steps.js';
import type { getContext } from '../context.js';
import { layOutNotebookSteps } from './notebook-draft.js';
import { startNotebookSetup } from './notebook-pipeline.js';
import { greetNotebook } from './notebook-chat.js';
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
  // A page reader can't find or check: those steps go to sua's finder or checker.
  const steps = input.steps?.length ? fitStepAgents(ctx, input.steps).steps : undefined;
  if (steps) store.setSteps(nb.id, steps);
  if (input.fields?.length) {
    store.setFields(nb.id, input.fields);
    if (input.stages?.length) store.setStages(nb.id, input.stages);
    if (input.checks?.length) store.setChecks(nb.id, input.checks);
    store.markSetup(nb.id);
  }
  // sua sets up what options record and the stages they go through, from the
  // goal (unless that came with it), then says hello in the notebook's
  // conversation with what it set up.
  const greet = () => {
    if (!store.get(nb.id)) return;
    const threadId = greetNotebook(ctx, nb.id);
    if (threadId) { publishInboxChanged(ctx, threadId, 'awaiting_user'); store.touch(nb.id); }
  };
  // No steps given: sua lays them out once it's set up, then says hello.
  const stepsThenGreet = () => {
    if (steps) { greet(); return; }
    void layOutNotebookSteps(ctx, nb.id).catch(() => undefined).finally(greet);
  };
  if (!startNotebookSetup(ctx, nb.id, { onDone: stepsThenGreet })) stepsThenGreet();
  return store.get(nb.id)!;
}
