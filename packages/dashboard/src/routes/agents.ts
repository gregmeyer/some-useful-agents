import { Router, type Request, type Response } from 'express';
import type { Agent, AgentDefinition, RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderAgentsList } from '../views/agents-list.js';
import { renderAgentDetail } from '../views/agent-detail.js';
import { renderAgentDetailV2 } from '../views/agent-detail-v2.js';

export const agentsRouter: Router = Router();

agentsRouter.get('/agents', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const v1Agents = ctx.loadAgents().agents;
  const v2Agents = ctx.agentStore.listAgents();

  // Unify for the list view. v2 agents take precedence when ids collide
  // (expected post-migration: the user imported their YAML into the DB).
  const mergedV1: AgentDefinition[] = [];
  const v2Ids = new Set(v2Agents.map((a) => a.id));
  for (const [id, a] of v1Agents) {
    if (!v2Ids.has(id)) mergedV1.push(a);
  }
  mergedV1.sort((a, b) => a.name.localeCompare(b.name));
  v2Agents.sort((a, b) => a.id.localeCompare(b.id));
  res.type('html').send(renderAgentsList({ v1: mergedV1, v2: v2Agents }));
});

agentsRouter.get('/agents/:name', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;

  // Prefer v2: if this id is in the AgentStore, render the DAG view.
  const v2Agent = ctx.agentStore.getAgent(name);
  if (v2Agent) {
    const { rows } = ctx.runStore.queryRuns({
      agentName: v2Agent.id,
      limit: 20,
      offset: 0,
      statuses: [] as RunStatus[],
    });
    const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
    const flash = flashParam ? { kind: 'error' as const, message: flashParam } : undefined;
    const html = await renderAgentDetailV2({
      agent: v2Agent,
      recentRuns: rows,
      secretsStore: ctx.secretsStore,
      flash,
    });
    res.type('html').send(html);
    return;
  }

  // Fall back to v1 YAML-loaded agents.
  const { agents } = ctx.loadAgents();
  const agent = agents.get(name);
  if (!agent) {
    res.status(404).type('html').send(renderAgentsList({
      v1: Array.from(agents.values()).sort((a, b) => a.name.localeCompare(b.name)),
      v2: ctx.agentStore.listAgents().sort((a, b) => a.id.localeCompare(b.id)),
    }));
    return;
  }

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

// Export for tests
export type { Agent, AgentDefinition };
