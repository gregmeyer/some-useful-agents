import cron from 'node-cron';

/**
 * Default minimum interval between cron fires, in seconds.
 *
 * 60s matches the granularity of standard 5-field cron expressions, so any
 * 5-field expression passes by construction. Anything finer requires the
 * 6-field (with-seconds) syntax that we reject by default.
 */
export const DEFAULT_MIN_INTERVAL_SECONDS = 60;

export class CronInvalidError extends Error {
  constructor(expression: string) {
    super(`Invalid cron expression: "${expression}"`);
    this.name = 'CronInvalidError';
  }
}

export class CronTooFrequentError extends Error {
  constructor(
    public readonly expression: string,
    public readonly minIntervalSeconds: number,
  ) {
    super(
      `Cron expression "${expression}" fires more often than the minimum ` +
        `interval of ${minIntervalSeconds}s. Six-field (with-seconds) cron ` +
        `expressions are rejected by default to prevent runaway LLM cost or ` +
        `local resource exhaustion. Set "allowHighFrequency: true" on the ` +
        `agent if you genuinely need sub-minute scheduling.`,
    );
    this.name = 'CronTooFrequentError';
  }
}

export interface ValidateScheduleOptions {
  /** Minimum interval between fires, in seconds. Default: 60. */
  minIntervalSeconds?: number;
  /** When true, bypass the frequency cap and allow 6-field expressions. */
  allowHighFrequency?: boolean;
}

/**
 * Validate that `expression` is a syntactically valid cron string AND fires
 * no more often than the configured minimum interval.
 *
 * Today this is implemented as: 6-field expressions are rejected by default,
 * 5-field expressions always pass (their minimum granularity is 60 seconds).
 * If `minIntervalSeconds` rises above 60 in the future, this should grow to
 * compute the next-N-fires interval using a real cron parser.
 *
 * Throws on failure; returns void on success.
 */
export function validateScheduleInterval(
  expression: string,
  options: ValidateScheduleOptions = {},
): void {
  if (!cron.validate(expression)) {
    throw new CronInvalidError(expression);
  }

  if (options.allowHighFrequency) {
    return;
  }

  const minInterval = options.minIntervalSeconds ?? DEFAULT_MIN_INTERVAL_SECONDS;
  const fieldCount = expression.trim().split(/\s+/).length;

  // 6-field cron = with-seconds = sub-minute granularity.
  if (fieldCount === 6) {
    throw new CronTooFrequentError(expression, minInterval);
  }

  // 5-field cron has a minimum interval of 60s by construction.
  // Nothing to check.
}
