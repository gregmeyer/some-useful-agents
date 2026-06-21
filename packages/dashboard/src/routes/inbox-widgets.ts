/**
 * Inbox view-data + in-thread widget boundary.
 *
 * This is the SINGLE place "what the inbox renders for a thread" is assembled:
 * the thread summary, the fork/retarget target list, and — most relevant for
 * future work — the inline rendering of agent OUTPUT WIDGETS inside a
 * conversation (`buildInlineActionWidgets` + `INLINE_INBOX_WIDGET_TYPES`, which
 * already allows the `dashboard` widget type). Routes and the detail views call
 * into here; they don't re-derive view data inline.
 *
 * Extension point: to surface dashboard/output widgets in threads more richly
 * (a planned "inbox span of control" capability), widen `INLINE_INBOX_WIDGET_TYPES`
 * and the render path HERE — not in the route file.
 */
import {
  exportAgent,
  unallowedWidgetImageHosts,
  type Agent,
  type InboxResponse,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { html, type SafeHtml } from '../views/html.js';
import { renderOutputWidget } from '../views/output-widgets.js';
import {
  summarizeInline,
  humanInboxStatus,
  parseActionMeta,
  SYSTEM_AGENT_IDS,
} from './inbox-shared.js';

const INLINE_INBOX_WIDGET_TYPES: ReadonlySet<string> = new Set([
  'ai-template',
  'key-value',
  'dashboard',
  'raw',
]);

/** Installed non-system agents a thread can be forked/retargeted to. */
export function listForkableAgents(ctx: ReturnType<typeof getContext>): { id: string; name: string }[] {
  try {
    return ctx.agentStore.listAgents()
      .filter((agent) => !SYSTEM_AGENT_IDS.has(agent.id))
      .map((agent) => ({ id: agent.id, name: agent.name || agent.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Derive a thread summary (goal / latest result / next step) purely from the
 * thread's existing responses — no LLM call. The goal is the latest real user
 * ask; the latest result is the most recent completed action / triage / system
 * note; the next step is the most recent still-proposed action. Used by the
 * summary block and the fork/summarize routes.
 */
export function buildThreadSummary(
  message: { title: string; status: string; body: string },
  responses: readonly InboxResponse[],
): { currentGoal: string; latestResult?: string; currentStatus: string; nextStep?: string } {
  let currentGoal = summarizeInline(message.title, 140)
    ?? summarizeInline(message.body, 140)
    ?? 'Continue the thread';
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const response = responses[i];
    if (response.role !== 'user') continue;
    if (response.body.trim() === '(Asked triage to take another look.)') continue;
    currentGoal = summarizeInline(response.body, 140) ?? currentGoal;
    break;
  }

  let latestResult: string | undefined;
  let nextStep: string | undefined;
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const response = responses[i];
    const action = parseActionMeta(response);
    if (!latestResult && action?.status === 'completed') {
      latestResult = summarizeInline(action.resultSummary ?? response.body, 180);
    }
    if (!latestResult && (response.role === 'triage' || response.role === 'system')) {
      latestResult = summarizeInline(response.body, 180);
    }
    if (!nextStep && action?.status === 'proposed') {
      nextStep = summarizeInline(action.rationale ?? `Run ${action.agentId}`, 160);
    }
    if (latestResult && nextStep) break;
  }

  return { currentGoal, latestResult, currentStatus: humanInboxStatus(message.status), nextStep };
}

export function canRenderInlineInboxWidget(agent: Agent | null | undefined): agent is Agent & { outputWidget: NonNullable<Agent['outputWidget']> } {
  if (!agent?.outputWidget) return false;
  return INLINE_INBOX_WIDGET_TYPES.has(agent.outputWidget.type);
}

export function renderBlockedInlineWidgetNotice(
  agentId: string,
  messageId: string,
  blockedHosts: readonly string[],
): SafeHtml {
  const forms = blockedHosts.map((host) => html`
    <form method="POST" action="/agents/${agentId}/permissions/allow-host" style="display: inline; margin: 0;">
      <input type="hidden" name="host" value="${host}">
      <input type="hidden" name="redirect" value="/inbox/${messageId}">
      <button type="submit" class="btn btn--xs btn--ghost">Allow ${host}</button>
    </form>
  `);
  return html`
    <div class="flash flash--error" style="margin-top: var(--space-2);">
      <div style="font-size: var(--font-size-xs); margin-bottom: var(--space-2);">
        Inline widget hidden. It references blocked image host${blockedHosts.length === 1 ? '' : 's'}.
      </div>
      <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
        ${forms as unknown as SafeHtml[]}
      </div>
    </div>
  `;
}

export function buildInlineActionWidgets(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  responses: readonly InboxResponse[],
): Record<string, SafeHtml | undefined> {
  const inlineWidgets: Record<string, SafeHtml | undefined> = {};
  for (const response of responses) {
    const meta = parseActionMeta(response);
    if (!meta || meta.status !== 'completed' || !meta.runId) continue;
    const agent = ctx.agentStore.getAgent(meta.agentId);
    if (!canRenderInlineInboxWidget(agent)) continue;
    const run = ctx.runStore.getRun(meta.runId);
    if (!run?.result) continue;

    const blockedHosts = unallowedWidgetImageHosts({
      outputWidget: agent.outputWidget,
      permissions: agent.permissions,
      result: run.result,
    });
    if (blockedHosts.length > 0) {
      inlineWidgets[response.id] = renderBlockedInlineWidgetNotice(agent.id, messageId, blockedHosts);
      continue;
    }

    inlineWidgets[response.id] = renderOutputWidget(agent.outputWidget, run.result, agent.id);
  }
  return inlineWidgets;
}

/**
 * Export the YAML of the agent referenced by `agentId` (the inbox
 * message's target). The detail view passes this into the diff
 * renderer so `agent-editor` action cards can show old-vs-new.
 * Returns undefined when there's no target or the agent isn't
 * installed — the view falls back to rendering just inputs.
 */
export function exportTargetAgentYaml(
  ctx: ReturnType<typeof getContext>,
  agentId: string | undefined,
): string | undefined {
  if (!agentId) return undefined;
  const target = ctx.agentStore.getAgent(agentId);
  if (!target) return undefined;
  try { return exportAgent(target); } catch { return undefined; }
}
