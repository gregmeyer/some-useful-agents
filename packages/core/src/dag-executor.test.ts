import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { AgentStore } from './agent-store.js';
import { MemorySecretsStore } from './secrets-store.js';
import {
  executeAgentDag,
  topologicalSort,
  resolveUpstreamTemplate,
  type DagExecutorDeps,
} from './dag-executor.js';
import type { Agent, AgentNode, NodeErrorCategory } from './agent-v2-types.js';

// Keep PATH valid for shell nodes that test the real spawner; most tests
// inject a mock spawner and don't go near a real process.
const MIN_ENV_KEYS = ['PATH', 'HOME'];
for (const k of MIN_ENV_KEYS) {
  if (!process.env[k]) process.env[k] = k === 'PATH' ? '/usr/bin:/bin' : '/tmp';
}

let dir: string;
let runStore: RunStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-dag-exec-'));
  runStore = new RunStore(join(dir, 'runs.db'));
});

afterEach(() => {
  runStore.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-agent',
    name: 'Test',
    status: 'active',
    source: 'local',
    mcp: false,
    version: 1,
    nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
    ...overrides,
  };
}

/**
 * Canned spawner for deterministic tests. The `responses` map keys on
 * `node.id` and returns exit code + stdout + optional category. If a node
 * id isn't in the map, the spawner returns a default "completed 'ok'".
 */
function cannedSpawner(responses: Record<string, { exitCode: number; result?: string; error?: string; category?: NodeErrorCategory; delayMs?: number }>): DagExecutorDeps['spawnNode'] {
  return async (node) => {
    const r = responses[node.id] ?? { exitCode: 0, result: 'ok' };
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    return {
      result: r.result ?? '',
      exitCode: r.exitCode,
      error: r.error,
      category: r.category,
    };
  };
}

