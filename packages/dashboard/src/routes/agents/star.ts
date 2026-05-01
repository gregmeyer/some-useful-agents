import { Router, type Request, type Response } from 'express';
import { getContext } from '../../context.js';

export const agentStarRouter: Router = Router();

agentStarRouter.post('/agents/:name/star', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.redirect(303, '/agents');
    return;
  }
  ctx.agentStore.updateAgentMeta(agent.id, { starred: !agent.starred });
  // Redirect back to wherever the user came from.
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
  res.redirect(303, referer ?? `/agents/${encodeURIComponent(agent.id)}`);
});
