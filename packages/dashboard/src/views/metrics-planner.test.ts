/**
 * The smoke-coverage tiles on /metrics/planner.
 *
 * `recordSmoke` has written `smoke_run_status` / `smoke_run_errors` since the
 * planner refactor, but `rowToTelemetry` never mapped them and no surface read
 * them — a write-only gauge, the same species of dead instrument #654 fixed.
 * These tiles are the reader.
 *
 * The empty-window case gets its own test because the first live render said
 * "0.0% — every build checked against the tool catalog", which is a verdict
 * about a window containing no builds. A stat that contradicts itself is worse
 * than no stat: it is what made the old planner metrics untrustworthy.
 */

import { describe, it, expect } from 'vitest';
import type { PlannerTelemetryStats } from '@some-useful-agents/core';
import { renderPlannerMetrics } from './metrics-planner.js';

function stats(over: Partial<PlannerTelemetryStats> = {}): PlannerTelemetryStats {
  return {
    windowDays: 7,
    totalAttempted: 0,
    totalCommitted: 0,
    commitRate: 0,
    firstAttemptCleanRate: 0,
    averageAttempts: 0,
    averageAutofixCount: 0,
    averageValidationErrors: 0,
    p50PlanMs: null,
    p95PlanMs: null,
    extractStatusHistogram: {},
    smokeCheckedRate: 0,
    smokeFailed: 0,
    smokeUnrecorded: 0,
    ...over,
  };
}

describe('planner metrics smoke tiles', () => {
  it('does not claim a verdict when the window holds no builds', () => {
    const html = renderPlannerMetrics({ stats: stats(), recent: [] });
    expect(html).toContain('no builds in this window');
    expect(html).not.toContain('every build checked against the tool catalog');
  });

  it('names how many builds went unchecked', () => {
    const html = renderPlannerMetrics({
      stats: stats({ totalAttempted: 10, smokeCheckedRate: 0.7, smokeUnrecorded: 3 }),
      recent: [],
    });
    expect(html).toContain('70.0%');
    expect(html).toContain('3 build(s) never checked');
  });

  it('says so plainly when every build was checked', () => {
    const html = renderPlannerMetrics({
      stats: stats({ totalAttempted: 10, smokeCheckedRate: 1, smokeUnrecorded: 0, smokeFailed: 2 }),
      recent: [],
    });
    expect(html).toContain('every build checked against the tool catalog');
    expect(html).toContain('Rejected by the check');
  });
});