describe('topologicalSort', () => {
  it('orders declared-roots first, declared order as tiebreaker', () => {
    const nodes: AgentNode[] = [
      { id: 'b', type: 'shell', command: 'echo b' },
      { id: 'a', type: 'shell', command: 'echo a' },
      { id: 'c', type: 'shell', command: 'echo c', dependsOn: ['a', 'b'] },
    ];
    const order = topologicalSort(nodes);
    expect(order.map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('handles a diamond', () => {
    const nodes: AgentNode[] = [
      { id: 'top', type: 'shell', command: 'echo t' },
      { id: 'left', type: 'shell', command: 'echo l', dependsOn: ['top'] },
      { id: 'right', type: 'shell', command: 'echo r', dependsOn: ['top'] },
      { id: 'bottom', type: 'shell', command: 'echo b', dependsOn: ['left', 'right'] },
    ];
    const order = topologicalSort(nodes).map((n) => n.id);
    expect(order[0]).toBe('top');
    expect(order[3]).toBe('bottom');
    expect(new Set(order.slice(1, 3))).toEqual(new Set(['left', 'right']));
  });

  it('throws on a cycle', () => {
    expect(() => topologicalSort([
      { id: 'a', type: 'shell', command: 'echo a', dependsOn: ['b'] },
      { id: 'b', type: 'shell', command: 'echo b', dependsOn: ['a'] },
    ])).toThrow(/cycle/i);
  });
});

describe('resolveUpstreamTemplate', () => {
  it('leaves non-templated text unchanged', () => {
    expect(resolveUpstreamTemplate('hello world', {})).toBe('hello world');
  });

  it('substitutes a single reference', () => {
    expect(resolveUpstreamTemplate('before {{upstream.a.result}} after', { a: 'X' })).toBe('before X after');
  });

  it('substitutes multiple references in one string', () => {
    expect(resolveUpstreamTemplate('{{upstream.a.result}} / {{upstream.b.result}}', { a: '1', b: '2' })).toBe('1 / 2');
  });

  it('empty snapshot value resolves to empty string', () => {
    expect(resolveUpstreamTemplate('[{{upstream.missing.result}}]', {})).toBe('[]');
  });

  it('escapes double-braces inside the substituted value so it cannot re-expand', () => {
    // If upstream produced "{{inputs.X}}" literally and downstream used
    // substituteInputs after, we don't want that to re-expand. The safe
    // form here is "{ {inputs.X}}" (with a space) — that's what the v1
    // chain-resolver does.
    const result = resolveUpstreamTemplate('cmd: {{upstream.a.result}}', { a: '{{inputs.X}}' });
    expect(result).toBe('cmd: { {inputs.X}}');
  });
});

describe('executeAgentDag — single node', () => {
  it('executes a single-node shell agent and writes one node_execution row', async () => {
    const agent = makeAgent();
    const run = await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      { runStore, spawnNode: cannedSpawner({ main: { exitCode: 0, result: 'hello' } }) },
    );

    expect(run.status).toBe('completed');
    expect(run.workflowId).toBe('test-agent');
    expect(run.workflowVersion).toBe(1);
    expect(run.result).toBe('hello');

    const nodeExecs = runStore.listNodeExecutions(run.id);
    expect(nodeExecs).toHaveLength(1);
    expect(nodeExecs[0].nodeId).toBe('main');
    expect(nodeExecs[0].status).toBe('completed');
    expect(nodeExecs[0].result).toBe('hello');
    expect(nodeExecs[0].errorCategory).toBeUndefined();
  });

  it('marks the run failed and the node with exit_nonzero on non-zero exit', async () => {
    const agent = makeAgent();
    const run = await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      { runStore, spawnNode: cannedSpawner({ main: { exitCode: 2, error: 'boom' } }) },
    );

    expect(run.status).toBe('failed');
    expect(run.error).toContain('main');
    expect(run.error).toContain('exit_nonzero');

    const [ne] = runStore.listNodeExecutions(run.id);
    expect(ne.status).toBe('failed');
    expect(ne.errorCategory).toBe('exit_nonzero');
    expect(ne.exitCode).toBe(2);
    expect(ne.error).toBe('boom');
  });

  it('maps exit 124 to timeout category', async () => {
    const run = await executeAgentDag(
      makeAgent(),
      { triggeredBy: 'cli' },
      { runStore, spawnNode: cannedSpawner({ main: { exitCode: 124, error: 'Timed out after 30s' } }) },
    );
    const [ne] = runStore.listNodeExecutions(run.id);
    expect(ne.errorCategory).toBe('timeout');
  });

  it('maps exit 127 to spawn_failure category', async () => {
    const run = await executeAgentDag(
      makeAgent(),
      { triggeredBy: 'cli' },
      { runStore, spawnNode: cannedSpawner({ main: { exitCode: 127, error: 'ENOENT' } }) },
    );
    const [ne] = runStore.listNodeExecutions(run.id);
    expect(ne.errorCategory).toBe('spawn_failure');
  });
});

describe('executeAgentDag — multi-node DAG', () => {
  const threeNodeAgent: Agent = {
    id: 'news', name: 'News', status: 'active', source: 'local', mcp: false, version: 1,
    nodes: [
      { id: 'fetch', type: 'shell', command: 'echo headlines' },
      { id: 'summarize', type: 'claude-code', prompt: 'Summarize {{upstream.fetch.result}}', dependsOn: ['fetch'] },
      { id: 'post', type: 'shell', command: 'echo $UPSTREAM_SUMMARIZE_RESULT', dependsOn: ['summarize'] },
    ],
  };

  it('runs all nodes in topological order', async () => {
    const run = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli' },
      {
        runStore,
        spawnNode: cannedSpawner({
          fetch: { exitCode: 0, result: 'headline-1\nheadline-2' },
          summarize: { exitCode: 0, result: 'news summary' },
          post: { exitCode: 0, result: 'posted' },
        }),
      },
    );
    expect(run.status).toBe('completed');
    expect(run.result).toBe('posted');

    const nodes = runStore.listNodeExecutions(run.id);
    expect(nodes.map((n) => n.nodeId)).toEqual(['fetch', 'summarize', 'post']);
    expect(nodes.every((n) => n.status === 'completed')).toBe(true);
  });

  it('persists the upstream output snapshot on the downstream node row', async () => {
    const run = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli' },
      {
        runStore,
        spawnNode: cannedSpawner({
          fetch: { exitCode: 0, result: 'headline-1\nheadline-2' },
          summarize: { exitCode: 0, result: 'news summary' },
          post: { exitCode: 0, result: 'posted' },
        }),
      },
    );
    expect(run.status).toBe('completed');
    // upstreamInputsJson captures what fetch produced and fed into summarize.
    // This is what makes replay-from-node possible in PR 4: a later run can
    // re-run summarize against the exact stored upstream snapshot without
    // needing to re-run fetch.
    const summarize = runStore.getNodeExecution(run.id, 'summarize');
    expect(summarize).not.toBeNull();
    const snapshot = JSON.parse(summarize!.upstreamInputsJson!);
    expect(snapshot).toEqual({ fetch: 'headline-1\nheadline-2' });
  });

  it('injects UPSTREAM_<NODEID>_RESULT env vars for shell nodes', async () => {
    let postEnv: Record<string, string> | undefined;
    await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli' },
      {
        runStore,
        spawnNode: async (node, env) => {
          if (node.id === 'post') postEnv = env;
          return { result: 'ok', exitCode: 0 };
        },
      },
    );
    expect(postEnv).toBeDefined();
    expect(postEnv!.UPSTREAM_FETCH_RESULT).toBeUndefined();      // post's dependsOn is summarize, not fetch
    expect(postEnv!.UPSTREAM_SUMMARIZE_RESULT).toBe('ok');
  });

  it('marks downstream nodes as skipped with upstream_failed when an upstream fails', async () => {
    const run = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli' },
      {
        runStore,
        spawnNode: cannedSpawner({
          fetch: { exitCode: 2, error: 'curl failed' },
        }),
      },
    );
    expect(run.status).toBe('failed');

    const nodes = runStore.listNodeExecutions(run.id);
    expect(nodes[0].status).toBe('failed');
    expect(nodes[0].errorCategory).toBe('exit_nonzero');
    expect(nodes[1].status).toBe('skipped');
    expect(nodes[1].errorCategory).toBe('upstream_failed');
    expect(nodes[1].error).toContain('fetch');
    expect(nodes[1].error).toContain('exit_nonzero');
    expect(nodes[2].status).toBe('skipped');
    expect(nodes[2].errorCategory).toBe('upstream_failed');
  });
});

