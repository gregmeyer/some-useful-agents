import type { AddMessageInput, InboxStore, Run } from '@some-useful-agents/core';
import { temporalWorkflowLink } from './temporal-link.js';

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
 *
 * The `/runs/<id>` dashboard page is ALWAYS the primary link — it works for
 * every failure. We only mention Temporal (and offer a Temporal UI deep link)
 * when the run actually reached a durable workflow, i.e. `run.temporalRunId` is
 * set. A setup failure (gate rejected, worker never dispatched the workflow)
 * has `usedWorkflowProvider === 'temporal'` but NO `temporalRunId`, so sending
 * the operator to the Temporal UI to hunt for a `sua-node-…` workflow that was
 * never created is a dead end — for those we stop at the run page.
 */
export function buildRunFailureMessage(
  info: RunFailureInfo,
  dashboardBaseUrl?: string,
  namespace = 'default',
): AddMessageInput {
  const { run } = info;
  const runLink = dashboardBaseUrl ? `${dashboardBaseUrl.replace(/\/$/, '')}/runs/${run.id}` : `/runs/${run.id}`;
  // A real durable workflow exists only when we persisted its execution runId.
  const temporalLink = run.temporalRunId ? temporalWorkflowLink(run, namespace) : undefined;
  const lines = [
    temporalLink
      ? `Agent **${run.agentName}** failed a run on the Temporal worker.`
      : `Agent **${run.agentName}** failed a run.`,
    '',
    `- Run: [${run.id.slice(0, 8)}](${runLink})`,
    ...(info.failedNodeId ? [`- Failed node: \`${info.failedNodeId}\`${info.errorCategory ? ` (${info.errorCategory})` : ''}`] : []),
    ...(run.error ? [`- Error: ${run.error}`] : []),
    '',
    temporalLink
      ? `Open the [run page](${runLink}) for details, or [view the workflow in the Temporal UI](${temporalLink}).`
      : `Open the [run page](${runLink}) for details.`,
  ];
  return {
    priority: 'high',
    source: 'run-failure',
    title: temporalLink ? `Temporal run failed: ${run.agentName}` : `Run failed: ${run.agentName}`,
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
  namespace = 'default',
): void {
  if (!inboxStore) return;
  if (info.run.usedWorkflowProvider !== 'temporal') return;
  try {
    inboxStore.add(buildRunFailureMessage(info, dashboardBaseUrl, namespace));
  } catch {
    // Inbox creation is best-effort; never let it bubble into the run path.
  }
}
