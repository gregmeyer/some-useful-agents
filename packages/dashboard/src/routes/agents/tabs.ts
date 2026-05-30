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
  // Surface available integrations so the Notify card's per-handler
  // dropdowns can offer them. Missing store → empty list → editor falls
  // back to the inline form unchanged.
  const availableIntegrations = ctx.integrationsStore
    ? ctx.integrationsStore.listIntegrations().map((i) => ({ id: i.id, kind: i.kind as string, name: i.name }))
    : [];
  // Recently blocked img-src hosts for this agent — surface as one-click
  // "Allow" pills above the imgSrc textarea. Empty when no blocks
  // recorded (or store unwired in older daemons).
  const blockedImgHosts = ctx.blockedImgHostsStore
    ? ctx.blockedImgHostsStore.listForAgent(args.agent.id, 12)
    : [];
  // All installed agents for the allowed-sub-agents picklist modal.
  // Excludes the current agent (you can't allow yourself as a sub-
  // agent). Pulled here so the view stays store-agnostic.
  const installedAgents = ctx.agentStore.listAgents()
    .filter((a) => a.id !== args.agent.id)
    .map((a) => ({ id: a.id, name: a.name, description: a.description }));
  res.type('html').send(await renderAgentConfig({ ...args, activeTab: 'config', availableIntegrations, blockedImgHosts, installedAgents }));
});

agentTabsRouter.get('/agents/:name/runs', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const args = await buildTabArgs(req, ctx, name);
  if (!args) { res.status(404).redirect(303, '/agents'); return; }
  res.type('html').send(renderAgentRuns({ ...args, activeTab: 'runs' }));
});