describe('executeAgentDag — secrets', () => {
  it('injects node-declared secrets into env and redacts them in the log', async () => {
    const secrets = new MemorySecretsStore();
    await secrets.set('API_KEY', 'real-secret');

    const agent: Agent = makeAgent({
      nodes: [{ id: 'main', type: 'shell', command: 'echo $API_KEY', secrets: ['API_KEY'] }],
    });

    let receivedEnv: Record<string, string> | undefined;
    const run = await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      {
        runStore,
        secretsStore: secrets,
        spawnNode: async (_node, env) => { receivedEnv = env; return { result: '', exitCode: 0 }; },
      },
    );
    expect(run.status).toBe('completed');
    expect(receivedEnv!.API_KEY).toBe('real-secret');

    const [ne] = runStore.listNodeExecutions(run.id);
    const loggedInputs = JSON.parse(ne.inputsJson!);
    expect(loggedInputs.API_KEY).toBe('<redacted>');
  });

  it('fails with setup category when a declared secret is missing', async () => {
    const agent = makeAgent({
      nodes: [{ id: 'main', type: 'shell', command: 'echo $MISSING', secrets: ['MISSING'] }],
    });
    const run = await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      { runStore, secretsStore: new MemorySecretsStore(), spawnNode: cannedSpawner({}) },
    );
    expect(run.status).toBe('failed');
    const [ne] = runStore.listNodeExecutions(run.id);
    expect(ne.errorCategory).toBe('setup');
    expect(ne.error).toMatch(/missing secrets/i);
    expect(ne.error).toContain('MISSING');
  });

  it("fails setup if a node declares secrets but no store is provided", async () => {
    const agent = makeAgent({
      nodes: [{ id: 'main', type: 'shell', command: 'echo $X', secrets: ['X'] }],
    });
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, { runStore, spawnNode: cannedSpawner({}) });
    expect(run.status).toBe('failed');
    const [ne] = runStore.listNodeExecutions(run.id);
    expect(ne.errorCategory).toBe('setup');
  });
});

describe('executeAgentDag — inputs', () => {
  it('threads caller-supplied inputs into env', async () => {
    const agent: Agent = {
      id: 'weather', name: 'Weather', status: 'active', source: 'local', mcp: false, version: 1,
      inputs: { ZIP: { type: 'number', required: true } },
      nodes: [{ id: 'main', type: 'shell', command: 'echo $ZIP' }],
    };
    let env: Record<string, string> | undefined;
    const run = await executeAgentDag(
      agent,
      { triggeredBy: 'cli', inputs: { ZIP: '94110' } },
      { runStore, spawnNode: async (_n, e) => { env = e; return { result: '', exitCode: 0 }; } },
    );
    expect(run.status).toBe('completed');
    expect(env!.ZIP).toBe('94110');
  });

  it('applies agent-level input defaults when caller omits', async () => {
    const agent: Agent = {
      id: 'weather', name: 'Weather', status: 'active', source: 'local', mcp: false, version: 1,
      inputs: { STYLE: { type: 'string', default: 'haiku' } },
      nodes: [{ id: 'main', type: 'shell', command: 'echo $STYLE' }],
    };
    let env: Record<string, string> | undefined;
    await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      { runStore, spawnNode: async (_n, e) => { env = e; return { result: '', exitCode: 0 }; } },
    );
    expect(env!.STYLE).toBe('haiku');
  });

  it('fails with setup when a required input is missing at runtime', async () => {
    const agent: Agent = {
      id: 'weather', name: 'Weather', status: 'active', source: 'local', mcp: false, version: 1,
      inputs: { ZIP: { type: 'number', required: true } },
      nodes: [{ id: 'main', type: 'shell', command: 'echo $ZIP' }],
    };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, { runStore, spawnNode: cannedSpawner({}) });
    expect(run.status).toBe('failed');
    const [ne] = runStore.listNodeExecutions(run.id);
    expect(ne.errorCategory).toBe('setup');
    expect(ne.error).toContain('ZIP');
  });
});

describe('executeAgentDag — community shell gate', () => {
  it('refuses a community shell node without allow-listing the agent', async () => {
    const agent = makeAgent({
      source: 'community',
      nodes: [{ id: 'main', type: 'shell', command: 'echo from-the-internet' }],
    });
    const run = await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      { runStore, spawnNode: cannedSpawner({}) },
    );
    expect(run.status).toBe('failed');
    const [ne] = runStore.listNodeExecutions(run.id);
    expect(ne.errorCategory).toBe('setup');
    expect(ne.error).toMatch(/Refusing to run community shell/);
  });

  it('runs a community shell node when the agent is allow-listed', async () => {
    const agent = makeAgent({
      source: 'community',
      nodes: [{ id: 'main', type: 'shell', command: 'echo ok' }],
    });
    const run = await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      {
        runStore,
        allowUntrustedShell: new Set(['test-agent']),
        spawnNode: cannedSpawner({ main: { exitCode: 0, result: 'done' } }),
      },
    );
    expect(run.status).toBe('completed');
  });

  it('allows community claude-code nodes without the shell gate', async () => {
    const agent = makeAgent({
      source: 'community',
      nodes: [{ id: 'main', type: 'claude-code', prompt: 'say hello' }],
    });
    const run = await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      { runStore, spawnNode: cannedSpawner({ main: { exitCode: 0, result: 'hello' } }) },
    );
    expect(run.status).toBe('completed');
  });
});

