/**
 * Agent detail page — barrel re-export.
 *
 * The implementation lives in `agent-detail/{shell,overview,nodes,config,runs,yaml}.ts`.
 * Routes import from here for backwards compatibility; new code can import
 * from the per-tab modules directly.
 */

export type { AgentTab, AgentDetailArgs } from './agent-detail/shell.js';
export { agentTabStrip } from './agent-detail/shell.js';
export { renderAgentOverview } from './agent-detail/overview.js';
export { renderAgentNodes } from './agent-detail/nodes.js';
export { renderAgentConfig } from './agent-detail/config.js';
export { renderAgentRuns } from './agent-detail/runs.js';
export { renderAgentYaml } from './agent-detail/yaml.js';

import type { Agent, Run, SecretsStore } from '@some-useful-agents/core';
import type { PageHeaderBack } from './page-header.js';
import { renderAgentOverview } from './agent-detail/overview.js';

/** @deprecated Use renderAgentOverview directly */
export async function renderAgentDetailV2(args: {
  agent: Agent;
  recentRuns: Run[];
  secretsStore: SecretsStore;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  back?: PageHeaderBack;
  from?: string;
}): Promise<string> {
  return renderAgentOverview({ ...args, activeTab: 'overview' });
}
