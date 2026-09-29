import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { LlmSettingsStore } from './llm-settings-store.js';
import { executeAgentDag, type DagExecutorDeps } from './dag-executor.js';
import { claudeSpawner, spawnNodeReal, classifyLlmFailure, shouldFallback } from './node-spawner.js';
import { isRetryableCategory } from './retry.js';
import { effectiveSpendLimits, startOfLocalDay, unenforceableProviders, dailyLimitMessage, perRunLimitMessage } from './spend-limits.js';
import type { Agent, AgentNode } from './agent-v2-types.js';
import type { NodeUsage } from './usage.js';

let dir: string;
let runStore: RunStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-spend-'));
  runStore = new RunStore(join(dir, 'runs.db'));
});
afterEach(() => {
  runStore.close();
  rmSync(dir, { recursive: true, force: true });
});

const cost = (usd: number): NodeUsage => ({
  total: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: usd, costComplete: true },
  attempts: [{ provider: 'claude', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: usd, costSource: 'reported' }],
});

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: 'spender', name: 'Spender', status: 'active', source: 'local', mcp: false, version: 1,
  nodes: [
    { id: 'a', type: 'llm-prompt', prompt: 'one' },
    { id: 'b', type: 'llm-prompt', prompt: 'two', dependsOn: ['a'] },
  ],
  ...over,
});

function seedSpend(agentName: string, usd: number, startedAt = new Date().toISOString()): void {
  const id = `seed-${Math.random().toString(36).slice(2)}`;
  runStore.createRun({ id, agentName, status: 'running', startedAt, triggeredBy: 'cli' });
  runStore.createNodeExecution({ runId: id, nodeId: 'n', workflowVersion: 1, status: 'running', startedAt });
  runStore.updateNodeExecution(id, 'n', { status: 'completed', usage: cost(usd) });
  runStore.updateRun(id, { status: 'completed', completedAt: startedAt });
}

describe('effectiveSpendLimits', () => {
  it('takes the agent\'s own limits field by field, else the defaults', () => {
    expect(effectiveSpendLimits({ spendLimit: { perRunUsd: 1 } }, { perRunUsd: 5, perDayUsd: 20 })).toEqual({
      perRunUsd: 1, perDayUsd: 20, source: { perRunUsd: 'agent', perDayUsd: 'default' },
    });
    expect(effectiveSpendLimits({}, undefined)).toEqual({ source: {} });
  });

  it('starts the day at local midnight', () => {
    const d = new Date(startOfLocalDay(new Date(2026, 8, 28, 15, 30)));
    expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([0, 0, 28]);
  });

  it('names the providers whose runs can\'t count toward a USD limit', () => {
    expect(unenforceableProviders({
      providers: ['codex', 'claude', 'local-qwen', 'gateway', 'priced-gw', 'apple-foundation-models', 'off-gw'],
      disabledProviders: ['off-gw'],
      customProviders: [
        { name: 'local-qwen', apiBase: 'http://127.0.0.1:8181/v1' },
        { name: 'gateway', apiBase: 'https://gw.example.com/v1' },
        { name: 'priced-gw', apiBase: 'https://gw2.example.com/v1' },
        { name: 'off-gw', apiBase: 'https://gw3.example.com/v1' },
      ],
      pricing: { 'priced-gw/m': {} },
    })).toEqual(['codex', 'gateway']);
  });

  it('says what happened and what to change', () => {
    const limits = effectiveSpendLimits({}, { perDayUsd: 2, perRunUsd: 0.5 });
    expect(dailyLimitMessage('digest', 2.1, limits)).toMatch(/"digest" has spent \$2\.10 today, and its limit is \$2\.00 a day.*Settings → Usage/);
    expect(perRunLimitMessage(0.61, effectiveSpendLimits({ spendLimit: { perRunUsd: 0.5 } }, undefined))).toMatch(/spent \$0\.61.*\$0\.50 a run.*spendLimit\.perRunUsd on the agent/);
  });
});

describe('per-day limit', () => {
  it('refuses a run once the agent has spent its daily limit, and raises one failure', async () => {
    seedSpend('spender', 1.5);
    seedSpend('spender', 0.6);
    seedSpend('other', 9);
    seedSpend('spender', 50, new Date(Date.now() - 3 * 86_400_000).toISOString()); // an earlier day
    const failures: Array<{ errorCategory?: string; error?: string }> = [];
    let spawned = 0;
    const run = await executeAgentDag(agent({ spendLimit: { perDayUsd: 2 } }), { triggeredBy: 'schedule' }, {
      runStore,
      spawnNode: async () => { spawned += 1; return { result: 'ok', exitCode: 0 }; },
      onRunFailure: (info) => { failures.push(info); },
    });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/Daily spend limit reached: "spender" has spent \$2\.10 today/);
    expect(spawned).toBe(0);
    expect(runStore.listNodeExecutions(run.id)).toEqual([]);
    expect(failures).toEqual([expect.objectContaining({ errorCategory: 'budget_exhausted' })]);
  });

  it('lets the run go when under the limit, and takes the default from settings', async () => {
    seedSpend('spender', 0.5);
    const run = await executeAgentDag(agent(), { triggeredBy: 'cli' }, {
      runStore,
      llmSettings: { spendLimits: { perDayUsd: 2 } },
      spawnNode: async () => ({ result: 'ok', exitCode: 0 }),
    });
    expect(run.status).toBe('completed');
  });
});

