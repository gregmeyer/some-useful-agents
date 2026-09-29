import { Router, type Request, type Response } from 'express';
import {
  SessionStore,
  prepareAgentTurn,
  completeAgentTurn,
  reconcileSession,
  resolveChatInput,
  executeAgentDag,
  isAppleIntegrationEnabled,
  NotConversationalError,
  SessionNotFoundError,
  ChatMessageError,
  type Agent,
  type Session,
} from '@some-useful-agents/core';
import { getContext } from '../../context.js';
import { buildLlmSettingsSnapshot } from '../../lib/llm-settings-snapshot.js';
import { resolveRunBackend } from '../../lib/run-backend.js';
import { renderAgentChat } from '../../views/agent-detail/chat.js';
import { buildTabArgs } from './tabs.js';
import { questionStore } from '../../lib/ask-human.js';

/**
 * Chat tab: talk to an agent (docs/conversations.md). A message is recorded
 * against a pre-generated run id, the run is dispatched (Temporal worker or
 * in process, like Run now), and the page reloads until the reply lands.
 * Replies for runs that finished elsewhere are filled in on read
 * (reconcileSession), so a dashboard restart mid-run loses nothing.
 */
export const agentChatRouter: Router = Router();

type Ctx = ReturnType<typeof getContext>;

const param = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';
const sessionsOf = (ctx: Ctx): SessionStore => SessionStore.fromHandle(ctx.runStore.databaseHandle());
const chatUrl = (agentId: string, sessionId?: string, flash?: string, kind: 'ok' | 'error' = 'error'): string => {
  const q = new URLSearchParams();
  if (sessionId) q.set('session', sessionId);
  if (flash) q.set(kind === 'ok' ? 'flash' : 'error', flash);
  const qs = q.toString();
  return `/agents/${encodeURIComponent(agentId)}/chat${qs ? `?${qs}` : ''}`;
};

/** Community shell nodes need the explicit confirmation on Run now; chat doesn't offer it. */
function chatBlockedReason(agent: Agent): string | undefined {
  if (agent.source === 'community' && agent.nodes.some((n) => n.type === 'shell')) {
    return 'This agent has community shell nodes, which need an explicit confirmation each run. Run it from the Overview instead.';
  }
  try {
    resolveChatInput(agent);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

agentChatRouter.get('/agents/:name/chat', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const args = await buildTabArgs(req, ctx, param(req.params.name));
  if (!args) { res.redirect(303, '/agents'); return; }
  const sessions = sessionsOf(ctx);
  const requested = typeof req.query.session === 'string' ? req.query.session : undefined;
  let active: Session | undefined = requested ? sessions.get(requested) : undefined;
  if (active && active.agentId !== args.agent.id) active = undefined;

  const turns = active ? reconcileSession(sessions, ctx.runStore, active.id) : [];
  const last = turns[turns.length - 1];
  const pending = Boolean(last && last.role === 'user' && last.runId);
  // Stopped at an ask node: point at the question instead of reloading.
  const waitingQuestion = pending && last?.runId && ctx.runStore.getRun(last.runId)?.status === 'waiting'
    ? questionStore(ctx).pendingForRun(last.runId)
    : undefined;
  const blocked = chatBlockedReason(args.agent);
  let chatInput: string | undefined;
  if (!blocked) chatInput = resolveChatInput(args.agent);

  const error = typeof req.query.error === 'string' ? req.query.error : undefined;
  res.type('html').send(renderAgentChat({
    ...args,
    ...(error && { flash: { kind: 'error' as const, message: error } }),
    activeTab: 'chat',
    chat: {
      sessions: sessions.list(args.agent.id).map((s) => ({ ...s, turns: sessions.turns(s.id).length })),
      active,
      turns,
      pending,
      waitingQuestion,
      chatInput,
      notConversational: blocked,
    },
  }));
});

agentChatRouter.post('/agents/:name/chat', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agent = ctx.agentStore.getAgent(param(req.params.name));
  if (!agent) { res.redirect(303, '/agents'); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const message = typeof body.message === 'string' ? body.message : '';
  const sessionId = typeof body.session === 'string' && body.session ? body.session : undefined;

  const blocked = chatBlockedReason(agent);
  if (blocked) { res.redirect(303, chatUrl(agent.id, sessionId, blocked)); return; }

  const sessions = sessionsOf(ctx);
  let prepared;
  try {
    prepared = prepareAgentTurn({ agent, sessions, message, sessionId, runStore: ctx.runStore });
  } catch (err) {
    if (err instanceof ChatMessageError || err instanceof SessionNotFoundError || err instanceof NotConversationalError) {
      res.redirect(303, chatUrl(agent.id, sessionId, err.message));
      return;
    }
    throw err;
  }
  const { session, runId, inputs, conversationPreamble } = prepared;

  if (resolveRunBackend(ctx.provider, agent) === 'temporal' && ctx.provider.submitDagRun) {
    try {
      await ctx.provider.submitDagRun(agent, {
        runId,
        inputs,
        triggeredBy: 'dashboard',
        variablesPath: ctx.variablesPath,
        dataRoot: ctx.agentStore.dataRoot,
        llmProviders: buildLlmSettingsSnapshot(ctx)?.providers,
        allowUntrustedShell: ctx.allowUntrustedShell ? [...ctx.allowUntrustedShell] : undefined,
        experimentalApple: isAppleIntegrationEnabled(),
        conversationPreamble: conversationPreamble || undefined,
      });
    } catch (err) {
      // No run row → record the failure as the reply so the turn isn't stuck.
      completeAgentTurn(sessions, session.id, {
        id: runId, status: 'failed', error: `Couldn't start the run: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    res.redirect(303, chatUrl(agent.id, session.id));
    return;
  }

  // In process, fire-and-forget; the page reloads until the reply lands.
  const abortController = new AbortController();
  ctx.activeRuns.set(runId, abortController);
  void executeAgentDag(
    agent,
    {
      triggeredBy: 'dashboard',
      inputs,
      runId,
      signal: abortController.signal,
      conversationPreamble: conversationPreamble || undefined,
    },
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
      // A failed turn shows in the conversation; no separate inbox thread.
      onRunComplete: ctx.onRunCompleteQuiet,
      experimentalApple: isAppleIntegrationEnabled(),
    },
  )
    .then((run) => { completeAgentTurn(sessions, session.id, run); })
    .catch((err) => {
      completeAgentTurn(sessions, session.id, { id: runId, status: 'failed', error: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => { ctx.activeRuns.delete(runId); });

  res.redirect(303, chatUrl(agent.id, session.id));
});

agentChatRouter.post('/agents/:name/chat/:sid/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const agentId = param(req.params.name);
  const sessions = sessionsOf(ctx);
  const s = sessions.get(param(req.params.sid));
  if (s && s.agentId === agentId) sessions.delete(s.id);
  res.redirect(303, chatUrl(agentId, undefined, s && s.agentId === agentId ? 'Conversation deleted. Its runs are kept.' : undefined, 'ok'));
});
