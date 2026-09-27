import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentToolDefinition, createAgentCallContext, MAX_AGENT_CALL_DEPTH, type AgentCallContextOptions } from './agent-tool.js';
import { AgentStore } from './agent-store.js';
import { RunStore } from './run-store.js';
import { executeAgentDag } from './dag-executor.js';
import type { Agent } from './agent-v2-types.js';

const agent = (id: string, extra: Partial<Agent> = {}): Agent => ({
  id, name: id.toUpperCase(), status: 'active', source: 'local', mcp: false, version: 1,
  nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }], ...extra,
});

describe('agentToolDefinition', () => {
  it('describes the agent, when to use it, and its inputs', () => {
    const def = agentToolDefinition(agent('weather', {
      description: 'Gets a forecast.',
      entryConditions: ['user wants a forecast'],
      sampleQuestions: ['Will it rain in Paris?'],
      inputs: {
        CITY: { type: 'string', required: true, description: 'City name.' },
        DAYS: { type: 'number', default: 3 },
        UNITS: { type: 'enum', values: ['c', 'f'], default: 'c' },
      },
    }));
    expect(def.id).toBe('agent:weather');
    expect(def.description).toContain('Runs the "WEATHER" agent');
    expect(def.description).toContain('Use when: user wants a forecast.');
    expect(def.description).toContain('Example asks: Will it rain in Paris?');
    expect(def.inputs.CITY).toEqual({ type: 'string', description: 'City name.', required: true });
    expect(def.inputs.DAYS).toMatchObject({ type: 'number', default: 3 });
    expect(def.inputs.DAYS.required).toBeUndefined();
    expect(def.inputs.UNITS.description).toBe('One of: c, f.');
  });
});

describe('createAgentCallContext guards', () => {
  const agents: Record<string, Agent> = {
    child: agent('child'),
    paused: agent('paused', { status: 'paused' }),
    parent: agent('parent'),
  };
  const base = (extra: Partial<AgentCallContextOptions> = {}): AgentCallContextOptions => ({
    caller: { id: 'parent' },
    getAgent: (id) => agents[id],
    stack: ['parent'],
    depth: 0,
    run: async () => ({ runId: 'r', status: 'completed', result: 'ok' }),
    ...extra,
  });

  it('offers an active agent', () => {
    expect(createAgentCallContext(base()).describe('child')?.id).toBe('agent:child');
  });

  it('refuses missing, inactive, cyclic, too-deep, and not-allowed callees — with a reason', () => {
    expect(createAgentCallContext(base()).refusal('nope')).toContain('does not exist');
    expect(createAgentCallContext(base()).refusal('paused')).toContain('is paused');
    expect(createAgentCallContext(base()).refusal('parent')).toContain('already running in this call chain (parent → parent)');
    expect(createAgentCallContext(base({ depth: MAX_AGENT_CALL_DEPTH })).refusal('child')).toContain(`limited to ${MAX_AGENT_CALL_DEPTH} levels`);
    expect(createAgentCallContext(base({ caller: { id: 'parent', allowedSubAgents: ['other'] } })).refusal('child')).toContain('may only call other');
    expect(createAgentCallContext(base()).describe('paused')).toBeUndefined();
  });

  it('calls one level deeper with the callee on the stack, inputs as strings', async () => {
    let seen: { inputs: Record<string, string>; depth: number; stack: string[] } | undefined;
    const ctx = createAgentCallContext(base({
      depth: 1, stack: ['root', 'parent'],
      run: async (_c, inputs, c) => { seen = { inputs, depth: c.depth, stack: c.stack }; return { runId: 'r1', status: 'completed', result: 'done' }; },
    }));
    await ctx.call('child', { CITY: 'Paris', DAYS: 3, FLAGS: ['a'], SKIP: undefined });
    expect(seen).toEqual({ inputs: { CITY: 'Paris', DAYS: '3', FLAGS: '["a"]' }, depth: 2, stack: ['root', 'parent', 'child'] });
  });

  it('refuses at call time too (the model could name an agent it was never offered)', async () => {
    await expect(createAgentCallContext(base()).call('parent', {})).rejects.toThrow(/already running/);
  });
});

