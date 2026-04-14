import { Router, type Request, type Response } from 'express';
import type { RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderRunsList } from '../views/runs-list.js';
import { renderRunDetail } from '../views/run-detail.js';

const VALID_STATUSES: RunStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
const VALID_STATUS_SET = new Set<string>(VALID_STATUSES);

export const runsRouter: Router = Router();

runsRouter.get('/runs', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  const agent = typeof req.query.agent === 'string' && req.query.agent.length > 0
    ? req.query.agent : undefined;
  const triggeredBy = typeof req.query.triggeredBy === 'string' && req.query.triggeredBy.length > 0
    ? req.query.triggeredBy : undefined;
  const q = typeof req.query.q === 'string' && req.query.q.length > 0
    ? req.query.q : undefined;

  // ?status=completed&status=failed → array of valid statuses only.
  const rawStatuses = req.query.status;
  const statuses: RunStatus[] = (Array.isArray(rawStatuses) ? rawStatuses : rawStatuses ? [rawStatuses] : [])
    .filter((s): s is string => typeof s === 'string')
    .filter((s) => VALID_STATUS_SET.has(s)) as RunStatus[];

  const limit = parseIntOr(req.query.limit, 50);
  const offset = parseIntOr(req.query.offset, 0);

  const { rows, total } = ctx.runStore.queryRuns({
    agentName: agent,
    triggeredBy,
    statuses,
    q,
    limit,
    offset,
  });

  // Populate dropdowns from DISTINCT values. Cheap: indexed columns only.
  const distinct = {
    agents: ctx.runStore.distinctValues('agentName'),
    statuses: ctx.runStore.distinctValues('status'),
    triggeredBy: ctx.runStore.distinctValues('triggeredBy'),
  };

  res.type('html').send(renderRunsList({
    rows,
    total,
    limit,
    offset,
    filter: { agent, statuses, triggeredBy, q },
    distinct,
  }));
});

runsRouter.get('/runs/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const run = ctx.runStore.getRun(id);
  if (!run) {
    res.status(404).type('html').send(`<p>Run ${escapeAttr(id)} not found. <a href="/runs">Back</a></p>`);
    return;
  }

  const partial = req.query.partial === '1';
  res.type('html').send(renderRunDetail({ run, partial }));
});

function parseIntOr(v: unknown, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function escapeAttr(s: string): string {
  return s.replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c] ?? c));
}
