import { Router, type Request, type Response } from 'express';
import { executeAgentDag, exportAgent, parseAgent, type RunStatus } from '@some-useful-agents/core';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getContext } from '../context.js';

export const runNowRouter: Router = Router();

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
    // Extract input_NAME fields from the form body.
    const inputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k.startsWith('input_') && typeof v === 'string' && v.trim() !== '') {
        inputs[k.slice(6)] = v.trim();
      }
    }

    // Fire-and-forget: start the DAG executor but don't await it.
    // The executor creates the run row in 'running' state synchronously
    // before spawning nodes, so the redirect to /runs/:id lands on a
    // valid page that polls for progress.
    const runPromise = executeAgentDag(
      v2Agent,
      { triggeredBy: 'dashboard', inputs },
      {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        allowUntrustedShell: ctx.allowUntrustedShell,
      },
    );

    // Give the executor a moment to create the run row, then redirect.
    // The run row is created synchronously at the top of executeAgentDag
    // before any async node work starts.
    try {
      // Wait just long enough for the run row to exist (near-instant).
      const run = await Promise.race([
        runPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
      ]);

      if (run) {
        // Fast agent: already finished.
        res.redirect(303, `/runs/${encodeURIComponent(run.id)}${fromSuffix}`);
      } else {
        // Still running: find the most recent run for this agent.
        const { rows } = ctx.runStore.queryRuns({
          agentName: v2Agent.id,
          statuses: ['running'] as RunStatus[],
          limit: 1,
          offset: 0,
        });
        if (rows.length > 0) {
          res.redirect(303, `/runs/${encodeURIComponent(rows[0].id)}${fromSuffix}`);
        } else {
          // Fallback: wait for the full run.
          const fullRun = await runPromise;
          res.redirect(303, `/runs/${encodeURIComponent(fullRun.id)}${fromSuffix}`);
        }
      }
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
 * POST /agents/:name/analyze — run the agent-analyzer with the target
 * agent's YAML as input. Returns JSON so the client can render results
 * in a modal without navigating away.
 */
runNowRouter.post('/agents/:name/analyze', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;

  const target = ctx.agentStore.getAgent(name);
  if (!target) {
    res.json({ ok: false, error: 'Agent not found.' });
    return;
  }

  // Auto-import the analyzer agent from examples if not in the store.
  let analyzer = ctx.agentStore.getAgent(ANALYZER_AGENT_ID);
  if (!analyzer) {
    try {
      const yamlPath = join(resolve('agents/examples'), `${ANALYZER_AGENT_ID}.yaml`);
      const yamlText = readFileSync(yamlPath, 'utf-8');
      const parsed = parseAgent(yamlText);
      ctx.agentStore.createAgent(parsed, 'import', 'Auto-imported for suggest improvements');
      analyzer = ctx.agentStore.getAgent(ANALYZER_AGENT_ID);
    } catch { /* fall through */ }
    if (!analyzer) {
      res.json({ ok: false, error: 'Analyzer agent not found. Ensure agent-analyzer.yaml exists in agents/examples/.' });
      return;
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const focus = typeof body.focus === 'string' ? body.focus.trim() : '';
  const targetYaml = exportAgent(target);

  // Fire-and-forget: start the analyzer but don't await it.
  // Return the runId immediately so the client can poll.
  const runPromise = executeAgentDag(
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

  // Wait briefly for the run row to be created (near-instant).
  await Promise.race([
    runPromise,
    new Promise((resolve) => setTimeout(resolve, 200)),
  ]);

  // Find the running analyzer run.
  const { rows } = ctx.runStore.queryRuns({
    agentName: ANALYZER_AGENT_ID,
    statuses: ['running', 'completed', 'failed'] as RunStatus[],
    limit: 1,
    offset: 0,
  });

  if (rows.length > 0) {
    res.json({ ok: true, status: 'started', runId: rows[0].id, currentYaml: targetYaml });
  } else {
    // Fallback: wait for the full run.
    try {
      const run = await runPromise;
      res.json({ ok: true, status: 'started', runId: run.id, currentYaml: targetYaml });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
  }
});

/**
 * GET /agents/:name/analyze/:runId — poll the analyzer run status.
 * Returns progress events while running, parsed results when done.
 */
runNowRouter.get('/agents/:name/analyze/:runId', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;

  const run = ctx.runStore.getRun(runId);
  if (!run) {
    res.json({ ok: false, status: 'not_found' });
    return;
  }

  // Still running — return progress from node executions.
  if (run.status === 'running' || run.status === 'pending') {
    const execs = ctx.runStore.listNodeExecutions(runId);
    const runningNode = execs.find((e) => e.status === 'running');
    const completedNodes = execs.filter((e) => e.status === 'completed').map((e) => e.nodeId);
    let progress: unknown[] = [];
    if (runningNode?.progressJson) {
      try { progress = JSON.parse(runningNode.progressJson); } catch { /* ignore */ }
    }
    // Add a phase message based on which node is running.
    const phaseMessage = runningNode?.nodeId === 'analyze' ? 'Analyzing agent...'
      : runningNode?.nodeId === 'validate' ? 'Validating suggested YAML...'
      : runningNode?.nodeId === 'fix' ? 'Fixing validation errors...'
      : runningNode ? `Running ${runningNode.nodeId}...`
      : 'Starting...';
    res.json({ ok: true, status: 'running', progress, phase: phaseMessage, completedNodes });
    return;
  }

  // Done — parse the result.
  if (run.status !== 'completed' || !run.result) {
    res.json({ ok: true, status: 'failed', error: run.error ?? `Analysis failed (${run.status}).` });
    return;
  }

  // The run.result is the last completed node's output. In the multi-node
  // analyzer pipeline:
  //   - If fix ran (validation failed): fix node's output has the corrected XML
  //   - If fix was skipped (validation passed): validate node's JSON is the
  //     run result, but we want the analyze node's output with the XML tags
  // Detect by checking for <classification> tag.
  let resultText = run.result;
  if (!resultText.includes('<classification>')) {
    // Result is probably the validate node's JSON. Find the analyze node's output.
    const execs = ctx.runStore.listNodeExecutions(runId);
    const analyzeExec = execs.find((e) => e.nodeId === 'analyze');
    if (analyzeExec?.result) {
      resultText = analyzeExec.result;
    }
  }

  const extract = (tag: string): string | undefined => {
    const m = resultText.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return m ? m[1].trim() : undefined;
  };
  const classRaw = extract('classification')?.toUpperCase().trim() ?? 'SUGGESTIONS';
  const classification = ['NO_IMPROVEMENTS', 'SUGGESTIONS', 'REWRITE'].includes(classRaw) ? classRaw : 'SUGGESTIONS';

  const suggestedYaml = extract('yaml') || undefined;
  let yamlError: string | undefined;
  if (suggestedYaml && suggestedYaml.length > 10) {
    try { parseAgent(suggestedYaml); } catch (e) { yamlError = e instanceof Error ? e.message : String(e); }
  }

  const target = ctx.agentStore.getAgent(name);
  const currentYaml = target ? exportAgent(target) : '';

  res.json({
    ok: true,
    status: 'done',
    classification,
    summary: extract('summary') ?? '',
    details: extract('details') ?? run.result,
    yaml: suggestedYaml,
    yamlError,
    currentYaml,
  });
});
