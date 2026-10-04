/**
 * Changing a surface by hand (goal surfaces S4). The Today tab's gestures
 * (pin, move, hide, show, drag) post ops here; they're applied as you
 * (`user`) through the one mutation path, versioned, and can be undone.
 *
 * POST /surfaces/:id/ops      { ops, reason?, expectedVersion?, itemId?, gesture? }
 *   → { version, undoTo, suggestion? }  (409 when the surface moved on)
 * POST /surfaces/:id/restore  { toVersion } → { version }
 */
import { Router, type Request, type Response } from 'express';
import {
  SurfaceStore, SurfaceOpError, SurfaceVersionConflict, collectItems, itemSourcesFromHandle,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { suggestRule } from '../lib/surface-suggest.js';
import { publishInboxEvent, publishInboxChanged, isAjax } from './inbox-shared.js';
import { runTriageAgent } from './inbox-engine.js';

export const surfacesRouter: Router = Router();

const SURFACE_ID_RE = /^[a-z0-9][a-z0-9:-]{0,59}$/;

surfacesRouter.post('/surfaces/:id/ops', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const surfaceId = String(req.params.id);
  if (!SURFACE_ID_RE.test(surfaceId)) { res.status(400).json({ error: 'Not a surface id.' }); return; }
  const body = (req.body ?? {}) as { ops?: unknown; reason?: unknown; expectedVersion?: unknown; itemId?: unknown; gesture?: unknown };
  if (!Array.isArray(body.ops)) { res.status(400).json({ error: 'Send ops as a list.' }); return; }
  const db = ctx.runStore.databaseHandle();
  const store = SurfaceStore.fromHandle(db);
  const before = store.current(surfaceId).version;
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'You changed it by hand';
  try {
    const saved = store.apply(surfaceId, body.ops, 'user', reason, {
      ...(typeof body.expectedVersion === 'number' ? { expectedVersion: body.expectedVersion } : {}),
    });
    // After a gesture on one item, offer the rule that does it for everything like it.
    let suggestion;
    if (typeof body.itemId === 'string' && typeof body.gesture === 'string') {
      const item = collectItems(itemSourcesFromHandle(db, ctx.agentStore, ctx.runStore, ctx.dataDir)).find((i) => i.id === body.itemId);
      if (item) suggestion = suggestRule(body.gesture as Parameters<typeof suggestRule>[0], item, saved.doc);
    }
    res.json({ version: saved.version, undoTo: before, ...(suggestion ? { suggestion } : {}) });
  } catch (err) {
    if (err instanceof SurfaceVersionConflict) { res.status(409).json({ error: err.message, version: err.current }); return; }
    if (err instanceof SurfaceOpError) { res.status(400).json({ error: err.message }); return; }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

surfacesRouter.post('/surfaces/:id/restore', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const surfaceId = String(req.params.id);
  const toVersion = Number((req.body ?? {}).toVersion);
  if (!SURFACE_ID_RE.test(surfaceId) || !Number.isInteger(toVersion) || toVersion < 0) { res.status(400).json({ error: 'Say which version to go back to.' }); return; }
  try {
    const saved = SurfaceStore.fromHandle(ctx.runStore.databaseHandle()).restore(surfaceId, toVersion, 'user');
    res.json({ version: saved.version });
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * "Ask sua to change Home" (goal surfaces S5): a conversation that starts with
 * what you asked; sua answers with a "Change Home" card you Apply.
 */
surfacesRouter.post('/surfaces/home/ask', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 4000) : '';
  if (!ctx.inboxStore || !text) {
    if (isAjax(req)) { res.status(400).json({ error: 'Say what to change.' }); return; }
    res.redirect(303, '/');
    return;
  }
  const created = ctx.inboxStore.add({ priority: 'medium', source: 'manual', title: 'Change Home', body: '(empty)' });
  const ask = ctx.inboxStore.addResponse(created.id, 'user', `On Home: ${text}`);
  publishInboxEvent(ctx, created.id, 'message:created', { responseId: ask.id, role: 'user', body: ask.body, createdAt: ask.createdAt });
  void runTriageAgent(ctx, created.id).catch(() => { /* logged in helper */ });
  publishInboxChanged(ctx, created.id, created.status);
  if (isAjax(req)) { res.setHeader('X-Inbox-Id', created.id); res.status(204).end(); return; }
  res.redirect(303, `/inbox/${encodeURIComponent(created.id)}`);
});
