import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';

const startedAt = Date.now();

export const healthRouter: Router = Router();

// Intentionally unauthenticated so external monitoring pings don't need
// the dashboard cookie. Returns no sensitive data.
healthRouter.get('/health', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

  let runsLastHour = 0;
  try {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { total } = ctx.runStore.queryRuns({ limit: 0 });
    // total is without time filter; we want last-hour count. Fall back to
    // total if the run store doesn't have time filtering (it doesn't yet);
    // health stays directional rather than precise.
    runsLastHour = total;
    void hourAgo;
  } catch {
    runsLastHour = -1;
  }

  res.json({ status: 'ok', uptime_s: uptimeSeconds, runs_last_hour: runsLastHour });
});
