import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { executeAgentDag, isAppleIntegrationEnabled, parseAgent, type Agent } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import { autoFixYaml } from './run-now-build.js';

/**
 * Build from goal → "Try it": run a drafted agent before keeping it, without
 * saving it. The run is an ordinary run row (`triggeredBy: 'trial'`, under
 * the draft's id), so the trace is there to inspect and, if the agent is
 * kept, it sits in its history. Trials never raise inbox failure items or
 * send notifications. See docs/build-from-goal.md.
 */
export const buildTryRouter: Router = Router();

/** A flow gets two minutes; a goal agent its own time budget plus a margin. */
const FLOW_TRIAL_MS = 120_000;
const GOAL_DEFAULT_TIMEOUT_SEC = 600;
const MAX_RESULT_CHARS = 4000;

export function trialTimeoutMs(agent: Agent): number {
  const goalSecs = agent.nodes
    .filter((n) => n.type === 'goal')
    .map((n) => n.budget?.timeoutSec ?? GOAL_DEFAULT_TIMEOUT_SEC);
  return goalSecs.length ? Math.max(...goalSecs) * 1000 + 30_000 : FLOW_TRIAL_MS;
}

/** Inputs the draft needs that have no default and weren't given. */
export function missingTrialInputs(agent: Agent, given: Record<string, string>): Array<{ name: string; description?: string; values?: string[] }> {
  return Object.entries(agent.inputs ?? {})
    .filter(([name, spec]) => given[name] === undefined && spec.default === undefined && spec.required !== false)
    .map(([name, spec]) => ({ name, description: spec.description, values: spec.values }));
}

/**
 * POST /agents/build/try { yaml, inputs? } → { ok, runId } or
 * { ok: false, needsInputs } when the draft has required inputs.
 */
buildTryRouter.post('/agents/build/try', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as { yaml?: unknown; inputs?: unknown };
  if (typeof body.yaml !== 'string' || !body.yaml.trim()) {
    res.status(400).json({ ok: false, error: 'yaml is required.' });
    return;
  }
  let agent: Agent;
  try {
    agent = { ...parseAgent(autoFixYaml(body.yaml)), source: 'local' };
  } catch (err) {
    res.json({ ok: false, error: `The draft doesn't parse: ${(err as Error).message.split('\n')[0]}` });
    return;
  }
  if (ctx.agentStore.getAgent(agent.id)) {
    res.json({ ok: false, error: `An agent called "${agent.id}" already exists. Rename the draft (its id) to try it.` });
    return;
  }
  const inputs: Record<string, string> = {};
  if (body.inputs && typeof body.inputs === 'object') {
    for (const [k, v] of Object.entries(body.inputs as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() !== '') inputs[k] = v.trim().slice(0, 2000);
    }
  }
  const needs = missingTrialInputs(agent, inputs);
  if (needs.length > 0) {
    res.json({ ok: false, needsInputs: needs });
    return;
  }

  const runId = randomUUID();
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), trialTimeoutMs(agent));
  ctx.activeRuns.set(runId, abortController);
  executeAgentDag(
    agent,
    { triggeredBy: 'trial', inputs, signal: abortController.signal, runId, suppressNotify: true },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
      integrationsStore: ctx.integrationsStore,
      toolStore: ctx.toolStore,
      agentStore: ctx.agentStore,
      allowUntrustedShell: ctx.allowUntrustedShell,
      dashboardBaseUrl: ctx.dashboardBaseUrl,
      dataRoot: ctx.agentStore.dataRoot,
      llmSettings: buildLlmSettingsSnapshot(ctx),
      spawnNode: ctx.workflowSpawnNode,
      experimentalApple: isAppleIntegrationEnabled(),
      // No onRunFailure / onRunComplete: a failed trial is an answer shown
      // in the wizard, not something to chase in the inbox.
    },
  )
    .catch(() => { /* surfaced on the run row */ })
    .finally(() => { clearTimeout(timer); ctx.activeRuns.delete(runId); });
  res.json({ ok: true, runId, timeoutSec: Math.round(trialTimeoutMs(agent) / 1000) });
});

/** GET /agents/build/try/:runId → the trial's status and, when done, its result. */
buildTryRouter.get('/agents/build/try/:runId', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const runId = String(req.params.runId);
  const run = ctx.runStore.getRun(runId);
  if (!run || run.triggeredBy !== 'trial') {
    res.status(404).json({ ok: false, error: 'No such trial run.' });
    return;
  }
  const done = run.status !== 'running' && run.status !== 'pending';
  const nodes = ctx.runStore.listNodeExecutions(runId);
  const current = nodes.find((n) => n.status === 'running');
  const result = run.result ?? '';
  res.json({
    ok: true,
    status: run.status,
    done,
    url: `/runs/${runId}`,
    ...(current ? { currentNode: current.nodeId } : {}),
    nodesDone: nodes.filter((n) => n.status === 'completed').length,
    nodesTotal: nodes.length,
    ...(done ? {
      result: result.length > MAX_RESULT_CHARS ? `${result.slice(0, MAX_RESULT_CHARS)}…` : result,
      error: run.error,
      costUsd: run.usage?.costUsd,
      durationMs: run.completedAt ? Date.parse(run.completedAt) - Date.parse(run.startedAt) : undefined,
    } : {}),
  });
});
