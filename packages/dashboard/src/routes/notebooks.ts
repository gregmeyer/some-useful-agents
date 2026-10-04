/**
 * Notebooks (goal surfaces G1): GET /notebooks, POST /notebooks (start one),
 * GET /notebooks/:id (its page), and the forms on it: add / remove an entry,
 * tick a criterion, edit, decide, stop / reopen. Every form redirects back
 * with a flash.
 */
import { Router, type Request, type Response } from 'express';
import {
  NotebookStore, SurfaceStore, compileSurface, notebookEntryItems, validateScheduleInterval,
  type NotebookEntryKind,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { parseFlash } from './inbox-shared.js';
import { renderNotebookPage, renderNotebooksList, type PipelineStage } from '../views/notebooks.js';

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
    res.redirect(303, back(nb.id, 'Notebook started. Add what you know, or set up its pipeline under Edit.'));
  } catch (err) {
    res.redirect(303, `/notebooks?new=1&flash=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
});

notebooksRouter.get('/notebooks/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(req);
  const nb = s.get(String(req.params.id));
  if (!nb) { res.status(404).redirect(303, `/notebooks?flash=${encodeURIComponent('No such notebook.')}`); return; }
  const entries = s.entries(nb.id);
  const surface = SurfaceStore.fromHandle(ctx.runStore.databaseHandle()).current(`notebook:${nb.id}`);
  const compiled = compileSurface(surface.doc, notebookEntryItems(nb, entries));
  // Each pipeline agent's last run, for the diagram.
  const stages: PipelineStage[] = nb.pipeline.map((agentId) => {
    const last = ctx.runStore.listRuns({ agentName: agentId, limit: 1 })[0];
    if (!last) return { agentId, status: 'never', note: ctx.agentStore.getAgent(agentId) ? 'not run yet' : 'not installed' };
    return { agentId, status: last.status === 'failed' ? 'failed' : 'ok', note: last.status === 'failed' ? 'failed' : last.status === 'completed' ? 'ran' : last.status };
  });
  res.type('html').send(renderNotebookPage({ nb, entries, compiled, stages, flash: parseFlash(req) }));
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
