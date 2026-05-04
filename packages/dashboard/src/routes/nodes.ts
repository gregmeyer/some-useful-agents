/**
 * Node catalog routes:
 *   GET /api/nodes        — JSON list of every node type's contract
 *   GET /api/nodes/:type  — JSON for one node type
 *   GET /nodes            — browseable HTML page
 *
 * The catalog itself lives in `@some-useful-agents/core` so the
 * planner-fronted agent-builder can query it the same way the dashboard
 * does, without depending on dashboard-only code.
 */

import { Router, type Request, type Response } from 'express';
import { listNodeContracts, getNodeContract } from '@some-useful-agents/core';
import { renderNodes } from '../views/nodes.js';

export const nodesRouter: Router = Router();

nodesRouter.get('/api/nodes', (_req: Request, res: Response) => {
  res.json({ nodes: listNodeContracts() });
});

nodesRouter.get('/api/nodes/:type', (req: Request, res: Response) => {
  const type = Array.isArray(req.params.type) ? req.params.type[0] : req.params.type;
  const contract = getNodeContract(type);
  if (!contract) {
    res.status(404).json({ error: `Unknown node type: ${type}` });
    return;
  }
  res.json(contract);
});

nodesRouter.get('/nodes', (_req: Request, res: Response) => {
  res.type('html').send(renderNodes({ catalog: listNodeContracts() }));
});
