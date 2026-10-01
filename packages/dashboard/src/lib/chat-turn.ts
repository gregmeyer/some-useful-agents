import {
  completeAgentTurn,
  executeAgentDag,
  isAppleIntegrationEnabled,
  prepareAgentTurn,
  type Agent,
  type Session,
  type SessionStore,
  type SpawnProgress,
} from '@some-useful-agents/core';
import type { DashboardContext } from '../context.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { resolveRunBackend } from './run-backend.js';
import { InboxEventBus } from './inbox-event-bus.js';

/** The live-event channel for one conversation. */
export function sessionChannel(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * The bus chat events go out on (the WebSocket subscribes to it). Same
 * class as the inbox bus: per-channel ring buffer, so a reconnecting client
 * replays what it missed. Created on first use when the server didn't set one.
 */
export function chatBus(ctx: DashboardContext): InboxEventBus {
  if (!ctx.chatEventBus) ctx.chatEventBus = new InboxEventBus({ ringSize: 400 });
  return ctx.chatEventBus;
}

/**
 * Chat events, as the browser sees them:
 * - `turn-start` {runId, streaming}: a reply is being worked on (`streaming:
 *   false` on the durable backend, where progress isn't relayed; the client
 *   falls back to polling).
 * - `token` {text, nodeId}: text the model produced, appended in order
 *   (claude streams small deltas; codex and OpenAI-compatible endpoints send
 *   whole messages).
 * - `tool` {name, status: call|result, preview?, isError?}.
 * - `turn-end` {runId, status}: the reply is recorded; re-render from source.
 */
function publish(ctx: DashboardContext, sessionId: string, type: string, data: Record<string, unknown>): void {
  try { chatBus(ctx).publish(sessionChannel(sessionId), { type, data }); } catch { /* never break a run */ }
}

function relayProgress(ctx: DashboardContext, sessionId: string, runId: string, nodeId: string, p: SpawnProgress, streamed: Set<string>): void {
  if (p.type === 'output_delta' && p.message) {
    streamed.add(nodeId);
    publish(ctx, sessionId, 'token', { runId, text: p.message, nodeId });
  } else if (p.type === 'output_chunk' && p.message) {
    // A provider that streamed deltas for this node already sent this text.
    if (streamed.has(nodeId)) return;
    publish(ctx, sessionId, 'token', { runId, text: p.message, nodeId });
  } else if (p.type === 'tool_use' && p.toolName) {
    publish(ctx, sessionId, 'tool', {
      runId, name: p.toolName, status: p.toolStatus ?? 'call', nodeId,
      ...(p.preview ? { preview: p.preview.slice(0, 160) } : {}),
      ...(p.isError ? { isError: true } : {}),
    });
  }
}

/**
 * Start one turn of a conversation: record the message, start the run (in
 * process, or on the durable backend), and relay its progress to the
 * session's channel. Returns as soon as the run is started. Throws the
 * `prepareAgentTurn` errors (bad message, unknown session, not conversational).
 */
export async function startChatTurn(
  ctx: DashboardContext,
  sessions: SessionStore,
  agent: Agent,
  args: {
    message: string;
    sessionId?: string;
    /** Called once the session exists, before any event is published (so a socket can subscribe first). */
    onSession?: (session: Session, runId: string) => void;
  },
): Promise<{ session: Session; runId: string }> {
  const prepared = prepareAgentTurn({ agent, sessions, message: args.message, sessionId: args.sessionId, runStore: ctx.runStore });
  const { session, runId, inputs, conversationPreamble } = prepared;
  try { args.onSession?.(session, runId); } catch { /* a subscriber problem never blocks the turn */ }

  if (resolveRunBackend(ctx.provider, agent) === 'temporal' && ctx.provider.submitDagRun) {
    publish(ctx, session.id, 'turn-start', { runId, streaming: false });
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
      publish(ctx, session.id, 'turn-end', { runId, status: 'failed' });
    }
    return { session, runId };
  }

  publish(ctx, session.id, 'turn-start', { runId, streaming: true });
  const streamedNodes = new Set<string>();
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
      inboxOnProgress: ({ nodeId, progress }) => relayProgress(ctx, session.id, runId, nodeId, progress, streamedNodes),
    },
  )
    .then((run) => {
      completeAgentTurn(sessions, session.id, run);
      publish(ctx, session.id, 'turn-end', { runId, status: run.status });
    })
    .catch((err) => {
      completeAgentTurn(sessions, session.id, { id: runId, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      publish(ctx, session.id, 'turn-end', { runId, status: 'failed' });
    })
    .finally(() => { ctx.activeRuns.delete(runId); });
  return { session, runId };
}

/** A widget action (A2UI `action` event) as the user message it stands for. */
export interface ChatAction { name: string; context?: Record<string, unknown> }

/**
 * Validate a widget action and turn it into the next turn's message: the
 * context's `message` (so a choice button can say exactly what it means),
 * else "▸ name (key: value, …)". Returns an error string when it's malformed.
 */
export function actionToMessage(input: unknown): { message: string } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'An action needs a name.' };
  const a = input as { name?: unknown; context?: unknown };
  if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 64) return { error: 'An action needs a name (at most 64 characters).' };
  const context = a.context && typeof a.context === 'object' && !Array.isArray(a.context) ? a.context as Record<string, unknown> : {};
  if (JSON.stringify(context).length > 4096) return { error: 'That action carries too much data.' };
  if (typeof context.message === 'string' && context.message.trim()) return { message: context.message.trim().slice(0, 2000) };
  const parts = Object.entries(context)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return { message: `▸ ${a.name.trim()}${parts.length ? ` (${parts.join(', ')})` : ''}`.slice(0, 2000) };
}
