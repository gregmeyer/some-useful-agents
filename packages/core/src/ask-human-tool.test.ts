import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { InboxStore } from './inbox-store.js';
import { executeAgentDag, type DagExecutorDeps } from './dag-executor.js';
import { HumanQuestionStore, MAX_QUESTIONS_PER_NODE } from './human-questions.js';
import { getBuiltinTool } from './builtin-tools.js';
import { spawnNodeReal } from './node-spawner.js';
import type { Agent } from './agent-v2-types.js';
import type { BuiltinToolContext } from './tool-types.js';

let dir: string;
let runStore: RunStore;
let questions: HumanQuestionStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-ask-tool-'));
  runStore = new RunStore(join(dir, 'runs.db'));
  questions = HumanQuestionStore.fromHandle(runStore.databaseHandle());
});
afterEach(() => {
  runStore.close();
  rmSync(dir, { recursive: true, force: true });
});

const tool = getBuiltinTool('ask-human')!;

describe('ask-human tool', () => {
  const ctx = (over: Partial<NonNullable<BuiltinToolContext['askHuman']>> = {}, asked: string[] = []) => ({
    askHuman: { runId: 'r', nodeId: 'n', agentId: 'a', store: questions, onAsked: () => { asked.push('asked'); }, ...over },
  });

  it('records the question with its choices and ends the attempt', async () => {
    const asked: string[] = [];
    const out = await tool.execute({ question: 'Which region?', choices: 'EU | US |  | ' }, ctx({}, asked));
    expect(out.isError).toBeFalsy();
    expect(String(out.result)).toMatch(/Stop here/);
    expect(asked).toEqual(['asked']);
    expect(questions.forNode('r', 'n')).toMatchObject({ question: 'Which region?', choices: ['EU', 'US'], status: 'pending' });
  });

  it('refuses when unavailable, empty, or over the per-step limit', async () => {
    expect((await tool.execute({ question: 'x' }, {})).isError).toBe(true);
    expect(String((await tool.execute({ question: 'x' }, ctx({ unavailable: 'nope here' }))).result)).toBe('nope here');
    expect((await tool.execute({ question: '  ' }, ctx())).isError).toBe(true);
    for (let i = 0; i < MAX_QUESTIONS_PER_NODE; i++) {
      const q = questions.ask({ runId: 'r', nodeId: 'n', agentId: 'a', question: `q${i}` });
      questions.answer(q.id, 'ok');
    }
    const over = await tool.execute({ question: 'one more' }, ctx());
    expect(over.isError).toBe(true);
    expect(String(over.result)).toMatch(/already asked 3 questions/);
  });
});

