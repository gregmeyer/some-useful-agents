import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { EncryptedFileStore, RunStore, LlmSettingsStore, AgentStore } from '@some-useful-agents/core';
import type { AgentDefinition, Agent } from '@some-useful-agents/core';
import type { AgentNode } from '@some-useful-agents/core';
import { runAgentActivity, runNodeActivity, runDagActivity, workerLlmSettings, workerAgentCalls } from './activities.js';

const TEST_DIR = join(import.meta.dirname, '__test-activities__');
const SECRETS_PATH = join(TEST_DIR, 'secrets.enc');

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function shellAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'test-agent',
    type: 'shell',
    command: 'echo hello-from-activity',
    source: 'local',
    ...overrides,
  };
}

describe('runAgentActivity', () => {
  it('runs a shell agent end-to-end', async () => {
    const result = await runAgentActivity({
      agent: shellAgent(),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(0);
    expect(result.result).toContain('hello-from-activity');
    expect(result.error).toBeUndefined();
  });

  it('captures non-zero exit codes', async () => {
    const result = await runAgentActivity({
      agent: shellAgent({ command: 'exit 42' }),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(42);
    expect(result.error).toBeTruthy();
  });

  it('injects secrets from store', async () => {
    const store = new EncryptedFileStore(SECRETS_PATH, { allowLegacyFallback: true, kdfParams: { N: 16384 } });
    await store.set('MY_SECRET_VAR', 'injected-value');

    const result = await runAgentActivity({
      agent: shellAgent({
        command: 'echo "got=$MY_SECRET_VAR"',
        secrets: ['MY_SECRET_VAR'],
      }),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(0);
    expect(result.result).toContain('got=injected-value');
  });

  it('fails with clear error when secret is missing', async () => {
    const result = await runAgentActivity({
      agent: shellAgent({ secrets: ['DOES_NOT_EXIST'] }),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('Missing secrets');
    expect(result.error).toContain('DOES_NOT_EXIST');
  });

  it('community agents do NOT inherit dangerous process.env vars', async () => {
    // Set a fake AWS-looking var in this test's env
    process.env.TEST_FAKE_AWS_SECRET = 'should-not-leak-to-community-agent';

    try {
      const result = await runAgentActivity({
        agent: shellAgent({
          name: 'audited-community-agent',
          source: 'community',
          command: 'echo "leak=$TEST_FAKE_AWS_SECRET"',
        }),
        secretsPath: SECRETS_PATH,
        // Explicit opt-in so the shell gate (v0.5.1) allows the run; the
        // assertion that follows is about env filtering, not the gate.
        allowUntrustedShell: ['audited-community-agent'],
      });

      expect(result.exitCode).toBe(0);
      // The var should NOT be present in the agent's env
      expect(result.result).toContain('leak=');
      expect(result.result).not.toContain('should-not-leak-to-community-agent');
    } finally {
      delete process.env.TEST_FAKE_AWS_SECRET;
    }
  });

  it('refuses community shell agents without allowUntrustedShell', async () => {
    const result = await runAgentActivity({
      agent: shellAgent({
        name: 'unaudited-community',
        source: 'community',
        command: 'echo should-not-run',
      }),
      secretsPath: SECRETS_PATH,
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/community shell agent/);
    expect(result.error).toMatch(/--allow-untrusted-shell/);
  });
});

const shellNode = (overrides: Partial<AgentNode> = {}): AgentNode => ({
  id: 'main',
  type: 'shell',
  command: 'echo node-from-activity',
  ...overrides,
});

describe('runNodeActivity', () => {
  it('runs a shell node and stamps usedWorkflowProvider=temporal', async () => {
    const result = await runNodeActivity({
      node: shellNode(),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      agentId: 'demo',
      agentSource: 'local',
      secretsPath: SECRETS_PATH,
      declaredSecrets: [],
    });

    expect(result.exitCode).toBe(0);
    expect(result.result).toContain('node-from-activity');
    expect(result.usedWorkflowProvider).toBe('temporal');
  });

  it('re-injects declared secrets from the worker-local store', async () => {
    const store = new EncryptedFileStore(SECRETS_PATH, { allowLegacyFallback: true, kdfParams: { N: 16384 } });
    await store.set('NODE_SECRET', 'node-injected');

    const result = await runNodeActivity({
      node: shellNode({ command: 'echo "got=$NODE_SECRET"', secrets: ['NODE_SECRET'] }),
      // The secret is NOT in env (the dashboard stripped it); the worker re-reads it.
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      agentId: 'demo',
      agentSource: 'local',
      secretsPath: SECRETS_PATH,
      declaredSecrets: ['NODE_SECRET'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.result).toContain('got=node-injected');
  });

  it('fails clearly when a declared secret is missing on the worker', async () => {
    const result = await runNodeActivity({
      node: shellNode({ secrets: ['ABSENT'] }),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      agentId: 'demo',
      agentSource: 'local',
      secretsPath: SECRETS_PATH,
      declaredSecrets: ['ABSENT'],
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('Missing secrets on worker');
    expect(result.error).toContain('ABSENT');
    expect(result.usedWorkflowProvider).toBe('temporal');
  });
});

const dagAgent = (nodes: AgentNode[]): Agent => ({
  id: 'dag-act', name: 'Dag', status: 'active', source: 'local', mcp: false, version: 1, nodes,
});

describe('runDagActivity', () => {
  const DB = join(TEST_DIR, 'runs.db');

  const twoNode = (): Agent => dagAgent([
    { id: 'a', type: 'shell', command: 'echo a > /dev/null' },
    { id: 'b', type: 'shell', command: 'echo b > /dev/null', dependsOn: ['a'] },
  ]);

  // Note: these assert on the activity's RETURN value. The full resume-on-crash
  // behavior is covered cross-process by the core resume tests (dag-executor)
  // and the live durability e2e — a second RunStore handle in THIS process won't
  // reliably see another handle's writes (node:sqlite WAL), which is a test-only
  // artifact, not how the worker (a separate process) reads the shared DB.

  it('runs a whole DAG on the worker and returns completed', async () => {
    const res = await runDagActivity({ agent: twoNode(), runId: 'r1', triggeredBy: 'dashboard', dbPath: DB, secretsPath: SECRETS_PATH });
    expect(res.status).toBe('completed');
  });

  it('gives llm nodes a chat turn\'s conversation block on the worker', async () => {
    let prompt = '';
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        prompt = (JSON.parse(body).messages as Array<{ content: string }>).map((m) => m.content).join('\n');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'the bus' }, finish_reason: 'stop' }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const settingsPath = join(TEST_DIR, 'llm-settings.json');
      new LlmSettingsStore(settingsPath).addCustomProvider({
        name: 'fake-local', kind: 'openai', apiBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: 'm',
      });
      const agent = dagAgent([{ id: 'answer', type: 'llm-prompt', prompt: 'Which is cheaper?' }]);
      const res = await runDagActivity({
        agent, runId: 'r-chat', triggeredBy: 'dashboard', dbPath: DB, secretsPath: SECRETS_PATH,
        llmProviders: ['fake-local'], llmSettingsPath: settingsPath,
        conversationPreamble: 'CONVERSATION SO FAR\nUser: rail or bus?\nYou: rail 40, bus 25\n',
      });
      expect(res.status).toBe('completed');
      expect(prompt).toContain('User: rail or bus?');
      expect(prompt.indexOf('rail 40, bus 25')).toBeLessThan(prompt.indexOf('Which is cheaper?'));
    } finally {
      server.close();
    }
  });

  it('returns failed (does NOT throw) when a node fails — a failed agent must not retry', async () => {
    const agent = dagAgent([{ id: 'boom', type: 'shell', command: 'exit 7' }]);
    const res = await runDagActivity({ agent, runId: 'r2', triggeredBy: 'dashboard', dbPath: DB, secretsPath: SECRETS_PATH });
    expect(res.status).toBe('failed');
  });
});

// Parity with a local run: the per-node path used to receive provider NAMES
// only, so a custom provider (e.g. a local model) fell through getSpawner's
// claude default and ran claude under the local model's name.
describe('worker LLM settings', () => {
  const settingsPath = () => join(TEST_DIR, 'llm-settings.json');
  const writeSettings = () => {
    const store = new LlmSettingsStore(settingsPath());
    store.addCustomProvider({ name: 'local-x', kind: 'openai', apiBase: 'http://127.0.0.1:1/v1', model: 'm', apiKey: 'sk-local' });
    store.setProviders(['codex', 'local-x', 'claude']);
    store.setProviderEnabled('codex', false);
  };

  it('keeps the caller\'s order and adds custom providers + the disabled list from the worker file', () => {
    writeSettings();
    const s = workerLlmSettings(['local-x', 'claude'], settingsPath());
    expect(s?.providers).toEqual(['local-x', 'claude']);
    expect(s?.customProviders?.map((c) => c.name)).toEqual(['local-x']);
    expect(s?.disabledProviders).toEqual(['codex']);
  });

  it('falls back to the worker file\'s chain minus disabled providers when no order was sent', () => {
    writeSettings();
    expect(workerLlmSettings(undefined, settingsPath())?.providers).toEqual(['local-x', 'claude']);
  });

  it('returns names-only when there is no settings file', () => {
    expect(workerLlmSettings(['claude'], undefined)).toEqual({ providers: ['claude'], customProviders: undefined, disabledProviders: undefined });
    expect(workerLlmSettings(undefined, undefined)).toBeUndefined();
  });

  const llmNode: AgentNode = { id: 'ask', type: 'llm-prompt', prompt: 'hi', timeout: 5 };

  it('dispatches a custom provider over HTTP on the worker instead of spawning claude', async () => {
    writeSettings();
    const res = await runNodeActivity({
      node: llmNode, env: {}, agentId: 'demo', agentSource: 'local',
      llmProviders: ['local-x'], secretsPath: SECRETS_PATH, declaredSecrets: [],
      llmSettingsPath: settingsPath(),
    });
    expect(res.attemptedProviders).toEqual(['local-x']);
    expect(res.error).toMatch(/Could not reach http:\/\/127\.0\.0\.1:1/);
  });

  it('returns the node\'s usage, priced from the worker\'s settings file', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' } }], usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const store = new LlmSettingsStore(settingsPath());
      store.addCustomProvider({ name: 'priced', kind: 'openai', apiBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: 'm' });
      store.setPrice('priced', { inputPerMTok: 3, outputPerMTok: 15 });
      const res = await runNodeActivity({
        node: llmNode, env: {}, agentId: 'demo', agentSource: 'local',
        llmProviders: ['priced'], secretsPath: SECRETS_PATH, declaredSecrets: [], llmSettingsPath: settingsPath(),
      });
      expect(res.exitCode).toBe(0);
      expect(res.usage?.total).toMatchObject({ inputTokens: 1_000_000, costUsd: 3, costComplete: true });
      expect(res.usage?.attempts[0].costSource).toBe('estimated');
    } finally {
      server.close();
    }
  });

  it('fails an unknown provider loudly rather than running claude under its name', async () => {
    const res = await runNodeActivity({
      node: llmNode, env: {}, agentId: 'demo', agentSource: 'local',
      llmProviders: ['local-x'], secretsPath: SECRETS_PATH, declaredSecrets: [],
    });
    expect(res.exitCode).not.toBe(0);
    expect(res.error).toContain('Provider "local-x" is not configured');
    expect(res.providerFailures?.[0]?.category).toBe('binary_missing');
  });
});

// A4: the worker enforces the same tool policy a local run does, loaded from
// the data dir next to the shared db (dirname(dbPath)).
describe('tool policy on the worker', () => {
  it('blocks a model tool call the policy denies, and the model sees why', async () => {
    let turn = 0;
    let secondTurnToolMessage = '';
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        turn += 1;
        if (turn === 2) {
          const msgs = JSON.parse(body).messages as Array<{ role: string; content: string }>;
          secondTurnToolMessage = msgs.find((m) => m.role === 'tool')?.content ?? '';
        }
        const message = turn === 1
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'json-parse', arguments: '{"text":"[1]"}' } }] }
          : { role: 'assistant', content: 'done' };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message, finish_reason: turn === 1 ? 'tool_calls' : 'stop' }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      const settingsPath = join(TEST_DIR, 'llm-settings.json');
      const store = new LlmSettingsStore(settingsPath);
      store.addCustomProvider({ name: 'fake-local', kind: 'openai', apiBase, model: 'm' });
      mkdirSync(join(TEST_DIR, '.sua'), { recursive: true });
      writeFileSync(join(TEST_DIR, '.sua', 'policies.json'), JSON.stringify({
        version: 1, rules: [{ tool: 'json-parse', effect: 'deny', reason: 'no parsing on the worker' }],
      }));

      const res = await runNodeActivity({
        node: { id: 'ask', type: 'llm-prompt', prompt: 'parse', tools: ['json-parse'], timeout: 10 },
        env: {}, agentId: 'demo', agentSource: 'local',
        llmProviders: ['fake-local'], secretsPath: SECRETS_PATH, declaredSecrets: [],
        llmSettingsPath: settingsPath, dbPath: join(TEST_DIR, 'runs.db'),
      });
      expect(res.exitCode).toBe(0);
      expect(secondTurnToolMessage).toBe('Blocked by policy: no parsing on the worker');
      expect(res.toolCalls?.[0]).toMatchObject({ toolId: 'json-parse', isError: true });
    } finally {
      server.close();
    }
  });
});

// C2: an agent called as a tool from a node on the worker runs as a sub-run
// on the worker, rebuilt from agentCallInfo + the shared db path.
describe('agents as tools on the worker', () => {
  it('rebuilds the call context and records the sub-run under the node\'s run', async () => {
    const dbPath = join(TEST_DIR, 'runs.db');
    const agents = new AgentStore(dbPath);
    agents.createAgent({
      id: 'child', name: 'Child', status: 'active', source: 'local', mcp: false,
      inputs: { TOPIC: { type: 'string', required: true } },
      nodes: [{ id: 'say', type: 'shell', command: 'echo "worker says $TOPIC"' }],
    }, 'cli');
    agents.createAgent({
      id: 'parent', name: 'Parent', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'ask', type: 'llm-prompt', prompt: 'x', tools: ['agent:child'] }],
    }, 'cli');

    const ctx = workerAgentCalls({
      node: { id: 'ask', type: 'llm-prompt', prompt: 'x', tools: ['agent:child'] },
      env: {}, agentId: 'parent', agentSource: 'local',
      secretsPath: SECRETS_PATH, declaredSecrets: [], dbPath,
      agentCallInfo: { runId: 'parent-run-1', nodeId: 'ask', depth: 0, stack: ['parent'], triggeredBy: 'dashboard' },
    });
    expect(ctx?.describe('child')?.id).toBe('agent:child');
    expect(ctx?.refusal('parent')).toContain('already running');

    const r = await ctx!.call('child', { TOPIC: 'hello' });
    expect(r.status).toBe('completed');
    expect(r.result).toContain('worker says hello');
    const sub = new RunStore(dbPath).getRun(r.runId)!;
    expect(sub).toMatchObject({ parentRunId: 'parent-run-1', parentNodeId: 'ask', triggeredBy: 'dashboard' });
  });

  it('is off when the node calls no agents or there is no db path', () => {
    const base = { node: { id: 'a', type: 'llm-prompt' as const, prompt: 'x' }, env: {}, agentId: 'p', agentSource: 'local' as const, secretsPath: SECRETS_PATH, declaredSecrets: [] };
    expect(workerAgentCalls(base)).toBeUndefined();
    expect(workerAgentCalls({ ...base, agentCallInfo: { runId: 'r', nodeId: 'a', depth: 0, stack: ['p'], triggeredBy: 'cli' } })).toBeUndefined();
  });
});
