import type { Run } from '@some-useful-agents/core';

/** Temporal Web UI base (the bundled docker-compose maps the UI here). */
export const TEMPORAL_UI_URL = 'http://localhost:8233';

/**
 * Deep link to a run in the Temporal Web UI, or undefined when the run didn't
 * execute on Temporal.
 *
 * Two execution shapes:
 *  - DURABLE per-run (`submitDagRun`): one `sua-run-<runId>` workflow. We stored
 *    its execution runId (`run.temporalRunId`), so we link straight to that
 *    workflow's history page.
 *  - Per-node (`sua-node-…` workflows, one per node, random-suffixed ids that
 *    aren't persisted): there's no single run-level workflow to point at, so we
 *    land on the namespace's workflow LIST (a valid page where the operator can
 *    find the `sua-node-*` executions) rather than a 404ing `sua-run-<id>` guess.
 */
export function temporalWorkflowLink(
  run: Pick<Run, 'id' | 'usedWorkflowProvider' | 'temporalRunId'>,
  namespace = 'default',
): string | undefined {
  if (run.usedWorkflowProvider !== 'temporal') return undefined;
  const ns = encodeURIComponent(namespace);
  if (run.temporalRunId) {
    const wf = encodeURIComponent(`sua-run-${run.id}`);
    const rid = encodeURIComponent(run.temporalRunId);
    return `${TEMPORAL_UI_URL}/namespaces/${ns}/workflows/${wf}/${rid}/history`;
  }
  // Per-node temporal run: no single workflow id to target. Land on the list.
  return `${TEMPORAL_UI_URL}/namespaces/${ns}/workflows`;
}
