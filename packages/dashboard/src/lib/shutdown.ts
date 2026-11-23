/**
 * What the dashboard does with work in flight when it stops.
 *
 * Before, close() shut the stores under whatever was running: background work
 * failed against a closed database, and runs were left marked running for the
 * next boot's reaper to finalize as abandoned. Now close() first lets in-flight
 * work finish for a grace period, then stops the runs that are still going
 * (the executor kills their child process and records them cancelled), and
 * waits briefly for that. A run that still hasn't ended is recorded as
 * cancelled here, with the reason, before the stores close.
 */
import type { DashboardContext } from '../context.js';
import { markRunCancelled } from './run-cancelled.js';

export const SHUTDOWN_GRACE_MS = 10_000;
/** After stopping what's left: time for the runs to record that they were cancelled. */
export const SHUTDOWN_STOP_MS = 5_000;

type Ctx = Pick<DashboardContext, 'activeRuns' | 'inboxTriageAbortControllers' | 'background'> & Partial<Pick<DashboardContext, 'runStore'>>;

/** Why a run the shutdown stopped ended. */
export const STOPPED_BY_SHUTDOWN = 'Stopped because the dashboard shut down.';

export interface ShutdownOutcome {
  /** Runs and triage turns that were still going after the grace period, and were stopped. */
  stopped: string[];
  /** Work still running when the stores close (it may log a failure as they do). Runs aren't in it: one still going is recorded as cancelled. */
  unfinished: string[];
}

const busy = (ctx: Ctx): boolean =>
  ctx.activeRuns.size > 0 || ctx.inboxTriageAbortControllers.size > 0 || (ctx.background?.size ?? 0) > 0;

async function waitIdle(ctx: Ctx, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (busy(ctx) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
}

/** Let in-flight work finish (up to `graceMs`), stop what's left, and wait up to `stopMs` for it to settle. */
export async function settleInFlight(ctx: Ctx, graceMs = SHUTDOWN_GRACE_MS, stopMs = SHUTDOWN_STOP_MS): Promise<ShutdownOutcome> {
  await waitIdle(ctx, graceMs);
  const stopped: string[] = [];
  for (const [runId, ac] of ctx.activeRuns) { stopped.push(`run ${runId}`); ac.abort(STOPPED_BY_SHUTDOWN); }
  for (const [messageId, t] of ctx.inboxTriageAbortControllers) { stopped.push(`triage ${messageId}`); t.controller.abort(); }
  if (stopped.length) await waitIdle(ctx, stopMs);
  // A run that still hasn't recorded its end (a shell node's own child can hold its
  // output open past the kill) is recorded as cancelled here, not left for the reaper.
  for (const runId of [...ctx.activeRuns.keys()]) {
    if (ctx.runStore) markRunCancelled(ctx.runStore, runId, STOPPED_BY_SHUTDOWN);
    ctx.activeRuns.delete(runId);
  }
  const unfinished = [
    ...[...ctx.inboxTriageAbortControllers.keys()].map((id) => `triage ${id}`),
    ...(ctx.background?.pending() ?? []),
  ];
  return { stopped, unfinished };
}