describe('executeAgentDag — replay from node', () => {
  const threeNodeAgent: Agent = {
    id: 'pipeline', name: 'Pipeline', status: 'active', source: 'local', mcp: false, version: 1,
    nodes: [
      { id: 'fetch', type: 'shell', command: 'echo headlines' },
      { id: 'summarize', type: 'claude-code', prompt: 'Summarize {{upstream.fetch.result}}', dependsOn: ['fetch'] },
      { id: 'post', type: 'shell', command: 'echo posted', dependsOn: ['summarize'] },
    ],
  };

  it('replays from a middle node, reusing prior upstream output', async () => {
    // Original run: all three complete.
    const original = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli' },
      {
        runStore,
        spawnNode: cannedSpawner({
          fetch: { exitCode: 0, result: 'HEADLINES-ORIG' },
          summarize: { exitCode: 0, result: 'SUMMARY-ORIG' },
          post: { exitCode: 0, result: 'POSTED-ORIG' },
        }),
      },
    );
    expect(original.status).toBe('completed');

    // Replay from `summarize`. Fetch should NOT be re-spawned; summarize
    // and post should execute fresh.
    const spawned: string[] = [];
    const replay = await executeAgentDag(
      threeNodeAgent,
      {
        triggeredBy: 'cli',
        replayFrom: { priorRunId: original.id, fromNodeId: 'summarize' },
      },
      {
        runStore,
        spawnNode: async (node) => {
          spawned.push(node.id);
          return { result: `${node.id.toUpperCase()}-REPLAY`, exitCode: 0 };
        },
      },
    );
    expect(replay.status).toBe('completed');
    expect(replay.replayedFromRunId).toBe(original.id);
    expect(replay.replayedFromNodeId).toBe('summarize');
    expect(spawned).toEqual(['summarize', 'post']); // fetch NOT re-run

    // The replay's node_executions has three rows:
    //   - fetch: copied from original, result = 'HEADLINES-ORIG'
    //   - summarize: fresh, result = 'SUMMARIZE-REPLAY'
    //   - post: fresh, saw the REPLAY summarize output (not the original)
    const rows = runStore.listNodeExecutions(replay.id);
    const byId = new Map(rows.map((r) => [r.nodeId, r]));
    expect(byId.get('fetch')!.result).toBe('HEADLINES-ORIG');
    expect(byId.get('summarize')!.result).toBe('SUMMARIZE-REPLAY');
    expect(byId.get('post')!.result).toBe('POST-REPLAY');
  });

  it('feeds the copied upstream snapshot into the pivot node\'s env', async () => {
    const original = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli' },
      {
        runStore,
        spawnNode: cannedSpawner({
          fetch: { exitCode: 0, result: 'ORIGINAL-FETCH-OUTPUT' },
          summarize: { exitCode: 0, result: 'ok' },
          post: { exitCode: 0, result: 'ok' },
        }),
      },
    );

    let pivotEnv: Record<string, string> | undefined;
    await executeAgentDag(
      threeNodeAgent,
      {
        triggeredBy: 'cli',
        replayFrom: { priorRunId: original.id, fromNodeId: 'summarize' },
      },
      {
        runStore,
        spawnNode: async (node, env) => {
          if (node.id === 'summarize') pivotEnv = env;
          return { result: 'ok', exitCode: 0 };
        },
      },
    );
    // summarize should see fetch's ORIGINAL output in its upstream snapshot.
    expect(pivotEnv!.UPSTREAM_FETCH_RESULT).toBe('ORIGINAL-FETCH-OUTPUT');
  });

  it('refuses replay if pivot node is not in the agent', async () => {
    const original = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli' },
      { runStore, spawnNode: cannedSpawner({}) },
    );
    const replay = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli', replayFrom: { priorRunId: original.id, fromNodeId: 'phantom' } },
      { runStore, spawnNode: cannedSpawner({}) },
    );
    expect(replay.status).toBe('failed');
    expect(replay.error).toMatch(/not in agent/);
  });

  it('refuses replay if prior run is missing completed outputs for a node before the pivot', async () => {
    // Original run: fetch fails, summarize + post skipped.
    const original = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli' },
      { runStore, spawnNode: cannedSpawner({ fetch: { exitCode: 1, error: 'boom' } }) },
    );
    expect(original.status).toBe('failed');

    // Try to replay from post. There's no completed fetch output to reuse.
    const replay = await executeAgentDag(
      threeNodeAgent,
      { triggeredBy: 'cli', replayFrom: { priorRunId: original.id, fromNodeId: 'post' } },
      { runStore, spawnNode: cannedSpawner({}) },
    );
    expect(replay.status).toBe('failed');
    expect(replay.error).toMatch(/missing completed outputs/);
  });
});

