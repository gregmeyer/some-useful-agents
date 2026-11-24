import type { RunStatus, RunStore } from '@some-useful-agents/core';

/**
 * Record a run as cancelled when stopping it didn't (it finished between the
 * check and the stop, the dashboard restarted mid-run so nothing in memory
 * held it, or a shell node's own child process is still holding its output
 * open). Its node rows still `running` or `pending` are cancelled too, so
 * none is left on a spinner until the next boot's reaper finds it. No-op for
 * a run that isn't running.
 */
export function markRunCancelled(runStore: RunStore, id: string, message: string): boolean {
  const run = runStore.getRun(id);
  if (!run || run.status !== 'running') return false;
  const completedAt = new Date().toISOString();
  runStore.updateRun(id, { status: 'cancelled' as RunStatus, completedAt, error: message });
  for (const exec of runStore.listNodeExecutions(id)) {
    if (exec.status === 'running' || exec.status === 'pending') {
      runStore.updateNodeExecution(id, exec.nodeId, { status: 'cancelled', errorCategory: 'cancelled', completedAt, error: message });
    }
  }
  return true;
}
