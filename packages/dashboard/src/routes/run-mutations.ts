import { Router, type Request, type Response } from 'express';
import { executeAgentDag, topologicalSort, type RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';

export const runMutationsRouter: Router = Router();

/**
 * GET /runs/:id/replay-check?fromNodeId=X — pre-flight check for replay.
 * Returns JSON with whether upstream outputs are available and what
 * agent inputs exist (so the UI can show input fields if needed).
 */
runMutationsRouter.get('/runs/:id/replay-check', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const fromNodeId = typeof req.query.fromNodeId === 'string' ? req.query.fromNodeId : '';

  const priorRun = ctx.runStore.getRun(id);
  if (!priorRun?.workflowId) {
    res.json({ ok: false, error: 'Run not found or not a DAG run.' });
    return;
  }

  const agent = ctx.agentStore.getAgent(priorRun.workflowId);
  if (!agent) {
    res.json({ ok: false, error: `Agent "${priorRun.workflowId}" not found.` });
    return;
  }

  const order = topologicalSort(agent.nodes);
  const pivotIndex = order.findIndex((n) => n.id === fromNodeId);
  if (pivotIndex < 0) {
    res.json({ ok: false, error: `Node "${fromNodeId}" not found in agent.` });
    return;
  }

  // Check which upstream nodes have stored outputs in the prior run.
  const priorExecs = ctx.runStore.listNodeExecutions(id);
  const priorByNode = new Map(priorExecs.map((e) => [e.nodeId, e]));
  const upstreamIds = order.slice(0, pivotIndex).map((n) => n.id);

  const missing: string[] = [];
  const available: string[] = [];
  for (const nodeId of upstreamIds) {
    const exec = priorByNode.get(nodeId);
    if (exec?.status === 'completed' && exec.result !== undefined) {
      available.push(nodeId);
    } else {
      missing.push(nodeId);
    }
  }

  // Agent inputs for the input form.
  const inputs = Object.entries(agent.inputs ?? {}).map(([name, spec]) => ({
    name,
    type: spec.type,
    default: spec.default !== undefined ? String(spec.default) : undefined,
    required: spec.required !== false && spec.default === undefined,
    description: spec.description,
  }));

  res.json({
    ok: true,
    canReplay: missing.length === 0,
    missing,
    available,
    inputs,
    fromNodeId,
  });
});

/**
 * POST /runs/:id/replay — re-execute an agent starting from a specific
 * node, reusing stored upstream outputs from the prior run.
 *
 * Mirrors `sua workflow replay <runId> --from <nodeId>`. The executor
 * validates that every node upstream of `fromNodeId` completed in the
 * prior run — a failed upstream or a missing snapshot causes a helpful
 * error, flashed back on the prior run's page.
 *
 * Defense layers (on top of requireAuth cookie + Host + Origin):
 *   1. Prior run must exist + be a v2 DAG run (workflow_id set).
 *   2. Agent the prior run references must still be in AgentStore.
 *   3. Community shell agents require `confirm_community_shell=yes`.
 */
runMutationsRouter.post('/runs/:id/replay', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fromNodeId = typeof body.fromNodeId === 'string' ? body.fromNodeId.trim() : '';
  const confirmed = body.confirm_community_shell === 'yes';

  if (fromNodeId.length === 0) {
    res.redirect(303, `/runs/${encodeURIComponent(id)}?flash=${encodeURIComponent('Pick a node to replay from.')}`);
    return;
  }

  const priorRun = ctx.runStore.getRun(id);
  if (!priorRun) {
    res.status(404).redirect(303, '/runs');
    return;
  }
  if (!priorRun.workflowId) {
    res.redirect(303, `/runs/${encodeURIComponent(id)}?flash=${encodeURIComponent('Replay only works on v2 DAG runs.')}`);
    return;
  }

  const agent = ctx.agentStore.getAgent(priorRun.workflowId);
  if (!agent) {
    res.redirect(303, `/runs/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Agent "${priorRun.workflowId}" not found in store.`)}`);
    return;
  }

  // Cheap guard: reject pivot ids that don't exist in the current agent
  // version before calling the executor. The executor does this too, but
  // catching here gives a faster flash without touching the run store.
  if (!agent.nodes.some((n) => n.id === fromNodeId)) {
    res.redirect(303, `/runs/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Node "${fromNodeId}" not in agent "${agent.id}".`)}`);
    return;
  }

  const needsConfirm = agent.source === 'community' && agent.nodes.some((n) => n.type === 'shell');
  if (needsConfirm && !confirmed) {
    res.redirect(303, `/runs/${encodeURIComponent(id)}?flash=${encodeURIComponent('Community shell replays need explicit confirmation.')}`);
    return;
  }

  // Fire-and-forget: start replay but redirect immediately.
  const replayPromise = executeAgentDag(
    agent,
    {
      triggeredBy: 'dashboard',
      inputs: {},
      replayFrom: { priorRunId: id, fromNodeId },
    },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      allowUntrustedShell: ctx.allowUntrustedShell,
    },
  );

  try {
    // Wait briefly for the run row to be created.
    const result = await Promise.race([
      replayPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);

    if (result) {
      // Fast replay — already done.
      res.redirect(303, `/runs/${encodeURIComponent(result.id)}?flash=${encodeURIComponent(`Replayed from "${fromNodeId}".`)}`);
    } else {
      // Still running — find the new run.
      const { rows } = ctx.runStore.queryRuns({
        agentName: agent.id,
        statuses: ['running'] as RunStatus[],
        limit: 1,
        offset: 0,
      });
      if (rows.length > 0) {
        res.redirect(303, `/runs/${encodeURIComponent(rows[0].id)}?flash=${encodeURIComponent(`Replaying from "${fromNodeId}"...`)}`);
      } else {
        const fullResult = await replayPromise;
        res.redirect(303, `/runs/${encodeURIComponent(fullResult.id)}?flash=${encodeURIComponent(`Replayed from "${fromNodeId}".`)}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/runs/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Replay failed: ${message}`)}`);
  }
});
