import { Router, type Request, type Response } from 'express';
import type { RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderHelp } from '../views/help.js';
import { renderTutorial, type TutorialState } from '../views/tutorial.js';

/**
 * Help & tutorial routes.
 * - `GET /help`: static CLI reference (no DB access).
 * - `GET /help/tutorial`: dashboard-native guided flow. Step completion is
 *   derived from observable project state, not session cookies. Each step
 *   has an inline action button; no terminal handoff for the happy path.
 * - `POST /help/tutorial/scaffold-hello`: one-click creation of a minimal
 *   single-node `hello` agent via the in-process AgentStore API. Same
 *   outcome as `sua agent new` with default answers, minus the terminal
 *   prompts.
 * - `POST /help/tutorial/scaffold-demo-dag`: creates a two-node fetch → summary
 *   DAG for step 4 ("see multi-node in action"). Id is `demo-digest`.
 */
export const helpRouter: Router = Router();

helpRouter.get('/help', (_req: Request, res: Response) => {
  res.type('html').send(renderHelp());
});

helpRouter.get('/help/tutorial', (req: Request, res: Response) => {
  res.type('html').send(renderTutorial(collectTutorialState(req)));
});

helpRouter.post('/help/tutorial/scaffold-hello', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  if (ctx.agentStore.getAgent('hello')) {
    res.redirect(303, `/help/tutorial?flash=${encodeURIComponent('Agent "hello" already exists.')}`);
    return;
  }

  try {
    ctx.agentStore.createAgent(
      {
        id: 'hello',
        name: 'Hello',
        description: 'A minimal starter agent created from the dashboard tutorial.',
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [{
          id: 'greet',
          type: 'shell',
          command: "echo 'Hello from some-useful-agents!'",
        }],
      },
      'dashboard',
      'Scaffolded from /help/tutorial',
    );
    // Redirect to the agent detail so the user sees the DAG, the node,
    // the command — not just a flash that says "done." The contextual
    // back link picks up "/help/tutorial" from the Referer and shows a
    // "Back to tutorial" affordance.
    res.redirect(303, `/agents/hello?from=tutorial&flash=${encodeURIComponent('Created from the tutorial. Click Run now to execute it.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/help/tutorial?flash=${encodeURIComponent(`Scaffold failed: ${msg}`)}`);
  }
});

helpRouter.post('/help/tutorial/scaffold-demo-dag', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  if (ctx.agentStore.getAgent('demo-digest')) {
    res.redirect(303, `/help/tutorial?flash=${encodeURIComponent('Agent "demo-digest" already exists.')}`);
    return;
  }

  try {
    ctx.agentStore.createAgent(
      {
        id: 'demo-digest',
        name: 'Demo Digest',
        description: 'Two-node DAG: fetch stub output, then count items. Scaffolded from the tutorial.',
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [
          {
            id: 'fetch',
            type: 'shell',
            command: "echo 'item-1 item-2 item-3'",
          },
          {
            id: 'digest',
            type: 'shell',
            command: 'echo "Summary of:" && echo "$UPSTREAM_FETCH_RESULT" | wc -w | awk \'{print "  " $1 " items"}\'',
            dependsOn: ['fetch'],
          },
        ],
      },
      'dashboard',
      'Scaffolded demo DAG from /help/tutorial',
    );
    res.redirect(303, `/agents/demo-digest?from=tutorial&flash=${encodeURIComponent('Two-node DAG created. Click Run now to see multi-node execution.')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/help/tutorial?flash=${encodeURIComponent(`Scaffold failed: ${msg}`)}`);
  }
});

function collectTutorialState(req: Request): TutorialState & { flash?: string } {
  const ctx = getContext(req.app.locals);

  const v2Agents = ctx.agentStore.listAgents();
  const { agents: v1Agents } = ctx.loadAgents();
  const v2Ids = new Set(v2Agents.map((a) => a.id));
  const v1OnlyCount = Array.from(v1Agents.keys()).filter((id) => !v2Ids.has(id)).length;
  const agentCount = v2Agents.length + v1OnlyCount;

  const recent = ctx.runStore.queryRuns({
    limit: 20,
    offset: 0,
    statuses: [] as RunStatus[],
  });
  const latestRun = recent.rows[0];
  const hasAnyRun = recent.total > 0;
  const hasDagRun = recent.rows.some((r) => !!r.workflowId);

  const v2UsesSecrets = v2Agents.some((a) => a.nodes.some((n) => (n.secrets?.length ?? 0) > 0));
  const v1UsesSecrets = Array.from(v1Agents.values()).some((a) => (a.secrets?.length ?? 0) > 0);
  const usesSecrets = v2UsesSecrets || v1UsesSecrets;

  const hasHelloAgent = !!ctx.agentStore.getAgent('hello');
  const hasDemoDag = !!ctx.agentStore.getAgent('demo-digest');

  // Pick the friendliest starting agent: prefer single-node v2, then any v2, then v1.
  const firstAgentId = v2Agents.find((a) => a.nodes.length === 1)?.id
    ?? v2Agents[0]?.id
    ?? Array.from(v1Agents.keys())[0];

  const flash = typeof req.query.flash === 'string' ? req.query.flash : undefined;

  return {
    agentCount,
    hasAnyRun,
    hasDagRun,
    usesSecrets,
    firstAgentId,
    latestRunId: latestRun?.id,
    hasHelloAgent,
    hasDemoDag,
    flash,
  };
}