describe('executeAgentDag — env allowlist by trust level', () => {
  it('community agents get MINIMAL_ALLOWLIST (no USER / NODE_ENV)', async () => {
    process.env.USER = 'testuser';
    process.env.NODE_ENV = 'test';
    try {
      const agent = makeAgent({ source: 'community', nodes: [{ id: 'main', type: 'claude-code', prompt: 'hi' }] });
      let env: Record<string, string> | undefined;
      await executeAgentDag(
        agent,
        { triggeredBy: 'cli' },
        { runStore, spawnNode: async (_n, e) => { env = e; return { result: '', exitCode: 0 }; } },
      );
      expect(env!.USER).toBeUndefined();
      expect(env!.NODE_ENV).toBeUndefined();
      expect(env!.PATH).toBeDefined(); // minimal allowlist keeps PATH
    } finally {
      // keep process.env clean for other tests
    }
  });

  it('local agents get LOCAL_ALLOWLIST (USER / NODE_ENV pass through)', async () => {
    process.env.USER = 'testuser';
    process.env.NODE_ENV = 'test';
    const agent = makeAgent({ source: 'local', nodes: [{ id: 'main', type: 'claude-code', prompt: 'hi' }] });
    let env: Record<string, string> | undefined;
    await executeAgentDag(
      agent,
      { triggeredBy: 'cli' },
      { runStore, spawnNode: async (_n, e) => { env = e; return { result: '', exitCode: 0 }; } },
    );
    expect(env!.USER).toBe('testuser');
    expect(env!.NODE_ENV).toBe('test');
  });
});

describe('executeAgentDag — onlyIf conditional edges', () => {
  it('skips a node when onlyIf.equals does not match', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'check', type: 'shell', command: 'echo check' },
        {
          id: 'process',
          type: 'shell',
          command: 'echo process',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'status', equals: 200 },
        },
      ],
    });
    const spawner = cannedSpawner({
      check: { exitCode: 0, result: '{"status": 404}' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    // Run should complete (condition_not_met is not a failure).
    expect(run.status).toBe('completed');

    const execs = runStore.listNodeExecutions(run.id);
    const processExec = execs.find((e) => e.nodeId === 'process');
    expect(processExec!.status).toBe('skipped');
    expect(processExec!.errorCategory).toBe('condition_not_met');
  });

  it('runs a node when onlyIf.equals matches', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'check', type: 'shell', command: 'echo check' },
        {
          id: 'process',
          type: 'shell',
          command: 'echo process',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'status', equals: 200 },
        },
      ],
    });
    const spawner = cannedSpawner({
      check: { exitCode: 0, result: '{"status": 200}' },
      process: { exitCode: 0, result: 'done' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    const processExec = execs.find((e) => e.nodeId === 'process');
    expect(processExec!.status).toBe('completed');
  });

  it('cascades condition_not_met to downstream nodes without their own onlyIf', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'check', type: 'shell', command: 'echo check' },
        {
          id: 'gated',
          type: 'shell',
          command: 'echo gated',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'ok', equals: true },
        },
        {
          id: 'after-gated',
          type: 'shell',
          command: 'echo after',
          dependsOn: ['gated'],
        },
      ],
    });
    const spawner = cannedSpawner({
      check: { exitCode: 0, result: '{"ok": false}' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'gated')!.errorCategory).toBe('condition_not_met');
    expect(execs.find((e) => e.nodeId === 'after-gated')!.errorCategory).toBe('condition_not_met');
  });

  it('supports onlyIf.notEquals', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'check', type: 'shell', command: 'echo check' },
        {
          id: 'fallback',
          type: 'shell',
          command: 'echo fallback',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'status', notEquals: 200 },
        },
      ],
    });
    const spawner = cannedSpawner({
      check: { exitCode: 0, result: '{"status": 500}' },
      fallback: { exitCode: 0, result: 'ran fallback' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'fallback')!.status).toBe('completed');
  });

  it('supports onlyIf.exists', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'check', type: 'shell', command: 'echo check' },
        {
          id: 'if-present',
          type: 'shell',
          command: 'echo exists',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'data', exists: true },
        },
      ],
    });
    const spawner = cannedSpawner({
      check: { exitCode: 0, result: '{"data": null}' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    // data is null → exists: true fails → skipped
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'if-present')!.errorCategory).toBe('condition_not_met');
  });

  it('conditional node evaluates predicate and outputs matched boolean', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'fetch', type: 'shell', command: 'echo hi' },
        {
          id: 'check',
          type: 'conditional' as any,
          dependsOn: ['fetch'],
          conditionalConfig: {
            predicate: { field: 'status', equals: 200 },
          },
        },
        {
          id: 'process',
          type: 'shell',
          command: 'echo ok',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'matched', equals: true },
        },
      ],
    });
    const spawner = cannedSpawner({
      fetch: { exitCode: 0, result: '{"status": 200}' },
      process: { exitCode: 0, result: 'processed' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    const checkExec = execs.find((e) => e.nodeId === 'check');
    expect(checkExec!.status).toBe('completed');
    const checkOutput = JSON.parse(checkExec!.result!);
    expect(checkOutput.matched).toBe(true);

    const processExec = execs.find((e) => e.nodeId === 'process');
    expect(processExec!.status).toBe('completed');
  });

  it('conditional node: unmatched predicate → downstream onlyIf skips', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'fetch', type: 'shell', command: 'echo hi' },
        {
          id: 'check',
          type: 'conditional' as any,
          dependsOn: ['fetch'],
          conditionalConfig: {
            predicate: { field: 'status', equals: 200 },
          },
        },
        {
          id: 'process',
          type: 'shell',
          command: 'echo ok',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'matched', equals: true },
        },
      ],
    });
    const spawner = cannedSpawner({
      fetch: { exitCode: 0, result: '{"status": 500}' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    const checkOutput = JSON.parse(execs.find((e) => e.nodeId === 'check')!.result!);
    expect(checkOutput.matched).toBe(false);
    expect(execs.find((e) => e.nodeId === 'process')!.errorCategory).toBe('condition_not_met');
  });

  it('switch node routes to the matching case', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'fetch', type: 'shell', command: 'echo hi' },
        {
          id: 'route',
          type: 'switch' as any,
          dependsOn: ['fetch'],
          switchConfig: {
            field: 'tier',
            cases: { free: 'free', pro: 'pro', enterprise: 'enterprise' },
          },
        },
        {
          id: 'handle-free',
          type: 'shell',
          command: 'echo free',
          dependsOn: ['route'],
          onlyIf: { upstream: 'route', field: 'case', equals: 'free' },
        },
        {
          id: 'handle-pro',
          type: 'shell',
          command: 'echo pro',
          dependsOn: ['route'],
          onlyIf: { upstream: 'route', field: 'case', equals: 'pro' },
        },
      ],
    });
    const spawner = cannedSpawner({
      fetch: { exitCode: 0, result: '{"tier": "pro"}' },
      'handle-pro': { exitCode: 0, result: 'handled pro' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'handle-free')!.errorCategory).toBe('condition_not_met');
    expect(execs.find((e) => e.nodeId === 'handle-pro')!.status).toBe('completed');
    const routeOutput = JSON.parse(execs.find((e) => e.nodeId === 'route')!.result!);
    expect(routeOutput.case).toBe('pro');
  });

  it('switch node defaults to "default" when no case matches', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'fetch', type: 'shell', command: 'echo hi' },
        {
          id: 'route',
          type: 'switch' as any,
          dependsOn: ['fetch'],
          switchConfig: { field: 'tier', cases: { free: 'free', pro: 'pro' } },
        },
      ],
    });
    const spawner = cannedSpawner({
      fetch: { exitCode: 0, result: '{"tier": "unknown"}' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    const routeOutput = JSON.parse(
      runStore.listNodeExecutions(run.id).find((e) => e.nodeId === 'route')!.result!,
    );
    expect(routeOutput.case).toBe('default');
  });

  it('if/else branching: one branch runs, the other skips', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'check', type: 'shell', command: 'echo check' },
        {
          id: 'on-success',
          type: 'shell',
          command: 'echo success',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'ok', equals: true },
        },
        {
          id: 'on-failure',
          type: 'shell',
          command: 'echo failure',
          dependsOn: ['check'],
          onlyIf: { upstream: 'check', field: 'ok', notEquals: true },
        },
      ],
    });
    const spawner = cannedSpawner({
      check: { exitCode: 0, result: '{"ok": true}' },
      'on-success': { exitCode: 0, result: 'ran success' },
      'on-failure': { exitCode: 0, result: 'ran failure' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'on-success')!.status).toBe('completed');
    expect(execs.find((e) => e.nodeId === 'on-failure')!.status).toBe('skipped');
    expect(execs.find((e) => e.nodeId === 'on-failure')!.errorCategory).toBe('condition_not_met');
  });
});

