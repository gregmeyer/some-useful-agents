/**
 * First-add courtesy run for dashboard tiles.
 *
 * A tile renders blank until its agent has produced output, so a freshly added
 * agent that has never run shows an empty card. This fires one fire-and-forget
 * run so the tile populates in place on the next render. Shared by the dashboard
 * editor routes and the inbox-triage `dashboard-editor` action so both populate
 * tiles the same way. Not pure (it needs the full ctx store bundle +
 * executeAgentWithRetry), so it lives in the dashboard package rather than core.
 */
import { executeAgentWithRetry } from '@some-useful-agents/core';
import { type DashboardContext } from '../context.js';

/**
 * Fire one fire-and-forget run for `agentId` so its tile isn't blank. No-op
 * when the agent has already run (avoids redundant work when an agent is
 * re-added or shared across dashboards) and for community-shell agents that
 * require explicit audit confirmation (those must be run by hand).
 */
export function maybeKickoffFirstRun(ctx: DashboardContext, agentId: string): void {
  const agent = ctx.agentStore.getAgent(agentId);
  if (!agent || !agent.signal) return;
  if (ctx.runStore.listRuns({ agentName: agentId, limit: 1 }).length > 0) return;
  if (agent.source === 'community' && agent.nodes.some((n) => n.type === 'shell')) return;

  const abortController = new AbortController();
  executeAgentWithRetry(
    agent,
    { triggeredBy: 'dashboard', inputs: {}, signal: abortController.signal },
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
    },
  ).catch(() => {});
}
