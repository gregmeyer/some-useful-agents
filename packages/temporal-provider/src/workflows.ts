import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities.js';

const { runAgentActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 1, // Agent runs are not idempotent; don't auto-retry
  },
});

export interface RunAgentWorkflowInput {
  agent: activities.RunAgentActivityInput['agent'];
  secretsPath: string;
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
  });
}
