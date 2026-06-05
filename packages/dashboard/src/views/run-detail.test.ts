import { describe, it, expect } from 'vitest';
import type { Agent, NodeExecutionRecord, Run } from '@some-useful-agents/core';
import { renderRunDetail } from './run-detail.js';

// Minimal v2 agent so renderRunDetail treats the run as a DAG and renders the
// per-node cards (gated on run.workflowId && nodeExecutions && agent).
const agent = {
  id: 'inbox-triage', name: 'Inbox Triage', status: 'active', source: 'examples',
  version: 1,
  nodes: [{ id: 'triage', type: 'llm-prompt', prompt: 'x' }],
} as unknown as Agent;

const baseRun: Run = {
  id: 'run-1',
  agentName: 'inbox-triage',
  status: 'completed',
  startedAt: new Date().toISOString(),
  triggeredBy: 'dashboard',
  workflowId: 'inbox-triage',
  workflowVersion: 1,
};

function nodeExec(extra: Partial<NodeExecutionRecord>): NodeExecutionRecord {
  return {
    runId: 'run-1', nodeId: 'triage', workflowVersion: 1,
    status: 'completed', startedAt: new Date().toISOString(), exitCode: 0,
    ...extra,
  };
}

describe('renderRunDetail — LLM waterfall chip', () => {
  it('shows the failed provider WITH its reason when providerFailures is present', () => {
    const html = renderRunDetail({
      run: baseRun,
      agent,
      nodeExecutions: [nodeExec({
        usedLLMProvider: 'apple-foundation-models',
        attemptedProviders: 'codex,apple-foundation-models',
        providerFailures: JSON.stringify([{ provider: 'codex', category: 'timeout', error: 'hard cap' }]),
      })],
    });
    expect(html).toContain('ran on');
    expect(html).toContain('apple-foundation-models');
    // The reason is shown inline next to the failed provider.
    expect(html).toContain('codex (timeout)');
    // The error snippet rides along in the hover title.
    expect(html).toContain('codex: timeout — hard cap');
  });

  it('falls back to the bare provider name when no providerFailures stored', () => {
    const html = renderRunDetail({
      run: baseRun,
      agent,
      nodeExecutions: [nodeExec({
        usedLLMProvider: 'apple-foundation-models',
        attemptedProviders: 'codex,apple-foundation-models',
      })],
    });
    expect(html).toContain('ran on');
    expect(html).toContain('codex');
    expect(html).not.toContain('codex (');
  });

  it('renders no waterfall chip when only one provider was tried', () => {
    const html = renderRunDetail({
      run: baseRun,
      agent,
      nodeExecutions: [nodeExec({ usedLLMProvider: 'codex', attemptedProviders: 'codex' })],
    });
    expect(html).not.toContain('failed</span>');
  });
});
