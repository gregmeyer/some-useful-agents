/**
 * Missed-fire detection for the scheduler. On startup, checks if any
 * scheduled agent missed its last cron window and should fire immediately.
 */

import { CronExpressionParser } from 'cron-parser';

/**
 * Window for first-fire catch-up: if an agent has never fired on
 * schedule and its most recent past cron tick is within this window,
 * fire it once at daemon start. Tuned to cover daily / hourly / sub-day
 * cadences (24h covers every daily tick) without catching weekly,
 * monthly, or yearly crons whose "missed" tick from months ago would
 * be a surprise fire.
 */
const FIRST_FIRE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/**
 * Determine if a cron schedule has missed a fire since the given timestamp.
 * Returns true if a fire should have occurred between `since` and now.
 *
 * **First-fire semantics** (`since` is undefined): catch up if the most
 * recent past cron tick falls within `FIRST_FIRE_LOOKBACK_MS`. Without
 * this, freshly-registered scheduled agents would silently skip their
 * first window — e.g. installing `daily-greeting` (cron `0 8 * * *`)
 * at 10 AM and starting the daemon meant the agent didn't fire until
 * 8 AM the next day, because the catch-up code required a prior
 * `triggered_by='schedule'` run to seed it. Manual fires
 * (`triggered_by='cli'|'dashboard'`) didn't count.
 */
export function hasMissedFire(cronExpr: string, since: string | undefined): boolean {
  try {
    const now = new Date();
    const exprFromNow = CronExpressionParser.parse(cronExpr, { currentDate: now });

    if (!since) {
      // First fire with no prior schedule-triggered run. Catch up only
      // when the most recent past tick is "recent enough" — protects
      // against agents with rare cadences (weekly/monthly/yearly)
      // surprise-firing on daemon restart months after their last tick.
      const prevFire = exprFromNow.prev();
      return now.getTime() - prevFire.getTime() < FIRST_FIRE_LOOKBACK_MS;
    }

    const sinceDate = new Date(since);
    const expr = CronExpressionParser.parse(cronExpr, { currentDate: sinceDate });
    const nextFire = expr.next();

    // If the next scheduled fire after the last run is in the past, we missed it.
    return nextFire.getTime() < now.getTime();
  } catch {
    return false;
  }
}

/**
 * Compute the next fire time for a cron expression from now.
 * Returns an ISO string or null if unparseable.
 */
export function nextFireTime(cronExpr: string): string | null {
  try {
    const expr = CronExpressionParser.parse(cronExpr);
    return expr.next().toISOString();
  } catch {
    return null;
  }
}
