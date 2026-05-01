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
      { ...agent, ...targetVersion.dag },
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
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}.`)}`);
    return;
  }

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  if (agent.status === newStatus) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Already ${newStatus}.`)}`);
    return;
  }

  try {
    ctx.agentStore.updateAgentMeta(id, { status: newStatus as 'active' | 'paused' | 'archived' | 'draft' });
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Status set to "${newStatus}".`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Status change failed: ${msg}`)}`);
  }
});

/**
 * POST /agents/:id/mcp — toggle MCP exposure on/off.
 *
 * Body: { enabled: 'true' | 'false' }. The form on the Config tab posts
 * the new state explicitly (rather than a "toggle" verb) so a stale tab
 * reload doesn't accidentally flip the flag the wrong way.
 */
versionsRouter.post('/agents/:id/mcp', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = typeof body.enabled === 'string' ? body.enabled : '';
  if (raw !== 'true' && raw !== 'false') {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent('Invalid MCP toggle value.')}`);
    return;
  }
  const next = raw === 'true';

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  if (!!agent.mcp === next) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(next ? 'Already exposed via MCP.' : 'Already not exposed.')}`);
    return;
  }

  try {
    ctx.agentStore.updateAgentMeta(id, { mcp: next });
    const msg = next
      ? 'MCP exposure on. Restart `sua mcp start` (or use Settings → MCP) so the server reloads its agent list.'
      : 'MCP exposure off.';
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(msg)}`);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`MCP toggle failed: ${m}`)}`);
  }
});

const VALID_PROVIDERS = new Set(['claude', 'codex']);

/**
 * POST /agents/:id/llm — update agent-level provider and model defaults.
 * Creates a new version since these are part of the versioned DAG.
 */
versionsRouter.post('/agents/:id/llm', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';

  if (provider && !VALID_PROVIDERS.has(provider)) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent('Invalid provider. Must be claude or codex.')}`);
    return;
  }

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  // Check for no-op.
  const newProvider = (provider || undefined) as 'claude' | 'codex' | undefined;
  const newModel = model || undefined;
  if (agent.provider === newProvider && agent.model === newModel) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent('LLM defaults unchanged.')}`);
    return;
  }

  try {
    const updated = { ...agent, provider: newProvider, model: newModel };
    ctx.agentStore.upsertAgent(updated, 'dashboard', 'Updated LLM defaults');
    const parts: string[] = [];
    if (newProvider) parts.push(`provider: ${newProvider}`);
    if (newModel) parts.push(`model: ${newModel}`);
    const summary = parts.length > 0 ? parts.join(', ') : 'defaults cleared';
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`LLM defaults updated (${summary}).`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`LLM update failed: ${msg}`)}`);
  }
});
