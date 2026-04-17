import { Router, type Request, type Response } from 'express';
import type { RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderRunsList } from '../views/runs-list.js';
import { renderRunDetail } from '../views/run-detail.js';
import { deriveBack } from '../views/page-header.js';

const VALID_STATUSES: RunStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
const VALID_STATUS_SET = new Set<string>(VALID_STATUSES);

export const runsRouter: Router = Router();

runsRouter.get('/runs', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flash = flashParam ? { kind: 'error' as const, message: flashParam } : undefined;

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
    flash,
  }));
});

runsRouter.get('/runs/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const run = ctx.runStore.getRun(id);
  if (!run) {
    res.status(404).redirect(303, `/runs?flash=${encodeURIComponent(`Run "${id}" not found. It may have been pruned by the retention policy.`)}`);
    return;
  }

  const partial = req.query.partial === '1';

  // v2 runs: pull per-node executions + the agent definition so the
  // detail page can render the DAG and a per-node breakdown. The DAG
  // uses the current version from the store; a follow-up PR could pull
  // the exact version the run executed against if users expect to see
  // old DAGs for old runs. For v0.13 "current version" is good enough.
  let nodeExecutions, agent;
  if (run.workflowId) {
    nodeExecutions = ctx.runStore.listNodeExecutions(id);
    agent = ctx.agentStore.getAgent(run.workflowId) ?? undefined;
  }

  // Contextual back link — ?from=tutorial (or similar) takes priority
  // over the Referer because it was threaded through the POST redirect
  // from the originating page and survives multi-hop flows.
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
  const expectedHost = `127.0.0.1:${ctx.port}`;
  const back = deriveBack(referer, expectedHost, req.query.from);

  // Flash from replay POSTs or run-now redirects. Failed replays
  // 303-redirect back to the prior run with ?flash=; successful replays
  // 303 to the NEW run's page and include a "Replayed from …" note.
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const isError = flashParam
    ? /replay failed|not found|not in agent|needs|required|only works/i.test(flashParam)
    : false;
  const flash = flashParam
    ? { kind: isError ? ('error' as const) : ('ok' as const), message: flashParam }
    : undefined;

  const analyzerTarget = typeof req.query.analyzerTarget === 'string' ? req.query.analyzerTarget : undefined;
  res.type('html').send(renderRunDetail({ run, partial, nodeExecutions, agent, back, flash, analyzerTarget }));
});

function parseIntOr(v: unknown, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
