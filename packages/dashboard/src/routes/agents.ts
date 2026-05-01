import { Router } from 'express';
import { agentNewRouter } from './agents/new.js';
import { agentDeleteRouter } from './agents/delete.js';
import { agentStarRouter } from './agents/star.js';
import { agentListRouter } from './agents/list.js';
import { agentDetailRouter } from './agents/detail.js';
import { agentTabsRouter } from './agents/tabs.js';

/**
 * Top-level agents router. Each sub-router lives in routes/agents/<file>.ts;
 * mounting order matters because Express does first-match routing — the
 * literal `/agents/new` path must register before `/agents/:name`, or
 * Express treats "new" as an agent id.
 */
export const agentsRouter: Router = Router();

agentsRouter.use(agentNewRouter);
agentsRouter.use(agentDeleteRouter);
agentsRouter.use(agentStarRouter);
agentsRouter.use(agentListRouter);
agentsRouter.use(agentDetailRouter);
agentsRouter.use(agentTabsRouter);
