import { Router, type Request, type Response } from 'express';
import { getContext } from '../../context.js';
import { localBack } from '../../lib/local-back.js';

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
  // Back to where you starred it from: the form says (the dashboard sends no Referer).
  res.redirect(303, localBack(req.body?.back) ?? `/agents/${encodeURIComponent(agent.id)}`);
});