describe('per-run limit', () => {
  it('passes what\'s left to each node and stops before the node after the limit is crossed', async () => {
    const budgets: Array<number | undefined> = [];
    const spawnNode: DagExecutorDeps['spawnNode'] = async (node, _env, opts) => {
      budgets.push((opts as { spendBudgetUsd?: number }).spendBudgetUsd);
      return { result: 'ok', exitCode: 0, usage: cost(node.id === 'a' ? 0.7 : 0.1) };
    };
    const run = await executeAgentDag(agent({
      spendLimit: { perRunUsd: 0.5 },
      nodes: [...agent().nodes, { id: 'c', type: 'shell', command: 'echo', dependsOn: ['b'] }],
    }), { triggeredBy: 'cli' }, { runStore, spawnNode });
    expect(budgets).toEqual([0.5]);
    const nodes = runStore.listNodeExecutions(run.id);
    expect(nodes.find((n) => n.nodeId === 'b')).toMatchObject({ status: 'failed', errorCategory: 'budget_exhausted' });
    expect(nodes.find((n) => n.nodeId === 'b')?.error).toMatch(/this run has spent \$0\.70, and its limit is \$0\.50 a run/);
    expect(nodes.find((n) => n.nodeId === 'c')).toMatchObject({ status: 'skipped', errorCategory: 'upstream_failed' });
    expect(run.status).toBe('failed');
    expect(runStore.getRun(run.id)!.usage?.costUsd).toBeCloseTo(0.7);
  });

  it('is never retried', () => {
    expect(isRetryableCategory('budget_exhausted', { categories: ['budget_exhausted'] })).toBe(false);
  });
});

describe('inside a node', () => {
  it('gives claude --max-budget-usd and reads its budget stop', () => {
    expect(claudeSpawner.buildArgs({ prompt: 'x', maxBudgetUsd: 0.123456 })).toEqual(expect.arrayContaining(['--max-budget-usd', '0.1235']));
    expect(claudeSpawner.buildArgs({ prompt: 'x' })).not.toContain('--max-budget-usd');
    expect(claudeSpawner.stoppedAtBudget!('{"type":"result","subtype":"error_max_budget_usd","is_error":true}')).toBe(true);
    expect(claudeSpawner.stoppedAtBudget!('{"type":"result","subtype":"success"}')).toBe(false);
  });

  it('never falls back to another provider on a spend-limit stop', () => {
    const cat = classifyLlmFailure({ result: '', exitCode: 1, category: 'budget_exhausted', error: 'limit exceeded' });
    expect(cat).toBe('budget_exhausted');
    expect(shouldFallback(cat)).toBe(false);
  });

  describe('OpenAI-compatible tool loop', () => {
    let server: Server;
    let base: string;
    let calls = 0;
    beforeEach(async () => {
      calls = 0;
      server = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          calls += 1;
          res.setHeader('content-type', 'application/json');
          // Always asks for another tool call: only the limit ends the loop.
          res.end(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'working', tool_calls: [{ id: `c${calls}`, type: 'function', function: { name: 'json-parse', arguments: '{"text":"[1]"}' } }] }, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 100_000, completion_tokens: 0 },
          }));
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    });
    afterEach(() => { server.close(); });

    it('stops between turns at the limit and doesn\'t try the next provider', async () => {
      const node: AgentNode = { id: 'loop', type: 'llm-prompt', prompt: 'go', tools: ['json-parse'], maxTurns: 10 };
      const res = await spawnNodeReal(node, {}, {
        agentId: 'a', agentSource: 'local',
        spendBudgetUsd: 0.25, // $1/MTok input × 100k tokens = $0.10 a turn
        llmSettings: {
          providers: ['gw', 'gw2'],
          customProviders: [
            { name: 'gw', kind: 'openai', apiBase: base, model: 'm' },
            { name: 'gw2', kind: 'openai', apiBase: base, model: 'm' },
          ],
          pricing: { gw: { inputPerMTok: 1, outputPerMTok: 1 }, gw2: { inputPerMTok: 1, outputPerMTok: 1 } },
        },
      });
      expect(res.category).toBe('budget_exhausted');
      expect(res.error).toMatch(/Stopped at the spend limit after 3 turns: \$0\.30 of the \$0\.25/);
      expect(res.attemptedProviders).toEqual(['gw']);
      expect(calls).toBe(3);
      expect(res.usage?.total.costUsd).toBeCloseTo(0.3);
    });
  });
});

describe('LlmSettingsStore.setSpendLimits', () => {
  it('saves, drops zeros, and rejects bad values', () => {
    const store = new LlmSettingsStore(join(dir, 'llm.json'));
    store.setSpendLimits({ perRunUsd: 0.5, perDayUsd: 0 });
    expect(store.get().spendLimits).toEqual({ perRunUsd: 0.5 });
    expect(() => store.setSpendLimits({ perDayUsd: -1 })).toThrow(/positive/);
    store.setSpendLimits({});
    expect(store.get().spendLimits).toBeUndefined();
  });
});
