import { Router, type Request, type Response } from 'express';
import { executeAgentDag } from '@some-useful-agents/core';
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

  // Prefer v2 agents (post-migration).
  const v2Agent = ctx.agentStore.getAgent(name);
  if (v2Agent) {
    const needsConfirm = v2Agent.source === 'community' && v2Agent.nodes.some((n) => n.type === 'shell');
    if (needsConfirm && !confirmed) {
      const flash = 'Community shell agents require explicit audit confirmation. Click the run button again.';
      res.redirect(303, `/agents/${encodeURIComponent(v2Agent.id)}?flash=${encodeURIComponent(flash)}`);
      return;
    }
    try {
      const run = await executeAgentDag(
        v2Agent,
        { triggeredBy: 'dashboard', inputs: {} },
        {
          runStore: ctx.runStore,
          secretsStore: ctx.secretsStore,
          allowUntrustedShell: ctx.allowUntrustedShell,
        },
      );
      res.redirect(303, `/runs/${encodeURIComponent(run.id)}`);
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
