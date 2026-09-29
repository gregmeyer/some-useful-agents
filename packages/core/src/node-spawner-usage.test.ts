import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawnNodeReal } from './node-spawner.js';
import type { AgentNode } from './agent-v2-types.js';

// Two OpenAI-compatible endpoints on this machine. "weak" answers without the
// <answer> block the node requires (a fallback-worthy contract failure) after
// using tokens; "strong" answers properly. Usage must count both attempts.
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const weak = req.url?.startsWith('/weak');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: weak ? 'meh' : '<answer>42</answer>' }, finish_reason: 'stop' }],
        usage: weak ? { prompt_tokens: 1000, completion_tokens: 50 } : { prompt_tokens: 2000, completion_tokens: 100 },
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

const node: AgentNode = {
  id: 'ask', type: 'llm-prompt', prompt: 'What is 6 x 7?',
  outputContract: { mustMatch: '<answer>' },
};

describe('LLM usage across the provider waterfall', () => {
  it('records every attempt, prices them, and totals the node', async () => {
    const res = await spawnNodeReal(node, {}, {
      agentId: 'a', agentSource: 'local',
      llmSettings: {
        providers: ['weak', 'strong'],
        customProviders: [
          { name: 'weak', kind: 'openai', apiBase: `${base}/weak/v1`, model: 'w' },
          { name: 'strong', kind: 'openai', apiBase: `${base}/strong/v1`, model: 's' },
        ],
        // "weak" has a price; "strong" is local and unpriced, so it's free.
        pricing: { weak: { inputPerMTok: 10, outputPerMTok: 100 } },
      },
    });
    expect(res.exitCode).toBe(0);
    expect(res.usedLLMProvider).toBe('strong');
    expect(res.attemptUsage).toBeUndefined();
    expect(res.usage?.attempts).toEqual([
      expect.objectContaining({ provider: 'weak', model: 'w', inputTokens: 1000, outputTokens: 50, costSource: 'estimated', costUsd: 0.01 + 0.005 }),
      expect.objectContaining({ provider: 'strong', model: 's', inputTokens: 2000, outputTokens: 100, costSource: 'free', costUsd: 0 }),
    ]);
    expect(res.usage?.total).toEqual({
      inputTokens: 3000, outputTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.015, costComplete: true,
    });
  });
});
