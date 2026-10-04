import { Router, type Request, type Response } from 'express';
import { getContext } from '../../context.js';
import { isAjax } from '../inbox-shared.js';
import { readSettingsForm, settingsMetaPatch } from '../../lib/agent-settings.js';

/**
 * POST /agents/:name/settings: the Settings page's one Save. Applies every
 * batched change (Model, When it runs, Where it shows, Access) as one new
 * version, or only the agent row when nothing versioned changed.
 *
 * `preview=1` (fetch) answers `{ changes, errors }` without saving; the
 * page's Review list uses it. `baseVersion` refuses a save over a version
 * someone else made since the page was opened.
 */
export const agentSettingsRouter: Router = Router();

agentSettingsRouter.post('/agents/:name/settings', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = String(Array.isArray(req.params.name) ? req.params.name[0] : req.params.name);
  const agent = ctx.agentStore.getAgent(name);
  const ajax = isAjax(req);
  if (!agent) {
    if (ajax) { res.status(404).json({ error: 'No such agent.' }); return; }
    res.redirect(303, '/agents');
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const read = readSettingsForm(agent, body);
  const back = (flash: string, hash = '') =>
    `/agents/${encodeURIComponent(agent.id)}/config?flash=${encodeURIComponent(flash)}${hash}`;

  const baseVersion = Number(body.baseVersion);
  const stale = Number.isFinite(baseVersion) && baseVersion > 0 && baseVersion !== agent.version && read.versioned;
  const errors = stale
    ? [`This agent changed since you opened Settings (it's on v${String(agent.version)} now). Reload to see it, then make your changes again.`, ...read.errors]
    : read.errors;

  if (body.preview === '1') {
    res.json({ changes: read.changes, errors, versioned: read.versioned, version: agent.version });
    return;
  }
  if (errors.length > 0) {
    if (ajax) { res.status(400).json({ errors }); return; }
    res.redirect(303, back(errors.join(' ')));
    return;
  }
  if (read.changes.length === 0) {
    if (ajax) { res.json({ ok: true, changes: [] }); return; }
    res.redirect(303, back('Nothing to save.'));
    return;
  }

  const whats = [...new Set(read.changes.map((c) => c.what))];
  let version = agent.version;
  try {
    if (read.versioned) {
      const saved = ctx.agentStore.upsertAgent(read.next, 'dashboard', `Settings: ${whats.join(', ')}`);
      version = saved.version;
    }
    // createNewVersion syncs schedule + mcp but not visibility; write the row-level part explicitly.
    const patch = settingsMetaPatch(read);
    if (Object.keys(patch).length > 0) ctx.agentStore.updateAgentMeta(agent.id, patch);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (ajax) { res.status(500).json({ errors: [`Save failed: ${msg}`] }); return; }
    res.redirect(303, back(`Save failed: ${msg}`));
    return;
  }

  const lead = read.versioned ? `Saved as v${String(version)}: ${whats.join(', ')}.` : `Saved: ${whats.join(', ')}.`;
  const scheduleNote = read.changes.some((c) => c.field === 'schedule')
    ? ' The scheduler picks up the new schedule when it restarts (sua daemon restart --service schedule).'
    : '';
  if (ajax) { res.json({ ok: true, version, changes: read.changes, flash: lead + scheduleNote }); return; }
  res.redirect(303, back(lead + scheduleNote));
});
