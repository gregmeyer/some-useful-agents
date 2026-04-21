/**
 * Agent run execution route. Analyze + build routes are in run-now-build.ts.
 */

import { Router, type Request, type Response } from 'express';
import { executeAgentDag, type RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';

export const runNowRouter: Router = Router();

/**
 * POST /agents/:name/run — trigger an agent with YAML defaults.
 *
 * Dispatches to the DAG executor when the agent id is a v2 agent in
 * AgentStore; falls back to LocalProvider.submitRun for v1 YAML agents.
 *
 * Defense layers:
 *   1. requireAuth middleware (cookie + Host + Origin) already ran.
 *   2. Agent must load; 404 otherwise.
 *   3. Community shell agents (v1) OR any agent with a community-shell
 *      node (v2) require `confirm_community_shell=yes` in the form body.
 *   4. Provider / executor enforces the runtime shell-gate and all input
 *      validation.
 */
runNowRouter.post('/agents/:name/run', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const confirmed = body.confirm_community_shell === 'yes';
  // Origin marker for multi-hop back-link context. Propagated into
  // the redirect URL so the run detail's "Back to …" label reflects
  // where the user started (tutorial, runs list, etc.), not just the
  // immediate Referer.
  const fromParam = typeof body.from === 'string' && body.from.length > 0 ? body.from : undefined;
  const fromSuffix = fromParam ? `?from=${encodeURIComponent(fromParam)}` : '';

  // Prefer v2 agents (post-migration).
  const v2Agent = ctx.agentStore.getAgent(name);
  if (v2Agent) {
    const needsConfirm = v2Agent.source === 'community' && v2Agent.nodes.some((n) => n.type === 'shell');
    if (needsConfirm && !confirmed) {
      const flash = 'Community shell agents require explicit audit confirmation. Click the run button again.';
      res.redirect(303, `/agents/${encodeURIComponent(v2Agent.id)}?flash=${encodeURIComponent(flash)}`);
      return;
    }
    // Extract input_NAME fields from the form body.
    const inputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k.startsWith('input_') && typeof v === 'string' && v.trim() !== '') {
        inputs[k.slice(6)] = v.trim();
      }
    }

    // Fire-and-forget: start the DAG executor but don't await it.
    // The executor creates the run row in 'running' state synchronously
    // before spawning nodes, so the redirect to /runs/:id lands on a
    // valid page that polls for progress.
    const abortController = new AbortController();
    const runPromise = executeAgentDag(
      v2Agent,
      { triggeredBy: 'dashboard', inputs, signal: abortController.signal },
      {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        allowUntrustedShell: ctx.allowUntrustedShell,
      },
    );

    // Track the run so POST /runs/:id/cancel can abort it.
    // We don't know the runId yet (it's generated inside executeAgentDag),
    // so we register after finding it from the DB.
    runPromise.then((run) => {
      ctx.activeRuns.delete(run.id);
    }).catch(() => {});
    // Find the runId shortly after the executor creates the row.
    setTimeout(() => {
      const { rows } = ctx.runStore.queryRuns({
        agentName: v2Agent.id,
        statuses: ['running'] as RunStatus[],
        limit: 1,
        offset: 0,
      });
      if (rows.length > 0) ctx.activeRuns.set(rows[0].id, abortController);
    }, 100);

    // Give the executor a moment to create the run row, then redirect.
    // The run row is created synchronously at the top of executeAgentDag
    // before any async node work starts.
    try {
      // Wait just long enough for the run row to exist (near-instant).
      const run = await Promise.race([
        runPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
      ]);

      if (run) {
        // Fast agent: already finished.
        res.redirect(303, `/runs/${encodeURIComponent(run.id)}${fromSuffix}`);
      } else {
        // Still running: find the most recent run for this agent.
        const { rows } = ctx.runStore.queryRuns({
          agentName: v2Agent.id,
          statuses: ['running'] as RunStatus[],
          limit: 1,
          offset: 0,
        });
        if (rows.length > 0) {
          res.redirect(303, `/runs/${encodeURIComponent(rows[0].id)}${fromSuffix}`);
        } else {
          // Fallback: wait for the full run.
          const fullRun = await runPromise;
          res.redirect(303, `/runs/${encodeURIComponent(fullRun.id)}${fromSuffix}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.redirect(303, `/agents/${encodeURIComponent(v2Agent.id)}?flash=${encodeURIComponent(message)}`);
    }
    return;
  }

  // Fall back to v1.
  const { agents } = ctx.loadAgents();
  const agent = agents.get(name);
  if (!agent) {
    res.status(404).redirect(302, '/agents');
    return;
  }

  const source = agent.source ?? 'local';
  const isCommunityShell = source === 'community' && agent.type === 'shell';
  if (isCommunityShell && !confirmed) {
    const flash = 'Community shell agents require explicit audit confirmation. Click the run button again and check the box.';
    res.redirect(303, `/agents/${encodeURIComponent(agent.name)}?flash=${encodeURIComponent(flash)}`);
    return;
  }

  try {
    const run = await ctx.provider.submitRun({
      agent,
      triggeredBy: 'dashboard' as const,
      inputs: {},
    });
    res.redirect(303, `/runs/${encodeURIComponent(run.id)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(agent.name)}?flash=${encodeURIComponent(message)}`);
  }
});

