/**
 * Routes for the Inbox surface:
 *   GET /inbox        — priority-grouped list of active items
 *   GET /inbox/:id    — message detail + conversation thread
 *
 * Mutation routes (dismiss, respond, triage) ship in follow-up PRs;
 * MVP is read-only so the surface can be validated before producers
 * are wired.
 */

import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import { renderInboxList } from '../views/inbox-list.js';
import { renderInboxDetail } from '../views/inbox-detail.js';
import { renderNotFoundPage } from '../views/not-found.js';

export const inboxRouter: Router = Router();

inboxRouter.get('/inbox', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const rows = ctx.inboxStore ? ctx.inboxStore.list() : [];
  res.type('html').send(renderInboxList({ rows }));
});

inboxRouter.get('/inbox/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!ctx.inboxStore) {
    res.status(404).type('html').send(renderNotFoundPage({
      path: req.originalUrl,
      message: 'Inbox is not available — the store failed to initialize.',
    }));
    return;
  }
  const message = ctx.inboxStore.get(id);
  if (!message) {
    res.status(404).type('html').send(renderNotFoundPage({
      path: req.originalUrl,
      message: `No inbox message with id "${id}".`,
    }));
    return;
  }
  const responses = ctx.inboxStore.listResponses(id);
  res.type('html').send(renderInboxDetail({ message, responses }));
});
