import { describe, it, expect } from 'vitest';
import { hasMissedFire, nextFireTime } from './scheduler-catchup.js';

describe('hasMissedFire', () => {
  it('returns true on first-fire when the most recent past tick is within 24h (daily cron)', () => {
    // Most recent "0 8 * * *" tick was at most 24h ago by definition.
    // Without this, freshly-registered scheduled agents skip their first
    // window and silently never fire until the daemon happens to be
    // running through a tick — the bug that motivated this branch.
    expect(hasMissedFire('0 8 * * *', undefined)).toBe(true);
  });

  it('returns true on first-fire for hourly crons (well within 24h lookback)', () => {
    expect(hasMissedFire('0 * * * *', undefined)).toBe(true);
  });

  it('returns false on first-fire for rare crons whose last tick was > 24h ago', () => {
    // Pick a yearly cron that fired on a date deliberately far from "now".
    // "0 0 1 1 *" = Jan 1 at midnight. Skip the assertion on Jan 1 / 2 to
    // avoid a date-dependent flake; rare crons elsewhere in the year
    // demonstrate the lookback ceiling.
    const today = new Date();
    if (today.getMonth() === 0 && today.getDate() <= 2) return;
    expect(hasMissedFire('0 0 1 1 *', undefined)).toBe(false);
  });

  it('returns true when a daily schedule missed its window', () => {
    // Last fire was 3 days ago at 8am. The next fire should have been
    // the following day at 8am, which is in the past.
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    threeDaysAgo.setHours(8, 0, 0, 0);
    expect(hasMissedFire('0 8 * * *', threeDaysAgo.toISOString())).toBe(true);
  });

  it('returns false when the last fire is recent enough', () => {
    // Last fire was 5 minutes ago. Next daily fire is tomorrow.
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(hasMissedFire('0 8 * * *', fiveMinAgo)).toBe(false);
  });

  it('returns false for invalid cron expressions', () => {
    expect(hasMissedFire('not-a-cron', new Date().toISOString())).toBe(false);
  });

  it('returns false for invalid cron expressions on first-fire', () => {
    expect(hasMissedFire('not-a-cron', undefined)).toBe(false);
  });
});

describe('nextFireTime', () => {
  it('returns an ISO string for a valid expression', () => {
    const next = nextFireTime('0 8 * * *');
    expect(next).toBeTruthy();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns null for an invalid expression', () => {
    expect(nextFireTime('not-valid')).toBeNull();
  });
});
