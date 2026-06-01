import { proxyActivities, ActivityCancellationType } from '@temporalio/workflow';
import type * as activities from './activities.js';
import type { RunNodeActivityInput } from './activities.js';
import type { SpawnResult } from '@some-useful-agents/core';

const { runAgentActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 1, // Agent runs are not idempotent; don't auto-retry
  },
});

// Node activities heartbeat (for cancellation + liveness), so they get a
// heartbeatTimeout and wait for cancellation to complete (the worker SIGTERMs
// the child and unwinds) before the workflow resolves cancelled. No auto-retry:
// a node spawn is not idempotent.
const { runNodeActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 hour',
  heartbeatTimeout: '30 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    maximumAttempts: 1,
  },
});

export interface RunAgentWorkflowInput {
  agent: activities.RunAgentActivityInput['agent'];
  secretsPath: string;
  /**
   * Names of community shell agents the submitter has explicitly allowed.
   * Propagated to the activity; the executor refuses community shell by
   * default. Using string[] rather than Set<string> so the payload is
   * serializable by Temporal's data converter.
   */
  allowUntrustedShell?: string[];
  /**
   * Caller-supplied input values. Validated inside the activity against
   * the agent's `inputs:` declarations.
   */
  inputs?: Record<string, string>;
}

export interface RunAgentWorkflowResult {
  result: string;
  exitCode: number;
  error?: string;
  warnings: string[];
}

/**
 * One-shot workflow: runs a single agent via activity.
 * Kept simple — Temporal's value here is durability and scheduling, not
 * multi-step orchestration (chaining lives in the core chain-executor).
 */
export async function runAgentWorkflow(input: RunAgentWorkflowInput): Promise<RunAgentWorkflowResult> {
  return runAgentActivity({
    agent: input.agent,
    secretsPath: input.secretsPath,
    allowUntrustedShell: input.allowUntrustedShell,
    inputs: input.inputs,
  });
}

/**
 * One-shot workflow wrapping a single v2 DAG node (B1b). Temporal clients can
 * only start workflows, not activities, so each offloaded node runs as its own
 * `sua-node-…` workflow. The dashboard still orchestrates the DAG; this just
 * hosts one node's activity so it executes on the worker, is cancellable, and
 * shows up in the Temporal UI. B2 collapses these into one workflow per run.
 */
export async function runNodeWorkflow(input: RunNodeActivityInput): Promise<SpawnResult> {
  return runNodeActivity(input);
}
