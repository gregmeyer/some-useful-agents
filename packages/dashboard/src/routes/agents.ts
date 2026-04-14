import { Router, type Request, type Response } from 'express';
import type { RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderAgentsList } from '../views/agents-list.js';
import { renderAgentDetail } from '../views/agent-detail.js';

export const agentsRouter: Router = Router();

agentsRouter.get('/agents', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { agents } = ctx.loadAgents();
  const list = Array.from(agents.values()).sort((a, b) => a.name.localeCompare(b.name));
  res.type('html').send(renderAgentsList(list));
});

agentsRouter.get('/agents/:name', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const { agents } = ctx.loadAgents();
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = agents.get(name);
  if (!agent) {
    res.status(404).type('html').send(renderAgentsList(
      Array.from(agents.values()).sort((a, b) => a.name.localeCompare(b.name)),
    ));
    return;
  }

  // Filter runs to just this agent, last 20.
  const { rows } = ctx.runStore.queryRuns({
    agentName: agent.name,
    limit: 20,
    offset: 0,
    statuses: [] as RunStatus[],
  });

  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flash = flashParam ? { kind: 'error' as const, message: flashParam } : undefined;

  const html = await renderAgentDetail({
    agent,
    recentRuns: rows,
    secretsStore: ctx.secretsStore,
    flash,
  });
  res.type('html').send(html);
});
