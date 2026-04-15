import { Router, type Request, type Response } from 'express';
import { renderHelp } from '../views/help.js';

/**
 * Static help / tutorial page. All content lives in `views/help.ts` —
 * this router only dispatches. No data dependencies; safe to render
 * without hitting the DB or secrets store.
 */
export const helpRouter: Router = Router();

helpRouter.get('/help', (_req: Request, res: Response) => {
  res.type('html').send(renderHelp());
});
