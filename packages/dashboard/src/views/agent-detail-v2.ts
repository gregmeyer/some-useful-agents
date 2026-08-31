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

import { renderAgentOverview } from './agent-detail/overview.js';
import type { AgentDetailArgs } from './agent-detail/shell.js';

/**
 * @deprecated Use renderAgentOverview directly.
 *
 * Derived from `AgentDetailArgs` rather than re-listing its fields: the
 * hand-copied version silently omitted every option added to the real type
 * since, so callers could not pass them through this wrapper at all.
 */
export async function renderAgentDetailV2(
  args: Omit<AgentDetailArgs, 'activeTab'>,
): Promise<string> {
  return renderAgentOverview({ ...args, activeTab: 'overview' });
}
