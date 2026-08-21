/**
 * Routes for `/behaviors` — read-only display of Agent Behavior specs.
 *
 * No POST, no PUT, no delete. Behavior specs are files a human authors and a
 * reviewer reads; sua is a reader, not an editor, and nothing here writes to
 * disk or to the database. See docs/adr/0031-agent-behavior-specs.md.
 *
 * Specs are read from disk per request rather than cached in a table. Nothing
 * is persisted, so nothing can be replayed later out of the context it came
 * from — and edits show up on refresh, which is what an author expects.
 */

import { Router, type Request, type Response } from 'express';
import { resolve } from 'node:path';
import { BEHAVIORS_DIR, type LoadBehaviorsResult } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderBehaviorsList, renderBehaviorDetail } from '../views/behaviors.js';

export const behaviorsRouter: Router = Router();

const EMPTY: LoadBehaviorsResult = {
  behaviors: [], byName: new Map(), shadowed: [], diagnostics: [],
};

function load(req: Request): { result: LoadBehaviorsResult; roots: string[]; available: boolean } {
  const ctx = getContext(req.app.locals);
  if (!ctx.loadBehaviors) {
    // Host never wired discovery (bare test harness, embedded use). Render an
    // explanatory empty state rather than a 500.
    return { result: EMPTY, roots: [], available: false };
  }
  const result = ctx.loadBehaviors();
  const roots = [...new Set(result.behaviors.map((b) => b.location.rootDir))];
  return {
    result,
    roots: roots.length > 0 ? roots : [resolve(process.cwd(), BEHAVIORS_DIR)],
    available: true,
  };
}

behaviorsRouter.get('/behaviors', (req: Request, res: Response) => {
  const { result, roots, available } = load(req);
  res.type('html').send(renderBehaviorsList({
    behaviors: result.behaviors,
    shadowed: result.shadowed,
    diagnostics: result.diagnostics,
    roots,
    available,
  }));
});

behaviorsRouter.get('/behaviors/:name', (req: Request, res: Response) => {
  const { result } = load(req);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const behavior = result.byName.get(name);
  if (!behavior) {
    res.redirect(303, '/behaviors');
    return;
  }
  const shadowedBy = result.shadowed.some((s) => s.name === name)
    ? result.byName.get(name)
    : undefined;
  res.type('html').send(renderBehaviorDetail({
    behavior,
    ...(shadowedBy && shadowedBy !== behavior ? { shadowedBy } : {}),
  }));
});
