import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import { renderPlannerMetrics } from '../views/metrics-planner.js';

/**
 * Read-only planner telemetry view at `GET /metrics/planner`.
 *
 * Surfaces the rate at which build-planner runs produce a clean,
 * commit-ready plan on the first attempt — the canonical baseline metric
 * for the planner-quality program. Headline numbers + an extract-status
 * histogram + the 50 most-recent runs. No mutations.
 *
 * Returns a "telemetry not available" page when the optional
 * `plannerTelemetryStore` isn't wired (matches the soft-optional pattern
 * the dashboard uses for packs/dashboards stores).
 */
export const metricsPlannerRouter: Router = Router();

metricsPlannerRouter.get('/metrics/planner', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  if (!ctx.plannerTelemetryStore) {
    res.type('html').send(
      `<!doctype html><meta charset="utf-8"><title>Planner metrics</title>` +
      `<p style="font-family: system-ui; padding: 2rem;">Planner telemetry store not initialised. ` +
      `Restart the dashboard to enable it.</p>`,
    );
    return;
  }

  const windowDaysParam = typeof req.query.days === 'string' ? Number(req.query.days) : 7;
  const windowDays = Number.isFinite(windowDaysParam) && windowDaysParam > 0
    ? Math.min(Math.floor(windowDaysParam), 90)
    : 7;

  const stats = ctx.plannerTelemetryStore.computeStats(windowDays);
  const recent = ctx.plannerTelemetryStore.listRecent(50);

  res.type('html').send(renderPlannerMetrics({ stats, recent }));
});
