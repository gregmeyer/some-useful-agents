import { Router, type Request, type Response } from 'express';
import { executeAgentDag, exportAgent, parseAgent } from '@some-useful-agents/core';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getContext } from '../context.js';

export const runNowRouter: Router = Router();

/** The agent id used for "Suggest improvements". Must match agents/examples/agent-analyzer.yaml. */
const ANALYZER_AGENT_ID = 'agent-analyzer';

/**
 * POST /agents/:name/run — trigger an agent with YAML defaults.
 *
 * Dispatches to the DAG executor when the agent id is a v2 agent in
 * AgentStore; falls back to LocalProvider.submitRun for v1 YAML agents.
 *
 * Defense layers:
 *   1. requireAuth middleware (cookie + Host + Origin) already ran.
 *   2. Agent must load; 404 otherwise.
 *   3. Community shell agents (v1) OR any agent with a community-shell
 *      node (v2) require `confirm_community_shell=yes` in the form body.
 *   4. Provider / executor enforces the runtime shell-gate and all input
 *      validation.
 */
runNowRouter.post('/agents/:name/run', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const confirmed = body.confirm_community_shell === 'yes';
  // Origin marker for multi-hop back-link context. Propagated into
  // the redirect URL so the run detail's "Back to …" label reflects
  // where the user started (tutorial, runs list, etc.), not just the
  // immediate Referer.
  const fromParam = typeof body.from === 'string' && body.from.length > 0 ? body.from : undefined;
  const fromSuffix = fromParam ? `?from=${encodeURIComponent(fromParam)}` : '';

  // Prefer v2 agents (post-migration).
  const v2Agent = ctx.agentStore.getAgent(name);
  if (v2Agent) {
    const needsConfirm = v2Agent.source === 'community' && v2Agent.nodes.some((n) => n.type === 'shell');
    if (needsConfirm && !confirmed) {
      const flash = 'Community shell agents require explicit audit confirmation. Click the run button again.';
      res.redirect(303, `/agents/${encodeURIComponent(v2Agent.id)}?flash=${encodeURIComponent(flash)}`);
      return;
    }
    try {
      const run = await executeAgentDag(
        v2Agent,
        { triggeredBy: 'dashboard', inputs: {} },
        {
          runStore: ctx.runStore,
          secretsStore: ctx.secretsStore,
          allowUntrustedShell: ctx.allowUntrustedShell,
        },
      );
      res.redirect(303, `/runs/${encodeURIComponent(run.id)}${fromSuffix}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.redirect(303, `/agents/${encodeURIComponent(v2Agent.id)}?flash=${encodeURIComponent(message)}`);
    }
    return;
  }

  // Fall back to v1.
  const { agents } = ctx.loadAgents();
  const agent = agents.get(name);
  if (!agent) {
    res.status(404).redirect(302, '/agents');
    return;
  }

  const source = agent.source ?? 'local';
  const isCommunityShell = source === 'community' && agent.type === 'shell';
  if (isCommunityShell && !confirmed) {
    const flash = 'Community shell agents require explicit audit confirmation. Click the run button again and check the box.';
    res.redirect(303, `/agents/${encodeURIComponent(agent.name)}?flash=${encodeURIComponent(flash)}`);
    return;
  }

  try {
    const run = await ctx.provider.submitRun({
      agent,
      triggeredBy: 'dashboard' as const,
      inputs: {},
    });
    res.redirect(303, `/runs/${encodeURIComponent(run.id)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(agent.name)}?flash=${encodeURIComponent(message)}`);
  }
});

/**
 * POST /agents/:name/analyze — run the agent-analyzer example agent with
 * the target agent's YAML as input. Redirects to the run detail page.
 * The run detail page detects analyzer runs and renders a diff/apply widget.
 */
runNowRouter.post('/agents/:name/analyze', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;

  // Load the target agent.
  const target = ctx.agentStore.getAgent(name);
  if (!target) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  // Load the analyzer agent. Auto-import from examples YAML if not in the store.
  let analyzer = ctx.agentStore.getAgent(ANALYZER_AGENT_ID);
  if (!analyzer) {
    try {
      const yamlPath = join(resolve('agents/examples'), `${ANALYZER_AGENT_ID}.yaml`);
      const yamlText = readFileSync(yamlPath, 'utf-8');
      const parsed = parseAgent(yamlText);
      ctx.agentStore.createAgent(parsed, 'import', 'Auto-imported for suggest improvements');
      analyzer = ctx.agentStore.getAgent(ANALYZER_AGENT_ID);
    } catch {
      // Fall through to the error below.
    }
    if (!analyzer) {
      res.redirect(303, `/agents/${encodeURIComponent(name)}?flash=${encodeURIComponent(
        `Analyzer agent "${ANALYZER_AGENT_ID}" not found. Ensure agent-analyzer.yaml exists in agents/examples/.`,
      )}`);
      return;
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
  const targetYaml = exportAgent(target);

  try {
    const run = await executeAgentDag(
      analyzer,
      {
        triggeredBy: 'dashboard',
        inputs: {
          AGENT_YAML: targetYaml,
          ...(focus ? { FOCUS: `Focus your analysis on: ${focus}` } : {}),
        },
      },
      {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        variablesStore: ctx.variablesStore,
      },
    );
    // Pass the target agent id so the run detail page can render the apply widget.
    res.redirect(303, `/runs/${encodeURIComponent(run.id)}?analyzerTarget=${encodeURIComponent(name)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(name)}?flash=${encodeURIComponent(`Analysis failed: ${message}`)}`);
  }
});