describe('executeAgentDag — agent-invoke (Flow PR C)', () => {
  let agentStore: AgentStore;

  beforeEach(() => {
    agentStore = new AgentStore(join(dir, 'runs.db'));
  });

  afterEach(() => {
    try { agentStore.close(); } catch { /* may share DB handle */ }
  });

  it('invokes a sub-agent and captures its result', async () => {
    // Create the sub-agent in the store.
    agentStore.createAgent(
      {
        id: 'sub-agent',
        name: 'Sub',
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [{ id: 'main', type: 'shell', command: 'echo sub-result' }],
      },
      'cli',
      'seed',
    );

    const parentAgent = makeAgent({
      nodes: [
        {
          id: 'delegate',
          type: 'agent-invoke' as any,
          agentInvokeConfig: { agentId: 'sub-agent' },
        },
      ],
    });

    // The sub-agent's shell node runs via the real spawner (not mocked),
    // so we don't pass spawnNode — this is a true integration test.
    const deps: DagExecutorDeps = { runStore, agentStore };
    const run = await executeAgentDag(parentAgent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');

    // Parent node should have the sub-agent's result.
    const execs = runStore.listNodeExecutions(run.id);
    const delegateExec = execs.find((e) => e.nodeId === 'delegate');
    expect(delegateExec!.status).toBe('completed');
    expect(delegateExec!.result).toContain('sub-result');

    // There should be a nested run with parent_run_id set.
    const allRuns = runStore.queryRuns({ limit: 10, offset: 0, statuses: [] });
    const subRun = allRuns.rows.find((r) => r.parentRunId === run.id);
    expect(subRun).toBeDefined();
    expect(subRun!.parentNodeId).toBe('delegate');
    expect(subRun!.agentName).toBe('sub-agent');
    expect(subRun!.status).toBe('completed');
  });

  it('fails the parent node when sub-agent is not found', async () => {
    const parentAgent = makeAgent({
      nodes: [
        {
          id: 'delegate',
          type: 'agent-invoke' as any,
          agentInvokeConfig: { agentId: 'nonexistent' },
        },
      ],
    });
    const deps: DagExecutorDeps = { runStore, agentStore };
    const run = await executeAgentDag(parentAgent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('failed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'delegate')!.errorCategory).toBe('setup');
    expect(execs.find((e) => e.nodeId === 'delegate')!.error).toContain('not found');
  });

  it('fails when agentStore is not provided', async () => {
    const parentAgent = makeAgent({
      nodes: [
        {
          id: 'delegate',
          type: 'agent-invoke' as any,
          agentInvokeConfig: { agentId: 'any' },
        },
      ],
    });
    const deps: DagExecutorDeps = { runStore };
    const run = await executeAgentDag(parentAgent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('failed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'delegate')!.error).toContain('agentStore');
  });

  it('chains parent → sub-agent → downstream node', async () => {
    agentStore.createAgent(
      {
        id: 'fetcher',
        name: 'Fetcher',
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [{ id: 'fetch', type: 'shell', command: 'echo fetched-data' }],
      },
      'cli',
      'seed',
    );

    const parentAgent = makeAgent({
      nodes: [
        {
          id: 'invoke-fetcher',
          type: 'agent-invoke' as any,
          agentInvokeConfig: { agentId: 'fetcher' },
        },
        {
          id: 'process',
          type: 'shell',
          command: 'echo processed',
          dependsOn: ['invoke-fetcher'],
        },
      ],
    });

    const spawner = cannedSpawner({
      process: { exitCode: 0, result: 'processed-output' },
    });
    const deps: DagExecutorDeps = { runStore, agentStore, spawnNode: spawner };
    const run = await executeAgentDag(parentAgent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'invoke-fetcher')!.status).toBe('completed');
    expect(execs.find((e) => e.nodeId === 'process')!.status).toBe('completed');
  });
});

describe('executeAgentDag — loop (Flow PR D)', () => {
  let agentStore: AgentStore;

  beforeEach(() => {
    agentStore = new AgentStore(join(dir, 'runs.db'));
  });

  afterEach(() => {
    try { agentStore.close(); } catch {}
  });

  it('iterates over an array and invokes sub-agent per item', async () => {
    agentStore.createAgent(
      {
        id: 'item-handler',
        name: 'Item Handler',
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [{ id: 'handle', type: 'shell', command: 'echo "handled-$ITEM"' }],
      },
      'cli',
      'seed',
    );

    const parentAgent = makeAgent({
      nodes: [
        { id: 'source', type: 'shell', command: 'echo source' },
        {
          id: 'each',
          type: 'loop' as any,
          dependsOn: ['source'],
          loopConfig: { over: 'items', agentId: 'item-handler' },
        },
      ],
    });

    const spawner = cannedSpawner({
      source: { exitCode: 0, result: '{"items": ["a", "b", "c"]}' },
    });
    // Don't mock the sub-agent spawns — let them run real shell.
    const deps: DagExecutorDeps = { runStore, agentStore, spawnNode: spawner };
    const run = await executeAgentDag(parentAgent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    const loopExec = execs.find((e) => e.nodeId === 'each');
    expect(loopExec!.status).toBe('completed');

    const loopOutput = JSON.parse(loopExec!.result!);
    expect(loopOutput.count).toBe(3);
    expect(loopOutput.items).toHaveLength(3);

    // Verify nested runs were created.
    const allRuns = runStore.queryRuns({ limit: 20, offset: 0, statuses: [] });
    const subRuns = allRuns.rows.filter((r) => r.parentRunId === run.id);
    expect(subRuns).toHaveLength(3);
  });

  it('fails cleanly when loop field is not an array', async () => {
    agentStore.createAgent(
      {
        id: 'dummy',
        name: 'Dummy',
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [{ id: 'main', type: 'shell', command: 'echo ok' }],
      },
      'cli',
      'seed',
    );

    const parentAgent = makeAgent({
      nodes: [
        { id: 'source', type: 'shell', command: 'echo source' },
        {
          id: 'each',
          type: 'loop' as any,
          dependsOn: ['source'],
          loopConfig: { over: 'notAnArray', agentId: 'dummy' },
        },
      ],
    });
    const spawner = cannedSpawner({
      source: { exitCode: 0, result: '{"notAnArray": "string"}' },
    });
    const deps: DagExecutorDeps = { runStore, agentStore, spawnNode: spawner };
    const run = await executeAgentDag(parentAgent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('failed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'each')!.error).toContain('not an array');
  });

  it('respects maxIterations', async () => {
    agentStore.createAgent(
      {
        id: 'counter',
        name: 'Counter',
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [{ id: 'count', type: 'shell', command: 'echo counted' }],
      },
      'cli',
      'seed',
    );

    const parentAgent = makeAgent({
      nodes: [
        { id: 'source', type: 'shell', command: 'echo source' },
        {
          id: 'each',
          type: 'loop' as any,
          dependsOn: ['source'],
          loopConfig: { over: 'items', agentId: 'counter', maxIterations: 2 },
        },
      ],
    });
    const spawner = cannedSpawner({
      source: { exitCode: 0, result: '{"items": [1, 2, 3, 4, 5]}' },
    });
    const deps: DagExecutorDeps = { runStore, agentStore, spawnNode: spawner };
    const run = await executeAgentDag(parentAgent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const loopOutput = JSON.parse(
      runStore.listNodeExecutions(run.id).find((e) => e.nodeId === 'each')!.result!,
    );
    // Only 2 iterations despite 5 items.
    expect(loopOutput.count).toBe(2);
  });
});

describe('executeAgentDag — branch merge (Flow PR F)', () => {
  it('branch node merges all upstream outputs', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'a', type: 'shell', command: 'echo a' },
        { id: 'b', type: 'shell', command: 'echo b' },
        {
          id: 'merge',
          type: 'branch' as any,
          dependsOn: ['a', 'b'],
        },
      ],
    });
    const spawner = cannedSpawner({
      a: { exitCode: 0, result: '{"val":"from-a"}' },
      b: { exitCode: 0, result: '{"val":"from-b"}' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    const mergeExec = execs.find((e) => e.nodeId === 'merge');
    expect(mergeExec!.status).toBe('completed');
    const mergeOutput = JSON.parse(mergeExec!.result!);
    expect(mergeOutput.count).toBe(2);
    expect(mergeOutput.merged.a).toBeDefined();
    expect(mergeOutput.merged.b).toBeDefined();
  });

  it('branch node excludes condition-skipped upstreams from merge', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'gate', type: 'shell', command: 'echo gate' },
        {
          id: 'cond',
          type: 'conditional' as any,
          dependsOn: ['gate'],
          conditionalConfig: { predicate: { field: 'go', equals: true } },
        },
        {
          id: 'path-a',
          type: 'shell',
          command: 'echo a',
          dependsOn: ['cond'],
          onlyIf: { upstream: 'cond', field: 'matched', equals: true },
        },
        {
          id: 'path-b',
          type: 'shell',
          command: 'echo b',
          dependsOn: ['cond'],
          onlyIf: { upstream: 'cond', field: 'matched', notEquals: true },
        },
        {
          id: 'merge',
          type: 'branch' as any,
          dependsOn: ['path-a', 'path-b'],
        },
      ],
    });
    const spawner = cannedSpawner({
      gate: { exitCode: 0, result: '{"go": true}' },
      'path-a': { exitCode: 0, result: 'took-a' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const mergeOutput = JSON.parse(
      runStore.listNodeExecutions(run.id).find((e) => e.nodeId === 'merge')!.result!,
    );
    // Only path-a is in the merge; path-b was condition-skipped.
    expect(mergeOutput.count).toBe(1);
    expect(mergeOutput.merged['path-a']).toBeDefined();
    expect(mergeOutput.merged['path-b']).toBeUndefined();
  });
});

describe('executeAgentDag — end + break (Flow PR E)', () => {
  it('end node terminates the flow and skips remaining nodes', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'check', type: 'shell', command: 'echo check' },
        {
          id: 'cond',
          type: 'conditional' as any,
          dependsOn: ['check'],
          conditionalConfig: { predicate: { field: 'abort', equals: true } },
        },
        {
          id: 'abort',
          type: 'end' as any,
          dependsOn: ['cond'],
          onlyIf: { upstream: 'cond', field: 'matched', equals: true },
          endMessage: 'Aborting — upstream requested stop.',
        },
        {
          id: 'after-abort',
          type: 'shell',
          command: 'echo should-not-run',
          dependsOn: ['cond'],
        },
      ],
    });
    const spawner = cannedSpawner({
      check: { exitCode: 0, result: '{"abort": true}' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    // Run completes — end is a clean exit, not a failure.
    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'abort')!.status).toBe('completed');
    expect(execs.find((e) => e.nodeId === 'abort')!.result).toContain('Aborting');
    expect(execs.find((e) => e.nodeId === 'after-abort')!.status).toBe('skipped');
    expect(execs.find((e) => e.nodeId === 'after-abort')!.errorCategory).toBe('flow_ended');
  });

  it('end node does not fire when its onlyIf is false', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'check', type: 'shell', command: 'echo check' },
        {
          id: 'cond',
          type: 'conditional' as any,
          dependsOn: ['check'],
          conditionalConfig: { predicate: { field: 'abort', equals: true } },
        },
        {
          id: 'abort',
          type: 'end' as any,
          dependsOn: ['cond'],
          onlyIf: { upstream: 'cond', field: 'matched', equals: true },
        },
        {
          id: 'continue',
          type: 'shell',
          command: 'echo continued',
          dependsOn: ['check'],
        },
      ],
    });
    const spawner = cannedSpawner({
      check: { exitCode: 0, result: '{"abort": false}' },
      continue: { exitCode: 0, result: 'continued' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    // End node was skipped (condition not met), flow continued normally.
    expect(execs.find((e) => e.nodeId === 'abort')!.errorCategory).toBe('condition_not_met');
    expect(execs.find((e) => e.nodeId === 'continue')!.status).toBe('completed');
  });

  it('break node terminates the current flow (for loop body use)', async () => {
    const agent = makeAgent({
      nodes: [
        { id: 'step-1', type: 'shell', command: 'echo step1' },
        {
          id: 'stop',
          type: 'break' as any,
          dependsOn: ['step-1'],
          endMessage: 'Breaking out of loop body.',
        },
        {
          id: 'step-2',
          type: 'shell',
          command: 'echo should-not-run',
          dependsOn: ['step-1'],
        },
      ],
    });
    const spawner = cannedSpawner({
      'step-1': { exitCode: 0, result: 'done' },
    });
    const deps: DagExecutorDeps = { runStore, spawnNode: spawner };
    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, deps);

    // Break completes the flow — same as end within a sub-flow context.
    expect(run.status).toBe('completed');
    const execs = runStore.listNodeExecutions(run.id);
    expect(execs.find((e) => e.nodeId === 'stop')!.status).toBe('completed');
    expect(execs.find((e) => e.nodeId === 'step-2')!.errorCategory).toBe('flow_ended');
  });
});
