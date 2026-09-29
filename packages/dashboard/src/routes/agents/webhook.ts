import { Router, type Request, type Response } from 'express';
import { WebhookStore } from '@some-useful-agents/core';
import { getContext } from '../../context.js';

/** Turn an agent's inbound webhook on / off, or rotate its secret (Config tab). */
export const agentWebhookRouter: Router = Router();

agentWebhookRouter.post('/agents/:name/webhook', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = String(Array.isArray(req.params.name) ? req.params.name[0] : req.params.name);
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) { res.redirect(303, '/agents'); return; }
  const store = WebhookStore.fromHandle(ctx.runStore.databaseHandle());
  const op = typeof req.body?.op === 'string' ? req.body.op : '';
  let flash: string;
  if (op === 'enable') { store.enable(agent.id); flash = 'Webhook on. Copy the URL and secret below.'; }
  else if (op === 'disable') { store.disable(agent.id); flash = 'Webhook off. Deliveries now get 404; the secret is kept if you turn it back on.'; }
  else if (op === 'rotate') { flash = store.rotate(agent.id) ? 'New secret. The old one stopped working.' : 'Turn the webhook on first.'; }
  else { flash = 'Unknown action.'; }
  res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent(flash)}`);
});
