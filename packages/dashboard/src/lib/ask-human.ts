/**
 * The dashboard half of ask nodes (core human-questions.ts): answer a
 * question, resume the run it stopped, cancel a waiting run, and expire
 * questions nobody answered. See docs/ask-a-person.md.
 */
import {
  HumanQuestionStore,
  executeAgentDag,
  isAppleIntegrationEnabled,
  raiseQuestionInInbox,
  type HumanQuestion,
} from '@some-useful-agents/core';
import type { DashboardContext } from '../context.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { resolveRunBackend } from './run-backend.js';

type Ctx = DashboardContext;

export function questionStore(ctx: Ctx): HumanQuestionStore {
  return HumanQuestionStore.fromHandle(ctx.runStore.databaseHandle());
}

/** The question an inbox item asks, if it is a question item. */
export function questionForMessage(ctx: Ctx, message: { source: string; contextJson?: string }): HumanQuestion | undefined {
  if (message.source !== 'question' || !message.contextJson) return undefined;
  try {
    const { questionId } = JSON.parse(message.contextJson) as { questionId?: string };
    return questionId ? questionStore(ctx).get(questionId) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Carry on with a run that stopped at an ask node, on the backend it would
 * run on, from the agent version it started on. The executor resumes after
 * the last completed node; the ask node then completes with the answer (or
 * fails, if the question expired or was cancelled). Fire-and-forget.
 */
export async function resumeWaitingRun(ctx: Ctx, runId: string): Promise<{ ok: boolean; error?: string }> {
  const run = ctx.runStore.getRun(runId);
  if (!run) return { ok: false, error: `Run ${runId} not found.` };
  if (run.status !== 'waiting') return { ok: false, error: `Run ${runId.slice(0, 8)} isn't waiting (it's ${run.status}).` };
  const agent = (run.workflowVersion !== undefined ? ctx.agentStore.getAgentAtVersion(run.agentName, run.workflowVersion) : null)
    ?? ctx.agentStore.getAgent(run.agentName);
  if (!agent) return { ok: false, error: `Agent "${run.agentName}" no longer exists, so the run can't continue.` };

  if (resolveRunBackend(ctx.provider, agent) === 'temporal' && ctx.provider.submitDagRun) {
    try {
      await ctx.provider.submitDagRun(agent, {
        runId,
        resume: true,
        triggeredBy: run.triggeredBy,
        variablesPath: ctx.variablesPath,
        dataRoot: ctx.agentStore.dataRoot,
        llmProviders: buildLlmSettingsSnapshot(ctx)?.providers,
        allowUntrustedShell: ctx.allowUntrustedShell ? [...ctx.allowUntrustedShell] : undefined,
        experimentalApple: isAppleIntegrationEnabled(),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Couldn't resume the run on Temporal: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const abortController = new AbortController();
  ctx.activeRuns.set(runId, abortController);
  void executeAgentDag(
    agent,
    { triggeredBy: run.triggeredBy, runId, resume: true, signal: abortController.signal },
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
    .catch((err) => console.warn(`[ask] resume of ${runId} failed: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => { ctx.activeRuns.delete(runId); });
  return { ok: true };
}

/**
 * Answer a question: record it (once — a second answer is ignored), put it
 * in the inbox thread, close the item, and resume the run.
 */
export async function answerQuestion(ctx: Ctx, question: HumanQuestion, answer: string): Promise<{ ok: boolean; error?: string }> {
  const store = questionStore(ctx);
  let recorded: boolean;
  try {
    recorded = store.answer(question.id, answer);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!recorded) {
    const now = store.get(question.id);
    return { ok: false, error: now?.status === 'answered' ? 'This question was already answered.' : `This question is ${now?.status ?? 'gone'}; it can't be answered now.` };
  }
  if (ctx.inboxStore && question.inboxMessageId) {
    try {
      ctx.inboxStore.addResponse(question.inboxMessageId, 'user', answer.trim());
      ctx.inboxStore.updateStatus(question.inboxMessageId, 'resolved');
    } catch { /* the answer is recorded; the thread is best-effort */ }
  }
  return resumeWaitingRun(ctx, question.runId);
}

/** Cancel a waiting run: close its question and item, mark it cancelled. */
export function cancelWaitingRun(ctx: Ctx, runId: string): boolean {
  const run = ctx.runStore.getRun(runId);
  if (!run || run.status !== 'waiting') return false;
  const store = questionStore(ctx);
  const q = store.pendingForRun(runId);
  if (q) {
    store.closeQuestion(q.id, 'cancelled');
    if (ctx.inboxStore && q.inboxMessageId) {
      try {
        ctx.inboxStore.addResponse(q.inboxMessageId, 'system', 'The run was cancelled, so this question no longer needs an answer.');
        ctx.inboxStore.updateStatus(q.inboxMessageId, 'dismissed');
      } catch { /* best-effort */ }
    }
  }
  ctx.runStore.updateRun(runId, { status: 'cancelled', completedAt: new Date().toISOString(), error: 'Cancelled while waiting for an answer.' });
  return true;
}

/**
 * One sweep: expire questions past their deadline (the run resumes and the
 * ask node fails as a timeout), and raise any question that has no inbox
 * item yet (the process that asked couldn't create one).
 */
export async function sweepQuestionsOnce(ctx: Ctx, now: Date = new Date()): Promise<{ expired: number; raised: number }> {
  const store = questionStore(ctx);
  let expired = 0;
  for (const q of store.listExpired(now)) {
    if (!store.closeQuestion(q.id, 'expired')) continue;
    expired += 1;
    if (ctx.inboxStore && q.inboxMessageId) {
      try {
        ctx.inboxStore.addResponse(q.inboxMessageId, 'system', 'Nobody answered in time, so the run stopped.');
        ctx.inboxStore.updateStatus(q.inboxMessageId, 'dismissed');
      } catch { /* best-effort */ }
    }
    await resumeWaitingRun(ctx, q.runId);
  }
  let raised = 0;
  for (const q of store.listPending()) {
    if (q.inboxMessageId) continue;
    try {
      raiseQuestionInInbox(ctx.runStore.databaseHandle(), q, ctx.agentStore.getAgent(q.agentId)?.name ?? q.agentId);
      raised += 1;
    } catch { /* try again next sweep */ }
  }
  return { expired, raised };
}

export const QUESTION_SWEEP_INTERVAL_MS = 60_000;

export function startQuestionSweeper(ctx: Ctx): () => void {
  const timer = setInterval(() => {
    sweepQuestionsOnce(ctx).catch((err) => console.warn('[ask] question sweep failed:', err instanceof Error ? err.message : String(err)));
  }, QUESTION_SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
