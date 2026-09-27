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

  it('names the provider when only one was tried, with no failure trail', () => {
    const html = renderRunDetail({
      run: baseRun,
      agent,
      nodeExecutions: [nodeExec({ usedLLMProvider: 'codex', attemptedProviders: 'codex' })],
    });
    expect(html).toContain('ran on <span class="mono">codex</span>');
    expect(html).not.toContain('failed</span>');
  });

  it('renders no provider chip on non-llm nodes', () => {
    const html = renderRunDetail({
      run: baseRun,
      agent,
      nodeExecutions: [nodeExec({ usedLLMProvider: undefined, attemptedProviders: undefined })],
    });
    expect(html).not.toContain('ran on');
  });
});

describe('run detail — recorded tool calls', () => {
  const calls = new Map([['triage', [
    { seq: 0, provider: 'claude', source: 'native' as const, toolId: 'WebFetch', argsJson: '{"url":"https://example.com"}', resultPreview: 'Example Domain', resultChars: 14, isError: false },
    { seq: 1, provider: 'local-qwen-8b', source: 'sua' as const, toolId: 'json-parse', argsJson: '{"text":"<b>"}', resultPreview: 'Invalid JSON', resultChars: 12, isError: true, durationMs: 1500 },
  ]]]);

  it('lists every recorded call with source, args, result and timing', () => {
    const html = renderRunDetail({ run: baseRun, agent, nodeExecutions: [nodeExec({})], toolCalls: calls });
    expect(html).toContain('tool calls (2, 1 failed)');
    expect(html).toContain('WebFetch');
    expect(html).toContain('>native<');
    expect(html).toContain('Example Domain');
    expect(html).toContain('1.5s');
    // escaped, not injected
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('"<b>"');
  });

  it('falls back to progress events for runs recorded before the trace existed', () => {
    const progressJson = JSON.stringify([{ type: 'tool_use', toolStatus: 'call', toolName: 'web_fetch', preview: '{}' }]);
    const html = renderRunDetail({ run: baseRun, agent, nodeExecutions: [nodeExec({ progressJson })] });
    expect(html).toContain('tool calls (1)');
    expect(html).toContain('web_fetch');
  });
});

describe('run detail — agents as tools', () => {
  const childId = '11111111-2222-3333-4444-555555555555';

  it('lists sub-runs and links an agent: call to the run it started', () => {
    const html = renderRunDetail({
      run: baseRun, agent, nodeExecutions: [nodeExec({})],
      childRuns: [{ id: childId, agentName: 'weather', status: 'completed', startedAt: new Date().toISOString(), triggeredBy: 'cli', parentRunId: baseRun.id, parentNodeId: 'triage' } as Run],
      toolCalls: new Map([['triage', [{ seq: 0, source: 'sua' as const, toolId: 'agent:weather', argsJson: '{"CITY":"Paris"}', resultPreview: `Agent "weather" run ${childId}: completed.\n\nSunny`, resultChars: 60, isError: false }]]]),
    });
    expect(html).toContain('sub-runs (1)');
    expect(html).toContain('from step triage');
    expect(html.match(new RegExp(`href="/runs/${childId}"`, 'g'))?.length).toBe(2);
    expect(html).toContain('Open the sub-run →');
  });

  it('shows "Called by" on a sub-run', () => {
    const html = renderRunDetail({ run: { ...baseRun, parentRunId: 'aaaaaaaa-0000-0000-0000-000000000000', parentNodeId: 'ask' }, agent, nodeExecutions: [nodeExec({})] });
    expect(html).toContain('<dt>Called by</dt>');
    expect(html).toContain('href="/runs/aaaaaaaa-0000-0000-0000-000000000000"');
    expect(html).toContain('(step ask)');
  });
});
