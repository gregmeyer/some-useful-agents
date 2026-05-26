/**
 * /scheduled — agents-with-cron management surface.
 *
 *   GET  /scheduled              — list every agent with a schedule
 *   POST /scheduled/:id/pause    — sets status=paused, redirects back
 *   POST /scheduled/:id/resume   — sets status=active, redirects back
 *
 * The pause/resume verbs are dedicated routes (vs reusing
 * POST /agents/:id/status) so the redirect lands back on /scheduled
 * instead of /agents/:id/config. Same underlying mutation, different
 * navigation home. Clearing the schedule cron permanently still lives
 * on /agents/:id/config — it's a less-reversible action and shouldn't
 * be one-click from a list view.
 */

import { Router, type Request, type Response } from 'express';
import type { Agent, RunStatus } from '@some-useful-agents/core';
import { getSchedulerStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderScheduledPage, type ScheduledRowInput } from '../views/scheduled.js';

export const scheduledRouter: Router = Router();

scheduledRouter.get('/scheduled', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  // Every agent with a schedule, regardless of status. The home widget
  // filtered to active-only; this surface deliberately shows paused too,
  // because a paused-with-schedule agent is exactly what someone clicking
  // "Scheduled" wants to find. Hidden dashboardVisible:false agents are
  // included — they're still reachable by direct URL, MCP, and the
  // scheduler, so hiding them here would be misleading.
  const all = ctx.agentStore.listAgents();
  const scheduled: Agent[] = all.filter((a) => !!a.schedule);

  // Scheduler status + per-agent next-fire come from the heartbeat file
  // written by the scheduler daemon. Same source as the home widget.
  const { status: schedulerStatus, heartbeat } = getSchedulerStatus(ctx.dataDir);

  // Last scheduler-triggered fire per agent. queryRuns(triggeredBy:'schedule')
  // returns rows in startedAt DESC order, so [0] is the most recent.
  const rows: ScheduledRowInput[] = scheduled.map((agent) => {
    const lastResult = ctx.runStore.queryRuns({
      agentName: agent.id,
      triggeredBy: 'schedule',
      limit: 1,
      offset: 0,
      statuses: [] as RunStatus[],
    });
    const lastFireAt = lastResult.rows[0]?.startedAt;
    const nextFireAt = heartbeat?.nextFires?.[agent.id];
    return { agent, lastFireAt, nextFireAt };
  });

  const flash = typeof req.query.flash === 'string' ? req.query.flash : undefined;

  res.type('html').send(renderScheduledPage({
    rows,
    schedulerStatus,
    flash,
  }));
});

/**
 * Verb metadata for each row-action route. `noun` is the user-facing label
 * (gerund + past tense both derive from the route name); `past` is the
 * "Did X" form used in the success flash. Centralised so the flash copy
 * stays consistent across pause / resume / activate.
 */
interface VerbCopy {
  /** Imperative + present-progressive form, used in error flashes ("Pause failed"). */
  imperative: 'Pause' | 'Resume' | 'Activate';
  /** Past tense form, used in success flashes ("Paused \"X\""). */
  past: 'Paused' | 'Resumed' | 'Activated';
}

/**
 * Flip an agent's status to `nextStatus` and redirect to /scheduled with a
 * flash. Used by /pause, /resume, and /activate. Guards: missing agent,
 * missing schedule, already-in-target-state all return 303 + flash, not 5xx.
 */
function flipStatus(
  req: Request,
  res: Response,
  nextStatus: 'paused' | 'active',
  verb: VerbCopy,
): void {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.redirect(303, `/scheduled?flash=${encodeURIComponent(`Agent "${id}" not found.`)}`);
    return;
  }
  if (!agent.schedule) {
    res.redirect(303, `/scheduled?flash=${encodeURIComponent(`Agent "${id}" has no schedule to ${verb.imperative.toLowerCase()}.`)}`);
    return;
  }
  if (agent.status === nextStatus) {
    res.redirect(303, `/scheduled?flash=${encodeURIComponent(`Agent "${id}" is already ${nextStatus}.`)}`);
    return;
  }

  try {
    ctx.agentStore.updateAgentMeta(id, { status: nextStatus });
    res.redirect(303, `/scheduled?flash=${encodeURIComponent(`${verb.past} "${id}".`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/scheduled?flash=${encodeURIComponent(`${verb.imperative} failed: ${msg}`)}`);
  }
}

scheduledRouter.post('/scheduled/:id/pause', (req, res) =>
  flipStatus(req, res, 'paused', { imperative: 'Pause', past: 'Paused' }));
scheduledRouter.post('/scheduled/:id/resume', (req, res) =>
  flipStatus(req, res, 'active', { imperative: 'Resume', past: 'Resumed' }));
// /activate is /resume's twin for status='draft' agents — same end state
// (active), different copy. The scheduler ignores drafts, so a scheduled
// draft is "scheduled-in-intent but never fires" until the user activates.
scheduledRouter.post('/scheduled/:id/activate', (req, res) =>
  flipStatus(req, res, 'active', { imperative: 'Activate', past: 'Activated' }));
