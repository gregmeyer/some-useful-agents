import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { LlmSettingsStore } from './llm-settings-store.js';
import { executeAgentDag, type DagExecutorDeps } from './dag-executor.js';
import type { Agent } from './agent-v2-types.js';
import type { LlmUsage, NodeUsage } from './usage.js';

let dir: string;
let runStore: RunStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-run-usage-'));
  runStore = new RunStore(join(dir, 'runs.db'));
});
afterEach(() => {
  runStore.close();
  rmSync(dir, { recursive: true, force: true });
});

const attempt = (over: Partial<LlmUsage>): LlmUsage => ({
  provider: 'claude', inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0, costUsd: 0.1, costSource: 'reported', ...over,
});
const nodeUsage = (...attempts: LlmUsage[]): NodeUsage => {
  const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, costComplete: true };
  for (const a of attempts) {
    total.inputTokens += a.inputTokens; total.outputTokens += a.outputTokens; total.cacheReadTokens += a.cacheReadTokens;
    if (a.costUsd === undefined) total.costComplete = false; else total.costUsd += a.costUsd;
  }
  return { total, attempts };
};

const agent: Agent = {
  id: 'coster', name: 'Coster', status: 'active', source: 'local', mcp: false, version: 1,
  nodes: [
    { id: 'a', type: 'llm-prompt', prompt: 'one' },
    { id: 'b', type: 'llm-prompt', prompt: 'two', dependsOn: ['a'] },
    { id: 'c', type: 'shell', command: 'echo hi', dependsOn: ['b'] },
  ],
};

describe('run usage', () => {
  it('stores each node\'s usage and totals the run when it ends', async () => {
    const spawnNode: DagExecutorDeps['spawnNode'] = async (node) => ({
      result: 'ok', exitCode: 0,
      ...(node.id === 'a' ? { usage: nodeUsage(attempt({})) } : {}),
      ...(node.id === 'b' ? { usage: nodeUsage(attempt({ provider: 'codex', costUsd: undefined, costSource: 'unpriced' }), attempt({ costUsd: 0.05 })) } : {}),
    });
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, { runStore, spawnNode });
    const nodes = runStore.listNodeExecutions(run.id);
    expect(nodes.find((n) => n.nodeId === 'a')?.usage?.total.costUsd).toBe(0.1);
    expect(nodes.find((n) => n.nodeId === 'b')?.usage?.attempts.map((x) => x.provider)).toEqual(['codex', 'claude']);
    expect(nodes.find((n) => n.nodeId === 'c')?.usage).toBeUndefined();
    const stored = runStore.getRun(run.id)!;
    expect(stored.usage?.costUsd).toBeCloseTo(0.15);
    expect(stored.usage?.costComplete).toBe(false);
    expect(stored.usage?.inputTokens).toBe(30);
    expect(stored.usage?.cacheReadTokens).toBe(300);
  });

  it('includes child runs (agents called as tools) in the parent\'s total', () => {
    const now = new Date().toISOString();
    runStore.createRun({ id: 'parent', agentName: 'boss', status: 'running', startedAt: now, triggeredBy: 'cli' });
    runStore.createRun({ id: 'child', agentName: 'worker', status: 'running', startedAt: now, triggeredBy: 'cli', parentRunId: 'parent', parentNodeId: 'n' });
    runStore.createNodeExecution({ runId: 'child', nodeId: 'x', workflowVersion: 1, status: 'running', startedAt: now });
    runStore.updateNodeExecution('child', 'x', { status: 'completed', usage: nodeUsage(attempt({ costUsd: 0.2 })) });
    runStore.updateRun('child', { status: 'completed', completedAt: now });
    runStore.createNodeExecution({ runId: 'parent', nodeId: 'n', workflowVersion: 1, status: 'running', startedAt: now });
    runStore.updateNodeExecution('parent', 'n', { status: 'completed', usage: nodeUsage(attempt({ costUsd: 0.3 })) });
    runStore.updateRun('parent', { status: 'completed', completedAt: now });
    expect(runStore.getRun('child')!.usage?.costUsd).toBeCloseTo(0.2);
    expect(runStore.getRun('parent')!.usage?.costUsd).toBeCloseTo(0.5);

    // The summary counts top-level runs by agent (no double counting), and
    // node attempts by provider.
    const s = runStore.usageSummary(new Date(Date.now() - 60_000).toISOString());
    expect(s.byAgent).toEqual([expect.objectContaining({ agent: 'boss', runs: 1 })]);
    expect(s.totalUsd).toBeCloseTo(0.5);
    expect(s.byProvider).toEqual([expect.objectContaining({ provider: 'claude', calls: 2 })]);
    expect(s.byProvider[0].costUsd).toBeCloseTo(0.5);
  });

  it('leaves usage empty for a run with no model calls', async () => {
    const run = await executeAgentDag({ ...agent, nodes: [{ id: 'c', type: 'shell', command: 'echo hi' }] }, { triggeredBy: 'cli' },
      { runStore, spawnNode: async () => ({ result: 'hi', exitCode: 0 }) });
    expect(runStore.getRun(run.id)!.usage).toBeUndefined();
  });
});

describe('LlmSettingsStore.setPrice', () => {
  it('sets, validates and clears prices', () => {
    const store = new LlmSettingsStore(join(dir, 'llm.json'));
    store.setPrice('codex', { inputPerMTok: 1.25, outputPerMTok: 10 });
    store.setPrice('codex/gpt-5.5', { inputPerMTok: 2, outputPerMTok: 20, cacheReadPerMTok: 0.2 });
    expect(store.get().pricing).toEqual({
      codex: { inputPerMTok: 1.25, outputPerMTok: 10 },
      'codex/gpt-5.5': { inputPerMTok: 2, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
    });
    expect(() => store.setPrice('codex', { inputPerMTok: -1, outputPerMTok: 1 })).toThrow(/non-negative/);
    expect(() => store.setPrice('codex', { inputPerMTok: NaN, outputPerMTok: 1 })).toThrow(/non-negative/);
    expect(() => store.setPrice('  ', { inputPerMTok: 1, outputPerMTok: 1 })).toThrow(/provider/);
    store.setPrice('codex', null);
    store.setPrice('codex/gpt-5.5', null);
    expect(store.get().pricing).toBeUndefined();
  });
});
