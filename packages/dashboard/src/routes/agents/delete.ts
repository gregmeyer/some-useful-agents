import { Router, type Request, type Response } from 'express';
import { getContext } from '../../context.js';

/**
 * POST /agents/:name/delete with body { confirm: <agent-id> }.
 *
 * The form requires the user to type the agent id to enable the delete
 * button, so a stray click can't fire. Runs are intentionally NOT
 * cascade-deleted — they reference agentName as a string (no FK), so
 * they survive as orphaned history. A future utility can sweep orphans
 * independently.
 */
export const agentDeleteRouter: Router = Router();

agentDeleteRouter.post('/agents/:name/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.redirect(303, `/agents?flash=${encodeURIComponent(`Agent "${name}" not found.`)}`);
    return;
  }
  // Belt-and-suspenders: even if a client bypasses the form, require
  // the confirm token to match the agent id before we delete.
  const body = req.body as Record<string, unknown> | undefined;
  const confirm = typeof body?.confirm === 'string' ? body.confirm : '';
  if (confirm !== agent.id) {
    res.redirect(
      303,
      `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent('Confirmation mismatch — delete cancelled.')}`,
    );
    return;
  }

  try {
    ctx.agentStore.deleteAgent(agent.id);
  } catch (err) {
    // Most likely: another agent invokes this one.
    res.redirect(
      303,
      `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent((err as Error).message)}`,
    );
    return;
  }

  res.redirect(303, `/agents?flash=${encodeURIComponent(`Deleted "${agent.id}".`)}`);
});
