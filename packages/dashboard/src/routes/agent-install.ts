import { Router, type Request, type Response } from 'express';
import {
  parseAgent,
  AgentYamlParseError,
  assertSafeUrl,
  normalizeAgentUrl,
  fetchYaml,
  type Agent,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import {
  renderAgentInstall,
  renderAgentInstallResult,
} from '../views/agent-install.js';

export const agentInstallRouter: Router = Router();

agentInstallRouter.get('/agents/install', (_req: Request, res: Response) => {
  res.type('html').send(renderAgentInstall({}));
});

agentInstallRouter.post('/agents/install', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, string>;
  const step = body.step === 'confirm' ? 'confirm' : 'preview';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const authHeader = typeof body.authHeader === 'string' ? body.authHeader.trim() : '';

  if (!url) {
    res.status(400).type('html').send(renderAgentInstall({
      url, authHeader,
      error: 'Enter a URL.',
    }));
    return;
  }

  // Stage 1: normalize + SSRF guard.
  let normalized: string;
  try {
    normalized = normalizeAgentUrl(url);
    await assertSafeUrl(normalized);
  } catch (err) {
    res.status(400).type('html').send(renderAgentInstall({
      url, authHeader,
      error: (err as Error).message,
    }));
    return;
  }

  // Stage 2: fetch.
  let yamlText: string;
  try {
    const fetched = await fetchYaml(normalized, {
      authHeader: authHeader || undefined,
    });
    yamlText = fetched.text;
  } catch (err) {
    res.status(400).type('html').send(renderAgentInstall({
      url, authHeader,
      error: (err as Error).message,
    }));
    return;
  }

  // Stage 3: parse + validate.
  let agent: Agent;
  try {
    agent = parseAgent(yamlText);
  } catch (err) {
    const message = err instanceof AgentYamlParseError
      ? err.message
      : (err as Error).message;
    res.status(400).type('html').send(renderAgentInstall({
      url, authHeader,
      error: message,
      fetchedFrom: normalized,
    }));
    return;
  }

  const existing = ctx.agentStore.getAgent(agent.id);

  if (step === 'preview') {
    res.type('html').send(renderAgentInstall({
      url, authHeader,
      preview: agent,
      collision: !!existing,
      existingVersion: existing?.version,
      fetchedFrom: normalized,
    }));
    return;
  }

  // step === 'confirm' — installer takes ownership: source=local.
  const { version: _v, ...agentNoVersion } = agent;
  void _v;
  const toUpsert = { ...agentNoVersion, source: 'local' as const };
  const result = ctx.agentStore.upsertAgent(toUpsert, 'import', `Installed from ${url}`);
  res.type('html').send(renderAgentInstallResult({
    agent: result,
    upgraded: !!existing,
    fetchedFrom: normalized,
  }));
});
