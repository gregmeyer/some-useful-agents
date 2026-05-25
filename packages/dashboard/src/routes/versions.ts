import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import { renderVersionsList, renderVersionDetail } from '../views/versions.js';
import { validateScheduleInterval, CronInvalidError, CronTooFrequentError } from '@some-useful-agents/core';

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

/**
 * POST /agents/:id/visibility — toggle pulseVisible or dashboardVisible.
 *
 * Body: { field: 'pulse' | 'dashboard', enabled: 'true' | 'false' }.
 * Like the MCP toggle, the form posts the explicit next state (not a verb)
 * so a stale tab reload doesn't flip the wrong way.
 */
versionsRouter.post('/agents/:id/visibility', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const field = typeof body.field === 'string' ? body.field : '';
  const raw = typeof body.enabled === 'string' ? body.enabled : '';
  if ((field !== 'pulse' && field !== 'dashboard') || (raw !== 'true' && raw !== 'false')) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent('Invalid visibility toggle.')}`);
    return;
  }
  const next = raw === 'true';

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  try {
    const patch = field === 'pulse' ? { pulseVisible: next } : { dashboardVisible: next };
    ctx.agentStore.updateAgentMeta(id, patch);
    const surface = field === 'pulse' ? 'Pulse' : 'Dashboard';
    const msg = next ? `${surface} visibility on.` : `${surface} visibility off.`;
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(msg)}`);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Visibility toggle failed: ${m}`)}`);
  }
});

/**
 * POST /agents/:id/schedule — set or clear the agent's cron schedule.
 *
 * Body: { schedule: string } — empty string clears the schedule.
 * Validation: parses + applies the frequency cap via core's
 * validateScheduleInterval, honouring the agent's allowHighFrequency flag.
 * Schedule lives on the agents row metadata (no version bump) — the
 * scheduler reads it from there at start time and re-reads on each
 * heartbeat tick.
 */
versionsRouter.post('/agents/:id/schedule', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = typeof body.schedule === 'string' ? body.schedule.trim() : '';

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  // Empty input clears the schedule.
  if (raw === '') {
    if (!agent.schedule) {
      res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent('Schedule unchanged.')}`);
      return;
    }
    try {
      ctx.agentStore.updateAgentMeta(id, { schedule: undefined });
      res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent('Schedule cleared.')}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Schedule clear failed: ${m}`)}`);
    }
    return;
  }

  try {
    validateScheduleInterval(raw, { allowHighFrequency: agent.allowHighFrequency });
  } catch (err) {
    let msg: string;
    if (err instanceof CronInvalidError) {
      msg = `"${raw}" is not a valid cron expression. Use 5 fields (minute hour day month weekday), e.g. "0 8 * * *".`;
    } else if (err instanceof CronTooFrequentError) {
      msg = `"${raw}" fires sub-minute. Set allowHighFrequency: true on the agent YAML to bypass the safety cap.`;
    } else {
      msg = err instanceof Error ? err.message : String(err);
    }
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(msg)}`);
    return;
  }

  if (agent.schedule === raw) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent('Schedule unchanged.')}`);
    return;
  }

  try {
    ctx.agentStore.updateAgentMeta(id, { schedule: raw });
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Schedule set to "${raw}". Restart the scheduler daemon to pick it up.`)}`);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Schedule update failed: ${m}`)}`);
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

// CSP host syntax — must match the regex in agent-v2-schema.ts
// (`permissions.imgSrc` items). Lowercase host name with optional
// leading "*." for wildcard subdomains. Schemes/ports are stripped on
// input and re-added by the dashboard middleware.
const IMG_SRC_HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/**
 * POST /agents/:id/permissions — update CSP allowlists declared by the
 * agent. Accepts `imgSrc` as a newline-separated host list (textarea-
 * friendly), normalises (lowercase, strip scheme + trailing path),
 * dedupes, and validates each entry. Creates a new agent version since
 * permissions live in the versioned DAG.
 */
versionsRouter.post('/agents/:id/permissions', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = typeof body.imgSrc === 'string' ? body.imgSrc : '';

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  // Normalise: split on whitespace/commas, trim, lowercase, strip
  // common prefixes/paths so users can paste full URLs without
  // tripping the regex.
  const seen = new Set<string>();
  const hosts: string[] = [];
  const invalid: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    if (!piece) continue;
    let h = piece.trim().toLowerCase();
    h = h.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (!h || seen.has(h)) continue;
    seen.add(h);
    if (!IMG_SRC_HOST_RE.test(h)) { invalid.push(h); continue; }
    hosts.push(h);
  }
  if (invalid.length > 0) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(
      `Invalid host${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}. Use lowercase host names like images.unsplash.com or *.unsplash.com.`,
    )}`);
    return;
  }

  const existing = (agent.permissions?.imgSrc ?? []).slice().sort();
  const next = hosts.slice().sort();
  if (existing.length === next.length && existing.every((h, i) => h === next[i])) {
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent('Permissions unchanged.')}`);
    return;
  }

  try {
    const newPermissions = hosts.length > 0 ? { ...agent.permissions, imgSrc: hosts } : (() => {
      // Drop imgSrc; if no other permissions remain, drop the whole field.
      const rest = { ...agent.permissions };
      delete rest.imgSrc;
      return Object.keys(rest).length > 0 ? rest : undefined;
    })();
    const updated = { ...agent, permissions: newPermissions };
    ctx.agentStore.upsertAgent(updated, 'dashboard', `Updated img-src permissions (${hosts.length} host${hosts.length === 1 ? '' : 's'})`);
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(
      hosts.length === 0 ? 'img-src permissions cleared.' : `img-src updated (${hosts.length} host${hosts.length === 1 ? '' : 's'}).`,
    )}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(id)}/config?flash=${encodeURIComponent(`Permissions update failed: ${msg}`)}`);
  }
});

