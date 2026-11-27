/**
 * POST /inbox/:id/actions/:rid/add-picture — add a picture a finished run made
 * (lib/run-pictures.ts) to an answer, as a note holding the image, and say so
 * in the conversation.
 */
import { Router, type Request, type Response } from 'express';
import { NotebookStore } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { extractField } from '../views/output-widgets.js';
import { readRunPicture, runPictures } from '../lib/run-pictures.js';
import { parseActionMeta, publishInboxEvent } from './inbox-shared.js';

export const inboxPicturesRouter: Router = Router();

inboxPicturesRouter.post('/inbox/:id/actions/:rid/add-picture', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const rid = String(req.params.rid);
  const back = `/inbox/${encodeURIComponent(id)}`;
  const fail = (why: string) => { res.redirect(303, `${back}?error=${encodeURIComponent(why)}`); };
  const response = ctx.inboxStore?.getResponse(rid);
  const meta = response ? parseActionMeta(response) : null;
  if (!ctx.inboxStore?.get(id) || !response || response.messageId !== id || !meta || meta.status !== 'completed' || !meta.runId) { fail('That run isn’t in this conversation.'); return; }
  const field = typeof req.body?.field === 'string' ? req.body.field : '';
  const pic = runPictures(ctx, meta.agentId, meta.runId).find((p) => p.field === field);
  if (!pic) { fail('That run has no picture to add.'); return; }
  const image = readRunPicture(pic);
  if ('error' in image) { fail(image.error); return; }
  const s = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = s.get(typeof req.body?.notebook === 'string' ? req.body.notebook : '');
  if (!nb) { fail('Choose an answer to add it to.'); return; }
  const agent = ctx.agentStore.getAgent(meta.agentId);
  const run = ctx.runStore.getRun(meta.runId);
  const title = (run?.result ? extractField(run.result, 'title')?.trim() : '') || `A picture from ${agent?.name ?? meta.agentId}`;
  try {
    s.addPicture(nb.id, { title, body: `Made by ${agent?.name ?? meta.agentId}, from [a conversation](${back}).`, by: `agent:${meta.agentId}`, runId: meta.runId, ...image });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }
  const note = `Added **${title.replace(/[*_[\]]/g, '')}** to [${nb.title.replace(/[[\]]/g, '')}](/notebooks/${encodeURIComponent(nb.id)}).`;
  const sys = ctx.inboxStore.addResponse(id, 'system', note);
  publishInboxEvent(ctx, id, 'message:created', { responseId: sys.id, role: 'system', body: note, createdAt: sys.createdAt });
  res.redirect(303, `${back}?ok=${encodeURIComponent(`Added it to ${nb.title}.`)}`);
});
