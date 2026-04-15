import { Router, type Request, type Response } from 'express';
import type { RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderHelp } from '../views/help.js';
import { renderTutorial, type TutorialState } from '../views/tutorial.js';

/**
 * Help & tutorial routes.
 * - `/help`: static CLI reference (no DB access).
 * - `/help/tutorial`: dashboard-native guided flow. Step completion is
 *   derived from observable project state, not session cookies.
 */
export const helpRouter: Router = Router();

helpRouter.get('/help', (_req: Request, res: Response) => {
  res.type('html').send(renderHelp());
});

helpRouter.get('/help/tutorial', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  const v2Agents = ctx.agentStore.listAgents();
  const { agents: v1Agents } = ctx.loadAgents();
  const v2Ids = new Set(v2Agents.map((a) => a.id));
  const v1OnlyCount = Array.from(v1Agents.keys()).filter((id) => !v2Ids.has(id)).length;
  const agentCount = v2Agents.length + v1OnlyCount;

  // Latest run + DAG-run detection in one query.
  const recent = ctx.runStore.queryRuns({
    limit: 1,
    offset: 0,
    statuses: [] as RunStatus[],
  });
  const latestRun = recent.rows[0];
  const hasAnyRun = recent.total > 0;
  const hasDagRun = recent.rows.some((r) => !!r.workflowId) ||
    (hasAnyRun && ctx.runStore.queryRuns({ limit: 20, offset: 0, statuses: [] as RunStatus[] }).rows.some((r) => !!r.workflowId));

  // Does any agent (v2 or v1) declare a secret?
  const v2UsesSecrets = v2Agents.some((a) => a.nodes.some((n) => (n.secrets?.length ?? 0) > 0));
  const v1UsesSecrets = Array.from(v1Agents.values()).some((a) => (a.secrets?.length ?? 0) > 0);
  const usesSecrets = v2UsesSecrets || v1UsesSecrets;

  // Pick the friendliest starting agent: the first v2 with a single node,
  // else the first v2, else the first v1 name.
  const firstAgentId = v2Agents.find((a) => a.nodes.length === 1)?.id
    ?? v2Agents[0]?.id
    ?? Array.from(v1Agents.keys())[0];

  const state: TutorialState = {
    agentCount,
    hasAnyRun,
    hasDagRun,
    usesSecrets,
    firstAgentId,
    latestRunId: latestRun?.id,
  };

  res.type('html').send(renderTutorial(state));
});