/**
 * POST /agents/:id/permissions/allow-host — MERGE a single img-src host
 * into the agent's allowlist (creating a new version), as opposed to the
 * replace-everything /permissions form. Powers the one-click "Allow this
 * host" affordance when a widget image is blocked by the page CSP.
 *
 * Body: { host: string } (a bare host or full URL — normalised here).
 * Returns JSON { ok, host, imgSrc } so the caller can reload.
 */
versionsRouter.post('/agents/:id/permissions/allow-host', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = typeof body.host === 'string' ? body.host : '';

  // Two callers: the client banner's `fetch` (wants JSON) and the
  // server-rendered Allow form on a failed run (a plain POST that needs a
  // redirect back). When the form supplies a same-origin `redirect` path we
  // answer with a 303; otherwise we keep the JSON contract. Only `/`-relative
  // paths are honoured (no open redirect).
  const redirectTo = typeof body.redirect === 'string' && body.redirect.startsWith('/') ? body.redirect : null;
  const fail = (status: number, error: string): void => {
    if (redirectTo) { res.redirect(303, redirectTo); return; }
    res.status(status).json({ ok: false, error });
  };

  const agent = ctx.agentStore.getAgent(id);
  if (!agent) {
    fail(404, 'Agent not found.');
    return;
  }

  // Normalise: strip scheme/path/port, lowercase. Same rules as the
  // replace form so a pasted full URL works.
  const host = raw.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!host || !IMG_SRC_HOST_RE.test(host)) {
    fail(400, `Invalid host: ${raw || '(empty)'}`);
    return;
  }

  const current = agent.permissions?.imgSrc ?? [];
  if (current.includes(host)) {
    if (redirectTo) { res.redirect(303, redirectTo); return; }
    res.json({ ok: true, host, imgSrc: current, unchanged: true });
    return;
  }
  const imgSrc = [...current, host].sort();
  try {
    const updated = { ...agent, permissions: { ...agent.permissions, imgSrc } };
    ctx.agentStore.upsertAgent(updated, 'dashboard', `Allowed img-src host ${host}`);
    if (redirectTo) { res.redirect(303, redirectTo); return; }
    res.json({ ok: true, host, imgSrc });
  } catch (err) {
    fail(500, err instanceof Error ? err.message : String(err));
  }
});
