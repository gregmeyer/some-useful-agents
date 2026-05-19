import { Router, type Request, type Response } from 'express';
import { detectLlms, PROVIDERS, PROVIDER_IDS } from '@some-useful-agents/core';
import { getContext } from '../../context.js';
import { renderAgentNew, type AgentNewFormValues } from '../../views/agent-new.js';
import { parseLlmOptions } from '../../views/llm-options.js';

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

let cachedProviders: string[] | null = null;
function getInstalledProviders(): string[] {
  if (cachedProviders) return cachedProviders;
  const avail = detectLlms();
  cachedProviders = PROVIDER_IDS
    .filter((id) => avail[id].installed)
    .map((id) => PROVIDERS[id].displayName);
  return cachedProviders;
}

/**
 * GET  /agents/new — show the create-agent form.
 * POST /agents/new — create a single-node v2 DAG agent via AgentStore.
 *
 * Mounted BEFORE the `/agents/:name` routes so Express matches this
 * exact path first instead of treating "new" as an agent id.
 */
export const agentNewRouter: Router = Router();

agentNewRouter.get('/agents/new', (_req: Request, res: Response) => {
  res.type('html').send(renderAgentNew({ installedProviders: getInstalledProviders(),}));
});

agentNewRouter.post('/agents/new', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const values: AgentNewFormValues = {
    id: typeof body.id === 'string' ? body.id.trim() : undefined,
    name: typeof body.name === 'string' ? body.name.trim() : undefined,
    description: typeof body.description === 'string' ? body.description.trim() : undefined,
    type: (body.type === 'llm-prompt' || body.type === 'claude-code') ? 'llm-prompt' : 'shell',
    command: typeof body.command === 'string' ? body.command : undefined,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    provider: typeof body.provider === 'string' ? body.provider : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
    maxTurns: typeof body.maxTurns === 'string' ? body.maxTurns : undefined,
    allowedTools: typeof body.allowedTools === 'string' ? body.allowedTools : undefined,
  };

  // Validate in order of what the user typed top-to-bottom so the error
  // points at the first thing wrong rather than a buried field.
  if (!values.id || !AGENT_ID_RE.test(values.id)) {
    res.status(400).type('html').send(renderAgentNew({ installedProviders: getInstalledProviders(),
      values,
      error: 'Id must be lowercase letters, digits, or hyphens, starting with a letter or digit.',
    }));
    return;
  }
  if (!values.name) {
    res.status(400).type('html').send(renderAgentNew({ installedProviders: getInstalledProviders(),
      values,
      error: 'Name is required.',
    }));
    return;
  }
  if (ctx.agentStore.getAgent(values.id)) {
    res.status(400).type('html').send(renderAgentNew({ installedProviders: getInstalledProviders(),
      values,
      error: `An agent with id "${values.id}" already exists.`,
    }));
    return;
  }
  if (values.type === 'shell' && (!values.command || values.command.trim() === '')) {
    res.status(400).type('html').send(renderAgentNew({ installedProviders: getInstalledProviders(),
      values,
      error: 'Shell agents need a command.',
    }));
    return;
  }
  if (values.type === 'llm-prompt' && (!values.prompt || values.prompt.trim() === '')) {
    res.status(400).type('html').send(renderAgentNew({ installedProviders: getInstalledProviders(),
      values,
      error: 'LLM-prompt agents need a prompt.',
    }));
    return;
  }

  const llm = values.type === 'llm-prompt' ? parseLlmOptions(body) : {};

  try {
    ctx.agentStore.createAgent(
      {
        id: values.id,
        name: values.name,
        description: values.description || undefined,
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [
          values.type === 'shell'
            ? { id: 'main', type: 'shell', command: values.command! }
            : {
                id: 'main',
                type: 'llm-prompt',
                prompt: values.prompt!,
                ...(llm.provider ? { provider: llm.provider } : {}),
                ...(llm.model ? { model: llm.model } : {}),
                ...(llm.maxTurns ? { maxTurns: llm.maxTurns } : {}),
                ...(llm.allowedTools ? { allowedTools: llm.allowedTools } : {}),
              },
        ],
      },
      'dashboard',
      'Created via /agents/new',
    );
    res.redirect(303, `/agents/${encodeURIComponent(values.id)}/add-node?fromCreate=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).type('html').send(renderAgentNew({ installedProviders: getInstalledProviders(),
      values,
      error: `Create failed: ${msg}`,
    }));
  }
});