describe('an llm node that asks', () => {
  const agent: Agent = {
    id: 'planner', name: 'Planner', status: 'active', source: 'local', mcp: false, version: 1,
    nodes: [
      { id: 'plan', type: 'llm-prompt', prompt: 'Plan the offsite.', tools: ['ask-human'] },
      { id: 'after', type: 'shell', command: 'echo done', dependsOn: ['plan'] },
    ],
  };

  it('waits after asking, then re-runs with the question and answer up front', async () => {
    const preambles: Array<string | undefined> = [];
    const spawnNode: DagExecutorDeps['spawnNode'] = async (node, _env, opts, _p, signal) => {
      if (node.id !== 'plan') return { result: 'done', exitCode: 0 };
      const o = opts as { askHuman?: BuiltinToolContext['askHuman']; behaviorPreamble?: string };
      preambles.push(o.behaviorPreamble);
      if (!o.behaviorPreamble?.includes('YOU ALREADY ASKED')) {
        await tool.execute({ question: 'What is the budget?', choices: '$5k | $10k' }, { askHuman: o.askHuman });
        expect(signal?.aborted).toBe(true);
        return { result: '', exitCode: 1, category: 'cancelled', error: 'aborted',
          usage: { total: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, costComplete: true }, attempts: [] } };
      }
      return { result: 'Plan within $10k.', exitCode: 0 };
    };
    const first = await executeAgentDag(agent, { triggeredBy: 'dashboard' }, { runStore, spawnNode });
    expect(first.status).toBe('waiting');
    const plan = runStore.listNodeExecutions(first.id).find((n) => n.nodeId === 'plan')!;
    expect(plan).toMatchObject({ status: 'waiting', result: 'What is the budget?' });
    expect(plan.usage?.total.costUsd).toBe(0.01);
    const q = questions.pendingForRun(first.id)!;
    expect(InboxStore.fromHandle(runStore.databaseHandle()).get(q.inboxMessageId!)?.source).toBe('question');

    questions.answer(q.id, '$10k');
    const done = await executeAgentDag(agent, { triggeredBy: 'dashboard', runId: first.id, resume: true }, { runStore, spawnNode });
    expect(done.status).toBe('completed');
    expect(preambles[1]).toContain('Q: What is the budget?\nA: $10k');
    expect(runStore.listNodeExecutions(done.id).map((n) => `${n.nodeId}:${n.status}`)).toEqual(['plan:completed', 'after:completed']);
  });

  it('fails the node without running it when the question expired', async () => {
    let spawned = 0;
    const spawnNode: DagExecutorDeps['spawnNode'] = async (_n, _e, opts) => {
      spawned += 1;
      await tool.execute({ question: 'Budget?' }, { askHuman: (opts as { askHuman?: BuiltinToolContext['askHuman'] }).askHuman });
      return { result: '', exitCode: 1 };
    };
    const first = await executeAgentDag(agent, { triggeredBy: 'cli' }, { runStore, spawnNode });
    questions.closeQuestion(questions.pendingForRun(first.id)!.id, 'expired');
    const run = await executeAgentDag(agent, { triggeredBy: 'cli', runId: first.id, resume: true }, { runStore, spawnNode });
    expect(spawned).toBe(1);
    expect(run.status).toBe('failed');
    expect(runStore.listNodeExecutions(run.id).find((n) => n.nodeId === 'plan')).toMatchObject({ status: 'failed', errorCategory: 'timeout' });
  });

  it('doesn\'t offer asking inside an agent another agent called', async () => {
    runStore.createRun({ id: 'parent', agentName: 'boss', status: 'running', startedAt: new Date().toISOString(), triggeredBy: 'cli' });
    let answer = '';
    await executeAgentDag(agent, { triggeredBy: 'cli', parentRunId: 'parent', parentNodeId: 'x' }, {
      runStore,
      spawnNode: async (node, _e, opts) => {
        if (node.id === 'plan') answer = String((await tool.execute({ question: 'q' }, { askHuman: (opts as { askHuman?: BuiltinToolContext['askHuman'] }).askHuman })).result);
        return { result: 'ok', exitCode: 0 };
      },
    });
    expect(answer).toMatch(/inside an agent that another agent called/);
  });
});

describe('the real waterfall', () => {
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
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'ask-human', arguments: '{"question":"Which city?","choices":"Paris | Rome"}' } },
        ] }, finish_reason: 'tool_calls' }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterEach(() => { server.close(); });

  it('stops the attempt when the model asks, and never tries the next provider', async () => {
    const ac = new AbortController();
    const res = await spawnNodeReal({ id: 'plan', type: 'llm-prompt', prompt: 'go', tools: ['ask-human'], maxTurns: 5 }, {}, {
      agentId: 'a', agentSource: 'local',
      askHuman: { runId: 'r', nodeId: 'plan', agentId: 'a', store: questions, onAsked: () => ac.abort() },
      llmSettings: {
        providers: ['one', 'two'],
        customProviders: [
          { name: 'one', kind: 'openai', apiBase: base, model: 'm' },
          { name: 'two', kind: 'openai', apiBase: base, model: 'm' },
        ],
      },
    }, undefined, ac.signal);
    expect(res.attemptedProviders).toEqual(['one']);
    expect(calls).toBe(1);
    expect(questions.forNode('r', 'plan')).toMatchObject({ question: 'Which city?', choices: ['Paris', 'Rome'], status: 'pending' });
  });
});

describe('one question at a time', () => {
  it('joins a second call in the same turn to the question already waiting', async () => {
    const asked: string[] = [];
    const ctx = { askHuman: { runId: 'r', nodeId: 'n', agentId: 'a', store: questions, onAsked: () => { asked.push('x'); } } };
    const first = await tool.execute({ question: 'Diet?' }, ctx);
    const second = await tool.execute({ question: 'Any allergies?' }, ctx);
    expect(second.questionId).toBe(first.questionId);
    expect(questions.listForNode('r', 'n')).toHaveLength(1);
    expect(asked).toHaveLength(2);
  });
});
