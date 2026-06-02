import type { Run } from '@some-useful-agents/core';

/** Temporal Web UI base (the bundled docker-compose maps the UI here). */
export const TEMPORAL_UI_URL = 'http://localhost:8233';

/**
 * Deep link to a run's workflow in the Temporal Web UI, or undefined when the
 * run didn't execute on Temporal. The workflow id is `sua-run-<runId>` (durable
 * v2 runs + v1 single-node runs). B1b per-node runs (`sua-node-…`) have no single
 * run-level workflow; those are superseded by the durable per-run path.
 */
export function temporalWorkflowLink(
  run: Pick<Run, 'id' | 'usedWorkflowProvider'>,
  namespace = 'default',
): string | undefined {
  if (run.usedWorkflowProvider !== 'temporal') return undefined;
  const wf = encodeURIComponent(`sua-run-${run.id}`);
  return `${TEMPORAL_UI_URL}/namespaces/${encodeURIComponent(namespace)}/workflows/${wf}`;
}
