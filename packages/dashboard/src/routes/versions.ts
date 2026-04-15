import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import { renderVersionsList, renderVersionDetail } from '../views/versions.js';

/**
 * Version history + rollback routes for v2 DAG agents.
 *
 * - `GET  /agents/:id/versions`           — list all versions of an agent
 * - `GET  /agents/:id/versions/:version`  — view a single version's DAG
 * - `POST /agents/:id/rollback`           — create a new version whose DAG matches a target version's
 * - `POST /agents/:id/status`             — change agent status (active/paused/archived/draft)
 *
 * All routes are under `requireAuth`; POST routes rely on the Origin +
 * Host checks in auth-middleware.ts as the CSRF defence (Origin is the
 * same posture as run-now.ts).
 *
 * Rollback always creates a *new* version (via `createNewVersion`),
 * never mutates pointer-only. Keeps `agent_versions` append-only so a
 * rollback is itself a historical event you can audit or reverse.
 */

const VALID_STATUSES = new Set(['active', 'paused', 'archived', 'draft']);

export const versionsRouter: Router = Router();

versionsRouter.get('/agents/:id/versions', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const versions = ctx.agentStore.listVersions(id);
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flash = flashParam ? { kind: 'ok' as const, message: flashParam } : undefined;
  res.type('html').send(renderVersionsList({ agent, versions, flash }));
});

versionsRouter.get('/agents/:id/versions/:version', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const versionRaw = Array.isArray(req.params.version) ? req.params.version[0] : req.params.version;
  const versionNum = Number.parseInt(versionRaw, 10);
  if (!Number.isFinite(versionNum) || versionNum < 1) {
    res.status(404).redirect(303, `/agents/${encodeURIComponent(id)}/versions`);
    return;
  }
  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const version = ctx.agentStore.getVersion(id, versionNum);
  if (!version) {
    res.status(404).redirect(303, `/agents/${encodeURIComponent(id)}/versions`);
    return;
  }
  res.type('html').send(renderVersionDetail({ agent, version }));
});

versionsRouter.post('/agents/:id/rollback', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetRaw = body.targetVersion;
  const target = typeof targetRaw === 'string' ? Number.parseInt(targetRaw, 10) : Number.NaN;

  if (!Number.isFinite(target) || target < 1) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/versions?flash=${encodeURIComponent('Invalid target version.')}`);
    return;
  }

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  if (target === agent.version) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/versions?flash=${encodeURIComponent(`Already on v${target}. Nothing to roll back.`)}`);
    return;
  }

  const targetVersion = ctx.agentStore.getVersion(id, target);
  if (!targetVersion) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/versions?flash=${encodeURIComponent(`Version v${target} not found.`)}`);
    return;
  }

  try {
    // Reconstruct an Agent shape from the target version's DAG + the
    // current agent's metadata (status, schedule, etc. aren't part of
    // the DAG, so they carry over unchanged on rollback).
    ctx.agentStore.createNewVersion(
      id,
      {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        status: agent.status,
        schedule: agent.schedule,
        source: agent.source,
        mcp: agent.mcp,
        nodes: targetVersion.dag.nodes,
        inputs: targetVersion.dag.inputs,
        author: targetVersion.dag.author,
        tags: targetVersion.dag.tags,
      },
      'dashboard',
      `Rollback to v${target}`,
    );
    res.redirect(303, `/agents/${encodeURIComponent(id)}/versions?flash=${encodeURIComponent(`Rolled back to v${target} (created a new version).`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}/versions?flash=${encodeURIComponent(`Rollback failed: ${msg}`)}`);
  }
});

versionsRouter.post('/agents/:id/status', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const newStatus = typeof body.newStatus === 'string' ? body.newStatus : undefined;

  if (!newStatus || !VALID_STATUSES.has(newStatus)) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}.`)}`);
    return;
  }

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  if (agent.status === newStatus) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Already ${newStatus}.`)}`);
    return;
  }

  try {
    ctx.agentStore.updateAgentMeta(id, { status: newStatus as 'active' | 'paused' | 'archived' | 'draft' });
    res.redirect(303, `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Status set to "${newStatus}".`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}?flash=${encodeURIComponent(`Status change failed: ${msg}`)}`);
  }
});
