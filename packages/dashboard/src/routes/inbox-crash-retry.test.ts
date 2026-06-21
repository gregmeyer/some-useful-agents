/**
 * Triage crash recovery: a transient infra failure (provider hiccup, worker
 * dispatch race, network) shouldn't permanently strand a thread. The crash
 * handler auto-retries a bounded number of times before posting a terminal
 * note. `planTriageCrashRecovery` is the pure decision behind that — tested
 * here without forcing a real crash.
 */
import { describe, it, expect } from 'vitest';
import { planTriageCrashRecovery } from './inbox-plan.js';

describe('planTriageCrashRecovery', () => {
  it('retries on the first crash (budget available)', () => {
    const plan = planTriageCrashRecovery(0, 'ECONNRESET');
    expect(plan.willRetry).toBe(true);
    expect(plan.noteBody).toContain('transient');
    expect(plan.noteBody).toContain('Retrying');
    expect(plan.noteBody).toContain('ECONNRESET');
  });

  it('posts a terminal note once the budget is spent', () => {
    const plan = planTriageCrashRecovery(1, 'worker gone');
    expect(plan.willRetry).toBe(false);
    expect(plan.noteBody).toContain('crashed after 2 attempts');
    expect(plan.noteBody).toContain('worker gone');
    expect(plan.noteBody).toMatch(/reply|ask triage/i);
  });
});
