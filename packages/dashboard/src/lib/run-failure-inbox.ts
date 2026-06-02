import type { AddMessageInput, InboxStore, Run } from '@some-useful-agents/core';

export interface RunFailureInfo {
  run: Run;
  failedNodeId?: string;
  errorCategory?: string;
}

/**
 * Build the inbox message for a failed run. Pure + exported so it can be
 * unit-tested without a store. `dedupeKey` follows the documented
 * `run-failure:<runId>` convention so a run only ever opens one conversation,
 * even if the failure path fires more than once.
 */
export function buildRunFailureMessage(info: RunFailureInfo, dashboardBaseUrl?: string): AddMessageInput {
  const { run } = info;
  const runLink = dashboardBaseUrl ? `${dashboardBaseUrl.replace(/\/$/, '')}/runs/${run.id}` : `/runs/${run.id}`;
  const lines = [
    `Agent **${run.agentName}** failed a run on the Temporal worker.`,
    '',
    `- Run: [${run.id.slice(0, 8)}](${runLink})`,
    ...(info.failedNodeId ? [`- Failed node: \`${info.failedNodeId}\`${info.errorCategory ? ` (${info.errorCategory})` : ''}`] : []),
    ...(run.error ? [`- Error: ${run.error}`] : []),
    '',
    'This ran on a Temporal worker — open the run for details, or check the Temporal UI (the per-node workflow is named `sua-node-…`).',
  ];
  return {
    priority: 'high',
    source: 'run-failure',
    title: `Temporal run failed: ${run.agentName}`,
    body: lines.join('\n'),
    agentId: run.agentName,
    runId: run.id,
    dedupeKey: `run-failure:${run.id}`,
  };
}

/**
 * Raise (or no-op) an inbox conversation for a failed run. Scoped to runs that
 * executed on Temporal — local in-process failures are visible to whoever
 * triggered them, whereas a remote-worker failure would otherwise be silent.
 * Operator-cancelled runs never reach here (the executor only fires its failure
 * hook on `failed`, not `cancelled`).
 */
export function raiseRunFailureInbox(
  inboxStore: InboxStore | undefined,
  info: RunFailureInfo,
  dashboardBaseUrl?: string,
): void {
  if (!inboxStore) return;
  if (info.run.usedWorkflowProvider !== 'temporal') return;
  try {
    inboxStore.add(buildRunFailureMessage(info, dashboardBaseUrl));
  } catch {
    // Inbox creation is best-effort; never let it bubble into the run path.
  }
}
