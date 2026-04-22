/**
 * Missed-fire detection for the scheduler. On startup, checks if any
 * scheduled agent missed its last cron window and should fire immediately.
 */

import { CronExpressionParser } from 'cron-parser';

/**
 * Determine if a cron schedule has missed a fire since the given timestamp.
 * Returns true if a fire should have occurred between `since` and now.
 */
export function hasMissedFire(cronExpr: string, since: string | undefined): boolean {
  if (!since) {
    // No previous fire — this is the first run, don't catch up.
    return false;
  }

  try {
    const sinceDate = new Date(since);
    const now = new Date();

    // Parse the cron and find the next fire after the last known fire.
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
