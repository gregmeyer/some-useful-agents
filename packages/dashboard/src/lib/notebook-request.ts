/**
 * Notebooks asked for from elsewhere (the MCP server's notebook-create tool,
 * docs/notebooks.md § Notebooks from elsewhere). The MCP server only queues
 * the request (core NotebookRequestStore); the dashboard claims it and makes
 * it the way New notebook would: from a template (startNotebookFrom), or by
 * drafting the ask and starting from the draft. With `start`, its first step
 * starts too. The same queue-and-claim shape as board builds.
 */
import { NotebookRequestStore, NotebookStore, validateScheduleInterval, type Notebook, type NotebookRequest } from '@some-useful-agents/core';
import { inBackground } from './background.js';
import type { getContext } from '../context.js';
import { createNotebookFrom, type NewNotebookSetup } from './notebook-create.js';
import { briefOnFromDraft, discardDraft, draftSteps, readDraft, searchAgents, startNotebookDraft, type NotebookDraft } from './notebook-draft.js';
import { startNotebookStep } from './notebook-steps.js';
import { startNotebookFrom } from '../routes/inbox-engine.js';
import { publishInboxChanged, publishInboxEvent } from '../routes/inbox-shared.js';

type Ctx = ReturnType<typeof getContext>;

const requestsOf = (ctx: Ctx) => new NotebookRequestStore(ctx.runStore.databaseHandle());

/** How long to wait for sua to draft an ask (the drafter's own limit is shorter). */
const DRAFT_WAIT_MS = 10 * 60 * 1000;

/** A title from what was asked: its first sentence, kept short. */
function titleFrom(text: string): string {
  const first = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return first.length <= 60 ? first.replace(/[.!?]$/, '') : `${first.slice(0, 57).replace(/\s+\S*$/, '')}…`;
}

/**
 * A notebook's setup from a ready draft, as New notebook's form would post
 * it untouched: its steps, what it notes, stages and checks (so setup is
 * skipped), who it's a briefing on, and what it needs from you (still to give).
 */
export function setupFromDraft(ctx: Ctx, text: string, draft: NotebookDraft, title?: string): NewNotebookSetup {
  const known = new Set(searchAgents(ctx).map((a) => a.id));
  let cadence = draft.cadence?.trim() ?? '';
  if (cadence) { try { validateScheduleInterval(cadence, {}); } catch { cadence = ''; } }
  const { steps } = draftSteps(draft.steps, known);
  const briefOn = briefOnFromDraft(text, draft);
  const needs = (draft.needs ?? []).map((n) => ({ ...n, text: '' }));
  return {
    title: title?.trim() || draft.title?.trim() || titleFrom(draft.statement || text),
    statement: draft.statement,
    params: draft.params,
    criteria: draft.criteria,
    pipeline: draft.pipeline.filter((id) => known.has(id)),
    cadence,
    asked: text,
    ...(briefOn ? { briefOn } : {}),
    ...(needs.length ? { given: needs } : {}),
    ...(steps ? { steps } : {}),
    ...(draft.meeting ? { meeting: draft.meeting } : {}),
    ...(draft.fields.length ? { fields: draft.fields, stages: draft.stages, checks: draft.checks } : {}),
  };
}

const pause = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/** Draft the ask and wait for it: the draft, or why there isn't one. */
async function draftAsk(ctx: Ctx, ask: string, requestId?: string): Promise<{ text: string; draft: NotebookDraft; draftId: string } | { error: string }> {
  const draftId = startNotebookDraft(ctx, ask);
  if (typeof draftId !== 'string') return draftId;
  if (requestId) requestsOf(ctx).update(requestId, { phase: 'drafting', detail: 'sua is working out how to answer the ask (about a minute)…' });
  const until = Date.now() + DRAFT_WAIT_MS;
  for (let wait = 50; Date.now() < until; wait = Math.min(wait * 2, 2000)) {
    const d = readDraft(ctx, draftId);
    if (!d) return { error: 'The draft went away before it was ready.' };
    if (d.status === 'ready') return { text: d.text, draft: d.draft, draftId };
    if (d.status === 'failed') { discardDraft(ctx, draftId); return { error: d.error }; }
    await pause(wait);
  }
  discardDraft(ctx, draftId);
  return { error: 'sua took too long to draft it.' };
}

/** Make one claimed request: the notebook, or why not. */
async function make(ctx: Ctx, req: NotebookRequest): Promise<{ notebook: Notebook } | { error: string }> {
  const { input } = req;
  if (input.template) {
    const made = startNotebookFrom(ctx, { TEMPLATE: input.template, ...(input.subject ? { SUBJECT: input.subject } : {}), ...(input.title ? { TITLE: input.title } : {}) });
    return 'error' in made ? made : { notebook: made.notebook };
  }
  if (!input.ask) return { error: 'It asked for neither a template nor anything to draft.' };
  const drafted = await draftAsk(ctx, input.ask, req.id);
  if ('error' in drafted) return drafted;
  requestsOf(ctx).update(req.id, { phase: 'creating', detail: 'Making the answer…' });
  const nb = createNotebookFrom(ctx, setupFromDraft(ctx, drafted.text, drafted.draft, input.title));
  discardDraft(ctx, drafted.draftId);
  return { notebook: nb };
}

