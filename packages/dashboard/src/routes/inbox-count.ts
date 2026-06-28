/**
 * Lightweight count endpoint for the global inbox badge. Mounted BEFORE
 * inboxRouter so `/inbox/needs-you-count` isn't shadowed by `/inbox/:id`.
 * Returns the number of threads awaiting an operator reply so the nav badge
 * can show "the inbox needs you" on every page without threading a count
 * through every page's layout() render.
 */
import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';

export const inboxCountRouter: Router = Router();

inboxCountRouter.get('/inbox/needs-you-count', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const count = ctx.inboxStore ? ctx.inboxStore.countNeedsYou() : 0;
  res.json({ count });
});
