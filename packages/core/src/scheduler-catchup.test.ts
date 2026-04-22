import { describe, it, expect } from 'vitest';
import { hasMissedFire, nextFireTime } from './scheduler-catchup.js';

describe('hasMissedFire', () => {
  it('returns false when no previous fire exists', () => {
    expect(hasMissedFire('0 8 * * *', undefined)).toBe(false);
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
