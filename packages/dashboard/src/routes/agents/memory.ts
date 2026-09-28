import { Router, type Request, type Response } from 'express';
import { MemoryStore } from '@some-useful-agents/core';
import { getContext } from '../../context.js';

/**
 * Forget / pin an agent's memories from the Overview's Memory section.
 * Each note is looked up under the agent in the URL, so one agent's page
 * can never touch another agent's memory.
 */
export const agentMemoryRouter: Router = Router();

function param(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function store(req: Request): MemoryStore {
  return MemoryStore.fromHandle(getContext(req.app.locals).runStore.databaseHandle());
}

function back(res: Response, agentId: string, message: string): void {
  res.redirect(303, `/agents/${encodeURIComponent(agentId)}?flash=${encodeURIComponent(message)}`);
}

agentMemoryRouter.post('/agents/:name/memory/:id/forget', (req: Request, res: Response) => {
  const agentId = param(req.params.name);
  const id = param(req.params.id);
  const ok = store(req).forget(agentId, id);
  back(res, agentId, ok ? `Forgot ${id}.` : `No memory ${id} for this agent.`);
});

agentMemoryRouter.post('/agents/:name/memory/:id/pin', (req: Request, res: Response) => {
  const agentId = param(req.params.name);
  const id = param(req.params.id);
  const pinned = (req.body as { pinned?: string } | undefined)?.pinned !== 'false';
  const ok = store(req).setPinned(agentId, id, pinned);
  back(res, agentId, ok ? `${pinned ? 'Pinned' : 'Unpinned'} ${id}.` : `No memory ${id} for this agent.`);
});
