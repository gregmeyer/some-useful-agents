import { Router, type Request, type Response } from 'express';
import { listBuiltinTools, getBuiltinTool } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderToolsList } from '../views/tools-list.js';
import { renderToolDetail } from '../views/tool-detail.js';
import type { ToolDefinition } from '@some-useful-agents/core';

export const toolsRouter: Router = Router();

toolsRouter.get('/tools', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const builtins = listBuiltinTools();
  let userTools: ToolDefinition[] = [];
  try {
    if (ctx.toolStore) {
      userTools = ctx.toolStore.listTools();
    }
  } catch {
    // Store not available — show builtins only.
  }
  res.type('html').send(renderToolsList({ builtins, userTools }));
});

toolsRouter.get('/tools/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Check builtins first.
  const builtin = getBuiltinTool(id);
  if (builtin) {
    res.type('html').send(renderToolDetail({ tool: builtin.definition }));
    return;
  }

  // Check user store.
  try {
    if (ctx.toolStore) {
      const tool = ctx.toolStore.getTool(id);
      if (tool) {
        res.type('html').send(renderToolDetail({ tool }));
        return;
      }
    }
  } catch {
    // Store unavailable.
  }

  res.status(404).redirect(303, '/tools');
});
