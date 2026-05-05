import { Router, type Request, type Response } from 'express';
import { extractPriorAgentInputs, type RunStatus } from '@some-useful-agents/core';
import { getContext } from '../../context.js';
import { renderAgentNodes, renderAgentConfig, renderAgentRuns } from '../../views/agent-detail-v2.js';
import { deriveBack } from '../../views/page-header.js';

export const agentTabsRouter: Router = Router();

/** Shared helper: build the common args for all agent detail tabs. */
async function buildTabArgs(req: Request, ctx: ReturnType<typeof getContext>, name: string) {
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) return null;
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const fromParam = typeof req.query.from === 'string' ? req.query.from : undefined;
  const flash = flashParam ? { kind: 'ok' as const, message: flashParam } : undefined;
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
  const back = deriveBack(referer, `127.0.0.1:${ctx.port}`, fromParam);
  const { rows } = ctx.runStore.queryRuns({
    agentName: agent.id, limit: 50, offset: 0, statuses: [] as RunStatus[],
  });

  // Extract previous run's agent-level inputs for the Run Now modal.
  let previousInputs: Record<string, string> | undefined;
  if (rows.length > 0) {
    const recovered = extractPriorAgentInputs(agent, rows[0].id, ctx.runStore);
    if (Object.keys(recovered).length > 0) previousInputs = recovered;
  }

  return { agent, recentRuns: rows, secretsStore: ctx.secretsStore, flash, back, from: fromParam, previousInputs };
}

agentTabsRouter.get('/agents/:name/nodes', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const args = await buildTabArgs(req, ctx, name);
  if (!args) { res.status(404).redirect(303, '/agents'); return; }
  res.type('html').send(await renderAgentNodes({ ...args, activeTab: 'nodes' }));
});

agentTabsRouter.get('/agents/:name/config', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const args = await buildTabArgs(req, ctx, name);
  if (!args) { res.status(404).redirect(303, '/agents'); return; }
  res.type('html').send(await renderAgentConfig({ ...args, activeTab: 'config' }));
});

agentTabsRouter.get('/agents/:name/runs', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const args = await buildTabArgs(req, ctx, name);
  if (!args) { res.status(404).redirect(303, '/agents'); return; }
  res.type('html').send(renderAgentRuns({ ...args, activeTab: 'runs' }));
});