// End to end: a model (fake OpenAI-compatible endpoint) calls another agent as
// a tool; the callee runs as a sub-run and its result comes back to the model.
describe('agents as tools through the executor', () => {
  let dir: string;
  let server: Server;
  let apiBase: string;
  let lastToolMessage = '';
  let requestedTool = 'agent_child';
  let finalText = 'The child said its piece.';

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-agent-tools-'));
    let turn = 0;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const msgs = JSON.parse(body).messages as Array<{ role: string; content: string }>;
        const tool = msgs.filter((m) => m.role === 'tool').pop();
        turn = tool ? 2 : 1;
        if (tool) lastToolMessage = tool.content;
        const message = turn === 1
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: requestedTool, arguments: '{"TOPIC":"otters"}' } }] }
          : { role: 'assistant', content: finalText };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message, finish_reason: turn === 1 ? 'tool_calls' : 'stop' }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  const setup = (name: string, parentExtra: Partial<Agent> = {}) => {
    const dbPath = join(dir, `${name}.db`);
    const agentStore = new AgentStore(dbPath);
    const runStore = new RunStore(dbPath);
    agentStore.createAgent({
      id: 'child', name: 'Child', status: 'active', source: 'local', mcp: false,
      description: 'Says something about a topic.',
      inputs: { TOPIC: { type: 'string', required: true } },
      nodes: [{ id: 'say', type: 'shell', command: 'echo "facts about $TOPIC"' }],
    }, 'cli');
    const parent: Agent = agent('parent', {
      nodes: [{ id: 'ask', type: 'llm-prompt', prompt: 'Ask the child about otters.', tools: ['agent:child'] }],
      ...parentExtra,
    });
    const deps = {
      runStore, agentStore, dataRoot: dir,
      llmSettings: { providers: ['fake'], customProviders: [{ name: 'fake', kind: 'openai' as const, apiBase, model: 'm' }] },
    };
    return { agentStore, runStore, parent, deps };
  };

  it('runs the called agent as a sub-run and returns its result to the model', async () => {
    requestedTool = 'agent_child';
    const { runStore, parent, deps } = setup('ok');
    const run = await executeAgentDag(parent, { triggeredBy: 'cli' }, deps);
    expect(run.status).toBe('completed');

    const [child] = runStore.listChildRuns(run.id);
    expect(child).toMatchObject({ agentName: 'child', status: 'completed', parentRunId: run.id, parentNodeId: 'ask' });
    expect(child.result).toContain('facts about otters');
    expect(lastToolMessage).toContain(`Agent "child" run ${child.id}: completed.`);
    expect(lastToolMessage).toContain('facts about otters');

    const trace = runStore.listToolCalls(run.id).get('ask');
    expect(trace?.[0]).toMatchObject({ toolId: 'agent:child', isError: false });
  });

  it('works from a goal step: the goal delegates to the agent and finishes with <final>', async () => {
    requestedTool = 'agent_child';
    finalText = 'Asked the child.\n<final>otters: facts gathered</final>';
    const { runStore, deps } = setup('goal');
    const goalParent = agent('parent', {
      nodes: [{ id: 'research', type: 'goal', goal: 'Learn about otters.', tools: ['agent:child'] }],
    });
    const run = await executeAgentDag(goalParent, { triggeredBy: 'cli' }, deps);
    finalText = 'The child said its piece.';
    expect(run.status).toBe('completed');
    expect(run.result).toBe('otters: facts gathered');
    expect(runStore.listChildRuns(run.id)).toEqual([expect.objectContaining({ agentName: 'child', parentNodeId: 'research', status: 'completed' })]);
  });

  it('applies tool policy to agent calls (agent:* rules)', async () => {
    requestedTool = 'agent_child';
    const { runStore, parent, deps } = setup('policy');
    const run = await executeAgentDag(parent, { triggeredBy: 'cli' }, {
      ...deps,
      policyDocument: { version: 1, defaultAction: 'allow', rules: [{ tool: 'agent:*', action: 'execute', resources: [], effect: 'deny', reason: 'no delegation today' }] },
    });
    expect(runStore.listChildRuns(run.id)).toHaveLength(0);
    expect(lastToolMessage).toBe('Blocked by policy: no delegation today');
  });

  it('does not offer an agent outside allowedSubAgents', async () => {
    const { runStore, parent, deps } = setup('allow', { allowedSubAgents: ['someone-else'] });
    const run = await executeAgentDag(parent, { triggeredBy: 'cli' }, deps);
    // Not offered: with no other tools the step runs as a plain prompt, so
    // nothing is called and no sub-run starts.
    expect(runStore.listChildRuns(run.id)).toHaveLength(0);
    expect(runStore.listToolCalls(run.id).size).toBe(0);
  });
});
