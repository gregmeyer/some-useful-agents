import { Router, type Request, type Response } from 'express';

/**
 * Liveness probe for the client session guard.
 *
 * Mounted BEHIND `requireAuth`, which is the entire point: a valid session
 * returns 200 and an expired one is turned into the tagged 401 the guard
 * watches for. The handler itself does no work — the middleware is the test.
 *
 * This exists because a tab sitting on a page that issues no periodic requests
 * had no way to discover it had been signed out, and would just stop working
 * silently the next time the operator clicked something.
 */
export const sessionRouter: Router = Router();

sessionRouter.get('/session/ping', (_req: Request, res: Response) => {
  // No caching: a cached 200 would mask a session that has since lapsed.
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});
