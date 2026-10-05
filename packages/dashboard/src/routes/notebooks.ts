/**
 * Notebooks (goal surfaces G1): GET /notebooks, POST /notebooks (start one),
 * GET /notebooks/:id (its page), and the forms on it: add / remove an entry,
 * tick a criterion, edit, decide, stop / reopen. Every form redirects back
 * with a flash.
 */
import { Router, type Request, type Response } from 'express';
import {
  NotebookStore, SurfaceStore, compileSurface, notebookEntryItems, notebookViewData, validateScheduleInterval, markdownToText,
  type NotebookEntryKind,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { parseFlash } from './inbox-shared.js';
import { renderNotebookPage, renderNotebooksList, type PipelineStage } from '../views/notebooks.js';
import { startNotebookPipeline, pipelineRunning, startNotebookSetup, setupRunning } from '../lib/notebook-pipeline.js';
import { keepPhotos } from '../lib/notebook-photos.js';
import { publishInboxEvent, publishInboxChanged, isAjax } from './inbox-shared.js';
import { runTriageAgent } from './inbox-engine.js';
import { renderNotebookMain, nextStep } from '../views/notebooks.js';

export const notebooksRouter: Router = Router();

const store = (req: Request) => NotebookStore.fromHandle(getContext(req.app.locals).runStore.databaseHandle());
const lines = (v: unknown): string[] => (typeof v === 'string' ? v.split(/\r?\n/) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const back = (id: string, flash: string, hash = '') => `/notebooks/${encodeURIComponent(id)}?flash=${encodeURIComponent(flash)}${hash}`;

notebooksRouter.get('/notebooks', (req: Request, res: Response) => {
  const s = store(req);
  const notebooks = s.list().map((nb) => ({ nb, entries: s.entries(nb.id, 1000).length }));
  res.type('html').send(renderNotebooksList({ notebooks, openNew: req.query.new === '1', flash: parseFlash(req) }));
});

notebooksRouter.post('/notebooks', (req: Request, res: Response) => {
  try {
    const nb = store(req).create({
      title: str(req.body?.title),
      statement: str(req.body?.statement),
      params: lines(req.body?.params),
      criteria: lines(req.body?.criteria),
    });
    // sua sets up what options record and the stages they go through, from the goal.
    startNotebookSetup(getContext(req.app.locals), nb.id);
    res.redirect(303, back(nb.id, 'Notebook started. sua is setting up what to track for it; tell it what you know.'));
  } catch (err) {
    res.redirect(303, `/notebooks?new=1&flash=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
});

notebooksRouter.get('/notebooks/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).redirect(303, `/notebooks?flash=${encodeURIComponent('No such notebook.')}`); return; }
  // A notebook with options but no fields (kept before fields existed, or
  // filled by talking): set it up once, in the background; the page redraws.
  if (s.needsSetup(nb.id)) startNotebookSetup(ctx, nb.id);
  const entries = s.entries(nb.id);
  const surface = SurfaceStore.fromHandle(ctx.runStore.databaseHandle()).current(`notebook:${nb.id}`);
  const compiled = compileSurface(surface.doc, notebookEntryItems(nb, entries));
  // Each pipeline agent's last run, for the diagram.
  const running = pipelineRunning(ctx, nb.id);
  const stages: PipelineStage[] = nb.pipeline.map((agentId, i) => {
    if (running && running.step === i + 1) return { agentId, status: 'running', note: 'running now' };
    const last = ctx.runStore.listRuns({ agentName: agentId, limit: 1 })[0];
    if (!last) return { agentId, status: 'never', note: ctx.agentStore.getAgent(agentId) ? 'not run yet' : 'not installed' };
    return { agentId, status: last.status === 'failed' ? 'failed' : 'ok', note: last.status === 'failed' ? 'failed' : last.status === 'completed' ? 'ran' : last.status };
  });
  // sua's latest word in the notebook's conversation, so the page shows it remembers.
  const last = nb.conversationId ? ctx.inboxStore?.listResponses(nb.conversationId).filter((r) => r.role === 'triage').pop() : undefined;
  const lastWord = last ? { text: markdownToText(last.body.replace(/<plan>[\s\S]*?<\/plan>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 240) + (last.body.length > 240 ? '…' : ''), at: last.createdAt } : undefined;
  res.type('html').send(renderNotebookPage({ nb, entries, compiled, history: s, settingUp: setupRunning(ctx, nb.id), stages, running: running ? { step: running.step, of: running.of } : undefined, ...(lastWord ? { lastWord } : {}), flash: parseFlash(req) }));
});

notebooksRouter.post('/notebooks/:id/entries', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const kind = str(req.body?.kind) as NotebookEntryKind;
    const entry = store(req).addEntry(id, { kind, title: str(req.body?.title), body: str(req.body?.body), by: 'you' });
    res.redirect(303, back(id, `Added the ${kind}.`, `#entry-${entry.id}`));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/entries/:entry/remove', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const removed = store(req).removeEntry(id, String(req.params.entry));
  res.redirect(303, back(id, removed ? 'Removed.' : 'That entry was already gone.'));
});

// An option's kept photo. Served as an image only: never sniffed, never run.
notebooksRouter.get('/notebooks/:id/entries/:entry/photo', (req: Request, res: Response) => {
  const photo = store(req).photo(String(req.params.entry));
  if (!photo) { res.status(404).end(); return; }
  res.setHeader('Content-Type', photo.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(Buffer.from(photo.bytes));
});

// Look for photos now (they're also fetched after each search).
notebooksRouter.post('/notebooks/:id/photos', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const s = store(req);
  if (!s.get(id)) { res.redirect(303, `/notebooks?flash=${encodeURIComponent('No such notebook.')}`); return; }
  const { kept, tried } = await keepPhotos(s, id);
  res.redirect(303, back(id, tried === 0 ? 'No options with a photo or listing left to try.' : `Found ${String(kept)} photo${kept === 1 ? '' : 's'} for ${String(tried)} option${tried === 1 ? '' : 's'}.`));
});

// An option's stage, ruling it out (it stays, with why), and bringing it back.
notebooksRouter.post('/notebooks/:id/entries/:entry/stage', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const e = store(req).moveOption(id, String(req.params.entry), str(req.body?.stage));
    res.redirect(303, back(id, `${e.title} → ${e.stage ?? ''}`, `#entry-${e.id}`));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/entries/:entry/rule-out', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const e = store(req).ruleOut(id, String(req.params.entry), str(req.body?.reason).trim() || str(req.body?.quick), 'you');
    res.redirect(303, back(id, `Ruled out: ${e.title}. Searches won't suggest it again.`, `#entry-${e.id}`));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/entries/:entry/reinstate', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const e = store(req).reinstate(id, String(req.params.entry));
    res.redirect(303, back(id, `Brought back: ${e.title}.`, `#entry-${e.id}`));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/criteria/:index', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    store(req).markCriterion(id, Number(req.params.index), req.body?.met === '1');
    res.redirect(303, `/notebooks/${encodeURIComponent(id)}`);
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/edit', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const cadence = str(req.body?.cadence).trim();
  try {
    if (cadence) validateScheduleInterval(cadence, {});
    const s = store(req);
    s.update(id, {
      title: str(req.body?.title), statement: str(req.body?.statement),
      params: lines(req.body?.params), pipeline: lines(req.body?.pipeline), cadence,
    });
    s.setCriteria(id, lines(req.body?.criteria));
    if (typeof req.body?.stages === 'string') s.setStages(id, lines(req.body.stages));
    res.redirect(303, back(id, 'Saved.'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, back(id, cadence && /cron|schedule|frequen/i.test(msg) ? `"${cadence}" isn't a schedule sua understands. Use five fields, e.g. 0 7 * * *.` : msg));
  }
});

notebooksRouter.post('/notebooks/:id/decide', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    store(req).decide(id, str(req.body?.decision));
    res.redirect(303, back(id, 'Decided. The notebook is closed; reopen it any time.'));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

notebooksRouter.post('/notebooks/:id/status', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const status = str(req.body?.status);
  if (status !== 'active' && status !== 'stopped') { res.redirect(303, back(id, 'Unknown status.')); return; }
  try {
    store(req).setStatus(id, status);
    res.redirect(303, back(id, status === 'active' ? 'Reopened.' : 'Stopped. Its pipeline won’t run until you reopen it.'));
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

/** Run the pipeline now (G2): each agent in order, then the keeper adds what's new. */
notebooksRouter.post('/notebooks/:id/run', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const out = startNotebookPipeline(getContext(req.app.locals), id);
  res.redirect(303, back(id, out.started ? 'Running the pipeline. New entries show up here as each agent finishes.' : out.reason ?? 'It could not start.'));
});

/**
 * Talk to sua about this notebook: starts its conversation (or continues it)
 * with what you said; sua files it into the notebook as you go.
 */
notebooksRouter.post('/notebooks/:id/ask', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  const text = str(req.body?.text).trim().slice(0, 4000);
  if (!nb || !ctx.inboxStore || !text) {
    if (isAjax(req)) { res.status(nb ? 400 : 404).json({ error: nb ? 'Say something first.' : 'No such notebook.' }); return; }
    res.redirect(303, nb ? back(nb.id, 'Say something first.') : '/notebooks');
    return;
  }
  let threadId = nb.conversationId && ctx.inboxStore.get(nb.conversationId) ? nb.conversationId : undefined;
  if (!threadId) {
    const created = ctx.inboxStore.add({
      priority: 'medium', source: 'manual', title: `Notebook: ${nb.title}`, body: '(empty)',
      contextJson: JSON.stringify({ page: { path: `/notebooks/${encodeURIComponent(nb.id)}`, title: nb.title, kind: 'notebook', id: nb.id } }),
    });
    threadId = created.id;
    s.setConversation(nb.id, threadId);
  } else {
    const cur = ctx.inboxStore.get(threadId);
    if (cur && (cur.status === 'resolved' || cur.status === 'dismissed')) ctx.inboxStore.updateStatus(threadId, 'open');
  }
  const said = ctx.inboxStore.addResponse(threadId, 'user', text);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: said.id, role: 'user', body: said.body, createdAt: said.createdAt });
  void runTriageAgent(ctx, threadId).catch(() => { /* logged in helper */ });
  publishInboxChanged(ctx, threadId, 'open');
  if (isAjax(req)) { res.setHeader('X-Inbox-Id', threadId); res.status(204).end(); return; }
  res.redirect(303, `/inbox/${encodeURIComponent(threadId)}`);
});

/** The notebook's sections alone, so its page can update as sua files things. */
// The data a notebook's widgets bind to (`/notebook/...`), the same shape for every notebook.
notebooksRouter.get('/notebooks/:id/data.json', (req: Request, res: Response) => {
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).json({ error: 'No such notebook.' }); return; }
  res.json(notebookViewData(nb, s.entries(nb.id, 500), s));
});

notebooksRouter.get('/notebooks/:id/main', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).end(); return; }
  const entries = s.entries(nb.id);
  const surface = SurfaceStore.fromHandle(ctx.runStore.databaseHandle()).current(`notebook:${nb.id}`);
  res.setHeader('X-Notebook-Entries', String(entries.length));
  // Changes that don't add an entry (a move, a ruling) still redraw the page.
  // Setup finishing also redraws (the note goes away).
  const settingUp = setupRunning(ctx, nb.id);
  res.setHeader('X-Notebook-Changed', `${(s.get(nb.id) ?? nb).updatedAt}${settingUp ? '+setup' : ''}`);
  // The talk box follows the notebook: its next-step hint and ghost text.
  const step = nextStep(s.get(nb.id) ?? nb, entries);
  res.setHeader('X-Notebook-Hint', encodeURIComponent(step.hint));
  res.setHeader('X-Notebook-Placeholder', encodeURIComponent(step.placeholder));
  res.type('html').send(renderNotebookMain(nb, compileSurface(surface.doc, notebookEntryItems(nb, entries)), entries, s, settingUp));
});
