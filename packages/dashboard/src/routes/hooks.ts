/**
 * POST /hooks/:agent — inbound webhooks (core webhooks.ts, docs/webhooks.md).
 *
 * Mounted BEFORE the session check and the JSON body parser: callers are
 * outside services with no session, and a GitHub signature is computed over
 * the raw bytes. The per-agent secret is the only credential, so everything
 * here answers in plain JSON and says as little as possible to a caller that
 * doesn't hold it.
 */
import express, { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  WebhookStore,
  WebhookRateLimiter,
  WebhookInputError,
  WEBHOOK_MAX_BODY_BYTES,
  executeAgentDag,
  isAppleIntegrationEnabled,
  mapWebhookInputs,
  verifyWebhookRequest,
  webhookFilterMatches,
  type Agent,
  type WebhookRequestData,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import { resolveRunBackend } from '../lib/run-backend.js';

export const hooksRouter: Router = Router();
const limiter = new WebhookRateLimiter();

type Ctx = ReturnType<typeof getContext>;

function parseBody(req: Request, raw: Buffer): { body: unknown; text: string } {
  const text = raw.toString('utf8');
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  if (type.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    // GitHub's form content type wraps the JSON in `payload=`.
    const payload = params.get('payload');
    if (payload) {
      try { return { body: JSON.parse(payload), text: payload }; } catch { /* fall through */ }
    }
    return { body: Object.fromEntries(params.entries()), text };
  }
  if (text.trim().startsWith('{') || text.trim().startsWith('[') || type.includes('json')) {
    try { return { body: JSON.parse(text), text }; } catch { return { body: undefined, text }; }
  }
  return { body: undefined, text };
}

/** Start the run the way Run now does (Temporal worker or in process); returns its id. */
async function startWebhookRun(ctx: Ctx, agent: Agent, inputs: Record<string, string>): Promise<string> {
  if (resolveRunBackend(ctx.provider, agent) === 'temporal' && ctx.provider.submitDagRun) {
    const run = await ctx.provider.submitDagRun(agent, {
      inputs,
      triggeredBy: 'webhook',
      variablesPath: ctx.variablesPath,
      dataRoot: ctx.agentStore.dataRoot,
      llmProviders: buildLlmSettingsSnapshot(ctx)?.providers,
      allowUntrustedShell: ctx.allowUntrustedShell ? [...ctx.allowUntrustedShell] : undefined,
      experimentalApple: isAppleIntegrationEnabled(),
    });
    return run.id;
  }
  const runId = randomUUID();
  const abortController = new AbortController();
  ctx.activeRuns.set(runId, abortController);
  void executeAgentDag(
    agent,
    { triggeredBy: 'webhook', inputs, runId, signal: abortController.signal },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
      integrationsStore: ctx.integrationsStore,
      toolStore: ctx.toolStore,
      agentStore: ctx.agentStore,
      allowUntrustedShell: ctx.allowUntrustedShell,
      dashboardBaseUrl: ctx.dashboardBaseUrl,
      dataRoot: ctx.agentStore.dataRoot,
      llmSettings: buildLlmSettingsSnapshot(ctx),
      spawnNode: ctx.workflowSpawnNode,
      onRunFailure: ctx.onRunFailure,
      onRunComplete: ctx.onRunComplete,
      experimentalApple: isAppleIntegrationEnabled(),
    },
  )
    .catch((err) => console.warn(`[webhook] run ${runId} of ${agent.id} failed to start: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => { ctx.activeRuns.delete(runId); });
  return runId;
}

hooksRouter.post(
  '/hooks/:agent',
  express.raw({ type: () => true, limit: WEBHOOK_MAX_BODY_BYTES }),
  async (req: Request, res: Response) => {
    const ctx = getContext(req.app.locals);
    const agentId = String(Array.isArray(req.params.agent) ? req.params.agent[0] : req.params.agent);
    const store = WebhookStore.fromHandle(ctx.runStore.databaseHandle());
    const hook = store.get(agentId);
    const agent = ctx.agentStore.getAgent(agentId);
    // Same answer for "no such agent" and "webhook off", so a caller without
    // the secret learns nothing about which agents exist.
    if (!hook || !hook.enabled || !agent) {
      res.status(404).json({ error: 'No webhook here.' });
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const auth = verifyWebhookRequest({ token: hook.token, config: agent.webhook, rawBody: raw, headers: req.headers, query: req.query as Record<string, unknown> });
    if (!auth.ok) {
      res.status(401).json({ error: auth.reason });
      return;
    }
    if (!limiter.allow(agentId)) {
      store.recordDelivery(agentId, 'rate-limited');
      res.status(429).json({ error: 'Too many deliveries for this agent; try again in a minute.' });
      return;
    }
    // GitHub sends a ping when the webhook is created.
    if (req.headers['x-github-event'] === 'ping') {
      store.recordDelivery(agentId, 'ping');
      res.status(200).json({ ok: true, pong: true });
      return;
    }
    if (agent.status !== 'active') {
      store.recordDelivery(agentId, `refused: agent ${agent.status}`);
      res.status(409).json({ error: `Agent "${agentId}" is ${agent.status}, so it doesn't take webhook runs.` });
      return;
    }
    if (agent.source === 'community' && agent.nodes.some((n) => n.type === 'shell') && !ctx.allowUntrustedShell?.has(agent.id)) {
      store.recordDelivery(agentId, 'refused: community shell');
      res.status(403).json({ error: 'This agent has community shell nodes, which need an explicit confirmation to run; webhooks can\'t give it.' });
      return;
    }

    const { body, text } = parseBody(req, raw);
    const data: WebhookRequestData = { body, text, headers: req.headers, query: req.query as Record<string, unknown> };
    const filter = webhookFilterMatches(agent.webhook, data);
    if (!filter.matches) {
      store.recordDelivery(agentId, `ignored: ${filter.reason}`);
      res.status(202).json({ ok: true, ignored: true, reason: filter.reason });
      return;
    }
    let inputs: Record<string, string>;
    try {
      inputs = mapWebhookInputs(agent, data);
    } catch (err) {
      const message = err instanceof WebhookInputError ? err.message : String(err);
      store.recordDelivery(agentId, `refused: ${message.slice(0, 200)}`);
      res.status(err instanceof WebhookInputError && /bytes/.test(message) ? 413 : 400).json({ error: message });
      return;
    }
    const missing = Object.entries(agent.inputs ?? {})
      .filter(([name, spec]) => spec.required && spec.default === undefined && !(name in inputs))
      .map(([name]) => name);
    if (missing.length > 0) {
      const message = `Missing required input${missing.length === 1 ? '' : 's'} ${missing.join(', ')}. Send ${missing.length === 1 ? 'it' : 'them'} as top-level JSON fields, or map ${missing.length === 1 ? 'it' : 'them'} with webhook.inputs.`;
      store.recordDelivery(agentId, `refused: ${message.slice(0, 200)}`);
      res.status(400).json({ error: message });
      return;
    }

    try {
      const runId = await startWebhookRun(ctx, agent, inputs);
      store.recordDelivery(agentId, 'started', runId);
      res.status(202).json({ ok: true, runId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.recordDelivery(agentId, `failed to start: ${message.slice(0, 200)}`);
      res.status(500).json({ error: `Could not start the run: ${message}` });
    }
  },
);

/** Express raised a body-size error for this route: answer as JSON. */
export function hooksErrorHandler(err: unknown, req: Request, res: Response, next: (e?: unknown) => void): void {
  if (!req.path.startsWith('/hooks/')) { next(err); return; }
  const e = err as { type?: string; status?: number };
  if (e.type === 'entity.too.large') {
    res.status(413).json({ error: `The body is larger than ${WEBHOOK_MAX_BODY_BYTES / 1024} KB.` });
    return;
  }
  res.status(e.status ?? 400).json({ error: 'Bad request.' });
}
