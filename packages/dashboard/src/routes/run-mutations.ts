import { Router, type Request, type Response } from 'express';
import { executeAgentDag } from '@some-useful-agents/core';
import { getContext } from '../context.js';

export const runMutationsRouter: Router = Router();

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

  try {
    const replay = await executeAgentDag(
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
    res.redirect(303, `/runs/${encodeURIComponent(replay.id)}?flash=${encodeURIComponent(`Replayed from "${fromNodeId}".`)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/runs/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Replay failed: ${message}`)}`);
  }
});
