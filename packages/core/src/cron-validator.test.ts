import { describe, it, expect } from 'vitest';
import {
  validateScheduleInterval,
  CronInvalidError,
  CronTooFrequentError,
} from './cron-validator.js';

describe('validateScheduleInterval', () => {
  it('accepts standard 5-field expressions', () => {
    expect(() => validateScheduleInterval('* * * * *')).not.toThrow();
    expect(() => validateScheduleInterval('0 9 * * *')).not.toThrow();
    expect(() => validateScheduleInterval('*/5 * * * *')).not.toThrow();
    expect(() => validateScheduleInterval('0 0 1 * *')).not.toThrow();
  });

  it('throws CronInvalidError on garbage input', () => {
    expect(() => validateScheduleInterval('not a cron')).toThrow(CronInvalidError);
    expect(() => validateScheduleInterval('')).toThrow(CronInvalidError);
  });

  it('rejects 6-field (with-seconds) expressions by default', () => {
    expect(() => validateScheduleInterval('* * * * * *')).toThrow(CronTooFrequentError);
    expect(() => validateScheduleInterval('*/5 * * * * *')).toThrow(CronTooFrequentError);
    expect(() => validateScheduleInterval('0 0 9 * * *')).toThrow(CronTooFrequentError);
  });

  it('allows 6-field expressions when allowHighFrequency is true', () => {
    expect(() =>
      validateScheduleInterval('* * * * * *', { allowHighFrequency: true }),
    ).not.toThrow();
    expect(() =>
      validateScheduleInterval('*/5 * * * * *', { allowHighFrequency: true }),
    ).not.toThrow();
  });

  it('CronTooFrequentError carries the expression and minimum interval', () => {
    try {
      validateScheduleInterval('* * * * * *');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CronTooFrequentError);
      const e = err as CronTooFrequentError;
      expect(e.expression).toBe('* * * * * *');
      expect(e.minIntervalSeconds).toBe(60);
      expect(e.message).toContain('allowHighFrequency');
    }
  });
});
