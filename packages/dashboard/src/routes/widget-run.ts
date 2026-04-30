import { Router, type Request, type Response } from 'express';
import { executeAgentDag, type RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';

export const widgetRunRouter: Router = Router();

/**
 * POST /agents/:name/widget-run — start a run for an interactive widget.
 *
 * Mirrors the run-now route but returns JSON `{ runId }` instead of a 303
 * redirect, so the calling tile can transition to its own polling state
 * without navigating away. The dashboard auth middleware gates this just
 * like every other mutating route.
 */
widgetRunRouter.post('/agents/:name/widget-run', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const v2Agent = ctx.agentStore.getAgent(name);
  if (!v2Agent) {
    res.status(404).json({ error: `Agent "${name}" not found.` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const inputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith('input_') && typeof v === 'string' && v.trim() !== '') {
      inputs[k.slice(6)] = v.trim();
    }
  }

  const abortController = new AbortController();
  const runPromise = executeAgentDag(
    v2Agent,
    { triggeredBy: 'dashboard', inputs, signal: abortController.signal },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
      toolStore: ctx.toolStore,
      allowUntrustedShell: ctx.allowUntrustedShell,
      dashboardBaseUrl: ctx.dashboardBaseUrl,
    },
  );

  // Look up the runId once the executor has created the row. Same idiom as
  // run-now.ts — the executor creates the row synchronously near the top of
  // executeAgentDag, so a brief setTimeout is enough to find it.
  setTimeout(() => {
    const { rows } = ctx.runStore.queryRuns({
      agentName: v2Agent.id,
      limit: 1,
      offset: 0,
      statuses: [] as RunStatus[],
    });
    const latest = rows[0];
    if (latest && (latest.status === 'pending' || latest.status === 'running')) {
      ctx.activeRuns.set(latest.id, abortController);
    }
  }, 50);

  // Cleanup activeRuns on completion regardless of outcome.
  runPromise
    .then((run) => { ctx.activeRuns.delete(run.id); })
    .catch(() => { /* swallowed — error surfaces via runStore on next poll */ });

  // Echo back the runId so the client can start polling. We can't await
  // runPromise here without losing the in-place UX, so we look it up.
  setTimeout(() => {
    const { rows } = ctx.runStore.queryRuns({
      agentName: v2Agent.id,
      limit: 1,
      offset: 0,
      statuses: [] as RunStatus[],
    });
    const latest = rows[0];
    if (!latest) {
      res.status(500).json({ error: 'Run did not start.' });
      return;
    }
    res.status(202).json({ runId: latest.id });
  }, 75);
});

/**
 * GET /runs/:id/widget-status — lightweight status JSON for tile polling.
 *
 * Returns just the fields the tile needs: status + result + error. No
 * per-node executions, no DAG, no auth payload. Polled every ~500 ms by
 * interactive widgets.
 */
widgetRunRouter.get('/runs/:id/widget-status', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const run = ctx.runStore.getRun(id);
  if (!run) {
    res.status(404).json({ error: 'Run not found.' });
    return;
  }
  res.json({
    runId: run.id,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    result: run.result,
    error: run.error,
  });
});
