/**
 * POST /api/img-block-report — accept a CSP-violation report from the
 * client `csp-img-report.js.ts` listener.
 *
 * Body: { agentId: string, host: string }
 * Returns: { ok: boolean }
 *
 * Records (agent_id, host) in BlockedImgHostsStore so the agent config
 * page can surface "Recently blocked" pills with one-click allow buttons.
 *
 * Validation is permissive on the input side (the listener already
 * filters to img-src violations and extracts the hostname) but the
 * store rejects malformed hosts via isValidImgHost. We respond `ok:true`
 * for both valid-recorded and silently-dropped cases — the client doesn't
 * need to know, and we don't want a hot loop of failed reports if some
 * weird URL slips through.
 */

import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';

export const imgBlockReportRouter: Router = Router();

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

imgBlockReportRouter.post('/api/img-block-report', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
  const host = typeof body.host === 'string' ? body.host.trim() : '';

  if (!agentId || !AGENT_ID_RE.test(agentId) || !host) {
    res.status(400).json({ ok: false, error: 'agentId and host required' });
    return;
  }

  if (!ctx.blockedImgHostsStore) {
    // No store wired — silently accept and drop. Keeps the client
    // listener simple (always POST, never branch on store availability).
    res.json({ ok: true, recorded: false });
    return;
  }

  try {
    const recorded = ctx.blockedImgHostsStore.record(agentId, host);
    res.json({ ok: true, recorded: recorded !== null });
  } catch {
    // Best-effort: do not 500 a UX-nudge report.
    res.json({ ok: true, recorded: false });
  }
});

/**
 * GET /api/img-blocks/:agentId — read the recent blocks for one agent.
 *
 * Used by the agent config page (server-side render) and the
 * client-side pill panel when it polls for newly-recorded blocks while
 * the page is open.
 */
imgBlockReportRouter.get('/api/img-blocks/:agentId', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agentId = Array.isArray(req.params.agentId)
    ? req.params.agentId[0]
    : req.params.agentId;
  if (!agentId || !AGENT_ID_RE.test(agentId) || !ctx.blockedImgHostsStore) {
    res.json({ ok: true, blocks: [] });
    return;
  }
  const blocks = ctx.blockedImgHostsStore.listForAgent(agentId);
  res.json({ ok: true, blocks });
});

/**
 * POST /api/img-blocks/:agentId/dismiss — clear all blocked entries
 * for one agent. Used when the user dismisses the "Recently blocked"
 * panel without adding any host.
 */
imgBlockReportRouter.post('/api/img-blocks/:agentId/dismiss', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agentId = Array.isArray(req.params.agentId)
    ? req.params.agentId[0]
    : req.params.agentId;
  if (!agentId || !AGENT_ID_RE.test(agentId)) {
    res.status(400).json({ ok: false, error: 'invalid agentId' });
    return;
  }
  ctx.blockedImgHostsStore?.clearForAgent(agentId);
  res.json({ ok: true });
});
