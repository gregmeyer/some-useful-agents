import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawnNodeReal, contractRepairNote } from './node-spawner.js';
import type { AgentNode } from './agent-v2-types.js';

// "repairable" misses the <answer> block unless the prompt says what was missing; "never" always misses it; "next" answers.
let server: Server;
let base: string;
const prompts: Record<string, string[]> = {};
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const who = (req.url ?? '').split('/')[1];
      const prompt = (JSON.parse(body).messages as Array<{ content: string }>).map((m) => m.content).join('\n');
      (prompts[who] ??= []).push(prompt);
      const told = prompt.includes('not in the required format');
      const content = who === 'next' || (who === 'repairable' && told) ? '<answer>42</answer>' : 'Forty-two.';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

const node: AgentNode = { id: 'ask', type: 'llm-prompt', prompt: 'What is 6 x 7? Reply as <answer>N</answer>.', outputContract: { mustMatch: '<answer>' } };
const settings = (providers: string[]) => ({
  providers,
  customProviders: ['repairable', 'never', 'next'].map((name) => ({ name, kind: 'openai' as const, apiBase: `${base}/${name}/v1`, model: 'm' })),
});

describe('an answer in the wrong shape is asked for once more on the same provider', () => {
  it('tells it what was missing, and keeps the node on that provider when it fixes it', async () => {
    delete prompts.repairable; delete prompts.next;
    const res = await spawnNodeReal(node, {}, { agentId: 'a', agentSource: 'local', llmSettings: settings(['repairable', 'next']) });
    expect(res.exitCode).toBe(0);
    expect(res.usedLLMProvider).toBe('repairable');
    expect(prompts.repairable).toHaveLength(2);
    expect(prompts.repairable[0]).not.toContain('not in the required format');
    expect(prompts.repairable[1]).toContain('Your previous answer to this was not in the required format');
    expect(prompts.next).toBeUndefined();
    expect(res.providerFailures).toEqual([expect.objectContaining({ provider: 'repairable', category: 'invalid_output' })]);
  });

  it('asks only once, then goes on to the next provider', async () => {
    delete prompts.never; delete prompts.next;
    const res = await spawnNodeReal(node, {}, { agentId: 'a', agentSource: 'local', llmSettings: settings(['never', 'next']) });
    expect(res.exitCode).toBe(0);
    expect(res.usedLLMProvider).toBe('next');
    expect(prompts.never).toHaveLength(2);
    expect(prompts.next).toHaveLength(1);
    expect(prompts.next[0]).not.toContain('not in the required format');
  });

  it('says what was missing', () => {
    expect(contractRepairNote('missing <answer>')).toBe('Your previous answer to this was not in the required format: missing <answer>. Answer again in full, in exactly the format the instructions above require.');
  });
});