/** Make a claimed request, start its first step when asked, and record how it went. Never throws. */
export async function runNotebookRequest(ctx: Ctx, requestId: string): Promise<void> {
  const requests = requestsOf(ctx);
  const req = requests.get(requestId);
  if (!req) return;
  let out: { notebook: Notebook } | { error: string };
  try { out = await make(ctx, req); } catch (err) { out = { error: err instanceof Error ? err.message : String(err) }; }
  if ('error' in out) {
    requests.update(requestId, { phase: 'failed', detail: 'The answer wasn’t made.', error: out.error });
    return;
  }
  const nb = out.notebook;
  let detail = `Made "${nb.title}".`;
  if (req.input.start) {
    const started = startNotebookStep(ctx, nb.id);
    detail += started.started
      ? ` Its first step${started.step ? `, ${started.step.title},` : ''} is running.`
      : ` Its first step didn’t start: ${started.reason ?? 'it isn’t ready'}`;
  } else {
    detail += ctx.notebookStepsWait ? ' It waits for the person to start it.' : ' It starts by itself once it’s set up.';
  }
  requests.update(requestId, { phase: 'ready', detail, notebookId: nb.id });
  // The person hears about it: something else started a notebook of theirs.
  try {
    const fresh = NotebookStore.fromHandle(ctx.runStore.databaseHandle()).get(nb.id) ?? nb;
    const msg = ctx.inboxStore?.add({
      priority: 'low',
      source: 'manual',
      title: `An answer was started for you: ${fresh.title}`,
      body: `An agent connected over MCP started [${fresh.title}](/notebooks/${encodeURIComponent(fresh.id)})${req.input.template ? ` from your template "${req.input.template}"` : ` from the ask "${req.input.ask ?? ''}"`}. ${detail}`,
      dedupeKey: `notebook-request:${requestId}`,
      contextJson: JSON.stringify({ kind: 'notebook-request', requestId, notebookId: fresh.id }),
    });
    if (msg) publishInboxChanged(ctx, msg.id);
  } catch { /* the notebook is there either way */ }
}

/** Requests the MCP server queued (or left queued while the dashboard was down): claim each, then make it. */
export function startQueuedNotebookRequests(ctx: Ctx): Array<Promise<void>> {
  const work: Array<Promise<void>> = [];
  try {
    const requests = requestsOf(ctx);
    for (const r of requests.queued()) {
      if (!requests.claim(r.id)) continue;
      work.push(runNotebookRequest(ctx, r.id));
    }
  } catch { /* no table yet */ }
  return work;
}

/** Check for queued requests every few seconds (the timer never keeps the process alive). */
export function watchQueuedNotebookRequests(ctx: Ctx, everyMs = 4000): () => void {
  const t = setInterval(() => { inBackground(ctx, 'startQueuedNotebookRequests', Promise.allSettled(startQueuedNotebookRequests(ctx))); }, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}

/** After a restart: requests that were being made can't resume; say so. */
export function failInterruptedNotebookRequests(ctx: Ctx): void {
  try {
    const requests = requestsOf(ctx);
    for (const r of requests.unfinished()) requests.update(r.id, { phase: 'failed', detail: 'The answer wasn’t made.', error: 'The dashboard restarted while it was being made. Ask again.' });
  } catch { /* no table yet */ }
}

/**
 * A question asked in sua's bar (a `notebook-ask` card, which runs on its
 * own): sua drafts the answer's setup from the question, makes it, and it
 * starts by itself (its greeting starts its first step). Said in the
 * conversation it was asked in, with the link, or why it couldn't. Runs in the
 * background; `then` is for tests.
 */
export function startAskedNotebook(ctx: Ctx, input: { ask: string; title?: string; threadId?: string }, then?: (out: { notebook: Notebook } | { error: string }) => void): void {
  const say = (body: string) => {
    if (!input.threadId || !ctx.inboxStore) return;
    const msg = ctx.inboxStore.addResponse(input.threadId, 'triage', body);
    publishInboxEvent(ctx, input.threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
  };
  const work = (async (): Promise<{ notebook: Notebook } | { error: string }> => {
    const drafted = await draftAsk(ctx, input.ask);
    if ('error' in drafted) return drafted;
    try {
      const nb = createNotebookFrom(ctx, setupFromDraft(ctx, drafted.text, drafted.draft, input.title));
      return { notebook: nb };
    } finally { discardDraft(ctx, drafted.draftId); }
  })().catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
  inBackground(ctx, 'startAskedNotebook', work.then((out) => {
    if ('error' in out) say(`I couldn't set that up: ${out.error} You can [set it up yourself](/notebooks/new?text=${encodeURIComponent(input.ask)}).`);
    else {
      const nb = out.notebook;
      const first = nb.steps?.[0];
      say(`It's under way: [${nb.title}](/notebooks/${encodeURIComponent(nb.id)}).${first ? ` I'm starting with **${first.title}** and will go straight through; its page fills in as I go.` : ''}`);
    }
    then?.(out);
  }));
}
