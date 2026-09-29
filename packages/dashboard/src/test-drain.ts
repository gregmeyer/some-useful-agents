/**
 * Test helper: stop and wait out work a test's routes started without
 * awaiting (Run now, chat turns, webhook runs, answer-and-resume, inbox
 * triage and dispatched actions). Without it, that work outlives the test,
 * writes to stores the next test's teardown closed, and the resulting
 * "database is not open" rejection fails whichever test is running then.
 */
import type { DashboardContext } from './context.js';

export async function drainInFlight(
  ctx: Pick<DashboardContext, 'activeRuns' | 'inboxTriageAbortControllers'> | undefined,
  timeoutMs = 3000,
): Promise<void> {
  if (!ctx) return;
  for (const c of ctx.activeRuns.values()) c.abort();
  for (const t of ctx.inboxTriageAbortControllers.values()) t.controller.abort();
  const start = Date.now();
  while ((ctx.activeRuns.size > 0 || ctx.inboxTriageAbortControllers.size > 0) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
  }
}
