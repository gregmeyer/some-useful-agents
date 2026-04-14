import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';

export const runNowRouter: Router = Router();

/**
 * POST /agents/:name/run — trigger an agent with YAML defaults.
 *
 * Defense layers:
 *   1. requireAuth middleware (cookie + Host + Origin) already ran.
 *   2. Agent must load; 404 otherwise.
 *   3. Community shell agents require `confirm_community_shell=yes` in the
 *      form body. Without it: flash back to the agent page with a 400.
 *   4. Provider.submitRun enforces the runtime shell-gate and all input
 *      validation (missing required, bad type, undeclared keys).
 */
runNowRouter.post('/agents/:name/run', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { agents } = ctx.loadAgents();
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = agents.get(name);
  if (!agent) {
    res.status(404).redirect(302, '/agents');
    return;
  }

  const source = agent.source ?? 'local';
  const isCommunityShell = source === 'community' && agent.type === 'shell';

  if (isCommunityShell) {
    // Form bodies are parsed by express.urlencoded() middleware on the app.
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.confirm_community_shell !== 'yes') {
      const flash = 'Community shell agents require explicit audit confirmation. Click the run button again and check the box.';
      res.redirect(303, `/agents/${encodeURIComponent(agent.name)}?flash=${encodeURIComponent(flash)}`);
      return;
    }
  }

  try {
    // Dashboard-triggered runs use YAML defaults for inputs; no per-input
    // form in MVP (see plan: "Running with custom inputs from the UI — out of scope").
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
