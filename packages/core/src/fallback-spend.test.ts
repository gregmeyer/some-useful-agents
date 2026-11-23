import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnNodeReal } from './node-spawner.js';
import { isPaidProvider } from './fallback-spend.js';
import { RunStore } from './run-store.js';
import type { AgentNode } from './agent-v2-types.js';

// "free" answers without the block the node needs (the next provider is tried); "paid" answers properly and has a price.
let server: Server;
let base: string;
let paidCalls = 0;
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const paid = req.url?.startsWith('/paid');
      if (paid) paidCalls += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: paid ? '<answer>42</answer>' : 'meh' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

const node: AgentNode = { id: 'ask', type: 'llm-prompt', prompt: 'What is 6 x 7?', outputContract: { mustMatch: '<answer>' } };
const settings = (providers: string[]) => ({
  providers,
  customProviders: [
    { name: 'free', kind: 'openai' as const, apiBase: `${base}/free/v1`, model: 'f' },
    { name: 'paid', kind: 'openai' as const, apiBase: `${base}/paid/v1`, model: 'p' },
  ],
  pricing: { paid: { inputPerMTok: 10, outputPerMTok: 100 } },
});

describe('the daily cap on fallback spend', () => {
  it("stops before a paid fallback once today's cap is spent, and says why", async () => {
    paidCalls = 0;
    const res = await spawnNodeReal(node, {}, { agentId: 'a', agentSource: 'local', llmSettings: settings(['free', 'paid']), fallbackCap: { capUsd: 5, spentUsd: 5 } });
    expect(res.exitCode).not.toBe(0);
    expect(res.category).toBe('budget_exhausted');
    expect(res.error).toContain("Stopped before falling back to paid: today's spend on fallbacks ($5.00) reached the daily cap of $5.00. Raise the cap in Settings → LLM, or run it again once free is answering.");
    expect(paidCalls).toBe(0);
  });

  it('falls back as before while the cap has room', async () => {
    paidCalls = 0;
    const res = await spawnNodeReal(node, {}, { agentId: 'a', agentSource: 'local', llmSettings: settings(['free', 'paid']), fallbackCap: { capUsd: 5, spentUsd: 1 } });
    expect(res.exitCode).toBe(0);
    expect(res.usedLLMProvider).toBe('paid');
    expect(paidCalls).toBe(1);
  });

  it('never holds back a paid provider that is the first choice', async () => {
    const res = await spawnNodeReal(node, {}, { agentId: 'a', agentSource: 'local', llmSettings: settings(['paid', 'free']), fallbackCap: { capUsd: 5, spentUsd: 50 } });
    expect(res.exitCode).toBe(0);
    expect(res.usedLLMProvider).toBe('paid');
  });
});

describe('isPaidProvider', () => {
  it('is Claude, or a provider with a price set', () => {
    expect(isPaidProvider('claude')).toBe(true);
    expect(isPaidProvider('codex')).toBe(false);
    expect(isPaidProvider('codex', { 'codex/gpt-6-sol': { inputPerMTok: 1, outputPerMTok: 2 } })).toBe(true);
    expect(isPaidProvider('local', { codex: { inputPerMTok: 1, outputPerMTok: 2 } })).toBe(false);
  });
});

describe('RunStore.fallbackSpendSince', () => {
  it('sums the cost of nodes that reached a later provider, since a time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sua-fallback-'));
    const store = new RunStore(join(dir, 'runs.db'));
    try {
      const now = new Date().toISOString();
      store.createRun({ id: 'r', agentName: 'a', status: 'completed', startedAt: now, triggeredBy: 'dashboard' });
      const add = (nodeId: string, cost: number, failures?: string, startedAt = now) => {
        store.createNodeExecution({ runId: 'r', nodeId, workflowVersion: 1, status: 'completed', startedAt });
        store.updateNodeExecution('r', nodeId, { providerFailures: failures, usage: { total: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: cost, costComplete: true }, attempts: [] } } as never);
      };
      add('first-choice', 2);
      add('fell-back', 3, JSON.stringify([{ provider: 'codex', category: 'quota_exceeded' }]));
      add('yesterday', 7, JSON.stringify([{ provider: 'codex', category: 'quota_exceeded' }]), '2020-01-01T00:00:00.000Z');
      expect(store.fallbackSpendSince('2026-01-01T00:00:00.000Z')).toBe(3);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
