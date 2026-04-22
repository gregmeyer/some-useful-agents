import { describe, it, expect } from 'vitest';
import { cronToHuman } from './cron-human.js';

describe('cronToHuman', () => {
  it('handles every minute', () => {
    expect(cronToHuman('* * * * *')).toBe('Every minute');
  });

  it('handles step minutes', () => {
    expect(cronToHuman('*/15 * * * *')).toBe('Every 15 minutes');
    expect(cronToHuman('*/1 * * * *')).toBe('Every 1 minute');
  });

  it('handles daily at a specific time', () => {
    expect(cronToHuman('0 8 * * *')).toBe('Every day at 8:00 AM');
    expect(cronToHuman('30 14 * * *')).toBe('Every day at 2:30 PM');
    expect(cronToHuman('0 0 * * *')).toBe('Every day at 12:00 AM');
  });

  it('handles weekday schedules', () => {
    expect(cronToHuman('0 9 * * 1-5')).toBe('Weekdays at 9:00 AM');
    expect(cronToHuman('0 10 * * 0,6')).toBe('Weekends at 10:00 AM');
  });

  it('handles specific day of week', () => {
    expect(cronToHuman('30 9 * * 1')).toBe('Monday at 9:30 AM');
  });

  it('handles monthly', () => {
    expect(cronToHuman('0 0 1 * *')).toBe('1st of every month at 12:00 AM');
    expect(cronToHuman('0 9 15 * *')).toBe('15th of every month at 9:00 AM');
  });

  it('handles hourly at specific minute', () => {
    expect(cronToHuman('30 * * * *')).toBe('Every hour at minute 30');
  });

  it('handles step hours', () => {
    expect(cronToHuman('0 */2 * * *')).toBe('Every 2 hours');
  });

  it('returns raw expression for unrecognized patterns', () => {
    expect(cronToHuman('abc')).toBe('abc');
  });

  it('handles specific month + day', () => {
    expect(cronToHuman('0 9 25 12 *')).toBe('December 25 at 9:00 AM');
  });
});
