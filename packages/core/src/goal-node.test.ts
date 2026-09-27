import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAgent, exportAgent } from './agent-yaml.js';
import { AgentStore } from './agent-store.js';
import { RunStore } from './run-store.js';
import { executeAgentDag } from './dag-executor.js';
import type { AgentNode } from './agent-v2-types.js';
import type { SpawnResult } from './node-spawner.js';
import {
  extractGoalFinal,
  finishGoalResult,
  goalPrompt,
  toGoalPromptNode,
  GOAL_DEFAULT_MAX_TURNS,
  GOAL_DEFAULT_TIMEOUT_SEC,
} from './goal-node.js';

const GOAL_YAML = `id: shoe-scout
name: Shoe scout
status: active
source: local
version: 1
timeoutSec: 900
runOn: local
outputs:
  picks:
    type: string
    description: The three picks, one line each.
  sources:
    type: array
nodes:
  - id: research
    type: goal
    goal: |
      Find the 3 best-reviewed trail running shoes under {{inputs.BUDGET}}.
    tools: [web-fetch, web-scrape]
    budget:
      maxTurns: 8
      timeoutSec: 300
inputs:
  BUDGET:
    type: string
    default: "$150"
`;

describe('goal node: schema + YAML', () => {
  it('parses a goal node and round-trips goal, budget, and the agent timeoutSec / runOn', () => {
    const agent = parseAgent(GOAL_YAML);
    expect(agent.nodes[0]).toMatchObject({ type: 'goal', tools: ['web-fetch', 'web-scrape'], budget: { maxTurns: 8, timeoutSec: 300 } });
    expect(agent.timeoutSec).toBe(900);
    expect(agent.runOn).toBe('local');
    const again = parseAgent(exportAgent(agent));
    expect(again.nodes[0].goal).toContain('{{inputs.BUDGET}}');
    expect(again.nodes[0].budget).toEqual({ maxTurns: 8, timeoutSec: 300 });
    expect(again.timeoutSec).toBe(900);
    expect(again.runOn).toBe('local');
  });

  it('rejects a goal node without goal text or without tools', () => {
    expect(() => parseAgent(GOAL_YAML.replace(/    goal: \|\n.*\n/, ''))).toThrow(/goal \(goal\)/);
    expect(() => parseAgent(GOAL_YAML.replace('    tools: [web-fetch, web-scrape]\n', ''))).toThrow(/goal nodes need at least one entry in tools/);
  });

  it('bounds budget.maxTurns to 1..50', () => {
    expect(() => parseAgent(GOAL_YAML.replace('maxTurns: 8', 'maxTurns: 99'))).toThrow();
  });
});

describe('goal node: agent timeoutSec survives the store (regression: it used to be dropped)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sua-goal-store-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps timeoutSec and the goal node through create → get', () => {
    const store = new AgentStore(join(dir, 'sua.db'));
    const { version: _v, ...agent } = parseAgent(GOAL_YAML);
    store.createAgent(agent, 'cli');
    const loaded = store.getAgent('shoe-scout')!;
    expect(loaded.timeoutSec).toBe(900);
    expect(loaded.nodes[0]).toMatchObject({ type: 'goal', budget: { maxTurns: 8 } });
    store.close();
  });
});

describe('goal framing', () => {
  const node = parseAgent(GOAL_YAML).nodes[0];
  const agent = parseAgent(GOAL_YAML);

  it('states the goal, the tools, the budget, and how to finish (with the declared outputs)', () => {
    const p = goalPrompt(node, agent);
    expect(p).toContain('Find the 3 best-reviewed trail running shoes under {{inputs.BUDGET}}.');
    expect(p).toContain('You can call: web-fetch, web-scrape.');
    expect(p).toContain('At most 8 turns and 300 seconds.');
    expect(p).toContain('<final>');
    expect(p).toContain('  - picks (string): The three picks, one line each.');
    expect(p).toContain('  - sources (array)');
  });

  it('becomes an ordinary llm-prompt node with the budget as maxTurns / timeout', () => {
    const n = toGoalPromptNode(node, agent);
    expect(n.type).toBe('llm-prompt');
    expect(n.maxTurns).toBe(8);
    expect(n.timeout).toBe(300);
    expect(n.tools).toEqual(['web-fetch', 'web-scrape']);
    expect(n).not.toHaveProperty('goal');
    expect(n).not.toHaveProperty('budget');
  });

  it('defaults the budget', () => {
    const n = toGoalPromptNode({ id: 'g', type: 'goal', goal: 'x', tools: ['web-fetch'] }, {});
    expect(n.maxTurns).toBe(GOAL_DEFAULT_MAX_TURNS);
    expect(n.timeout).toBe(GOAL_DEFAULT_TIMEOUT_SEC);
    expect(n.prompt).toContain('put the answer itself');
  });
});

describe('the done signal', () => {
  const node: AgentNode = { id: 'g', type: 'goal', goal: 'x', tools: ['web-fetch'], budget: { maxTurns: 4, timeoutSec: 60 } };
  const ok = (result: string): SpawnResult => ({ result, exitCode: 0 });

  it('extracts the last <final> block', () => {
    expect(extractGoalFinal('thinking…<final>draft</final> more <FINAL> answer </FINAL>')).toBe('answer');
    expect(extractGoalFinal('no final here')).toBeUndefined();
  });

  it('keeps only the <final> answer on success', () => {
    expect(finishGoalResult(node, ok('I looked around.\n<final>Three shoes: A, B, C</final>')).result).toBe('Three shoes: A, B, C');
  });

  it('fails as budget_exhausted when the loop ended without <final>', () => {
    const r = finishGoalResult(node, ok('Still looking…'));
    expect(r).toMatchObject({ exitCode: 1, category: 'budget_exhausted' });
    expect(r.error).toContain('ended without a <final> answer');
    expect(r.error).toContain('budget: 4 turns, 60s');
  });

  it('names the cause when the provider says turns or time ran out', () => {
    expect(finishGoalResult(node, ok('{"type":"result","subtype":"error_max_turns"}')).error).toContain('used all 4 turns');
    expect(finishGoalResult(node, { result: '', exitCode: 1, error: 'exceeded the tool-call limit (4 turns)' }).error).toContain('used all 4 turns');
    expect(finishGoalResult(node, { result: '', exitCode: 124, category: 'timeout', error: 'Timed out' }).error).toContain('hit the 60s time limit');
  });

  it('passes other failures through untouched', () => {
    const r: SpawnResult = { result: '', exitCode: 1, category: 'spawn_failure', error: 'claude not installed' };
    expect(finishGoalResult(node, r)).toBe(r);
  });
});

describe('goal node through the executor', () => {
  let dir: string;
  let runStore: RunStore;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sua-goal-exec-')); runStore = new RunStore(join(dir, 'runs.db')); });
  afterEach(() => { runStore.close(); rmSync(dir, { recursive: true, force: true }); });

  it('spawns the framed llm-prompt node and exposes the <final> JSON as structured outputs', async () => {
    let spawned: AgentNode | undefined;
    const run = await executeAgentDag(parseAgent(GOAL_YAML), { triggeredBy: 'cli' }, {
      runStore,
      spawnNode: async (n) => {
        spawned = n;
        return { result: 'Found them.\n<final>\n{"picks": "A\\nB\\nC", "sources": ["https://x"]}\n</final>', exitCode: 0 };
      },
    });
    expect(spawned).toMatchObject({ type: 'llm-prompt', maxTurns: 8, timeout: 300, tools: ['web-fetch', 'web-scrape'] });
    expect(spawned?.prompt).toContain('GOAL');
    expect(run.status).toBe('completed');
    const exec = runStore.listNodeExecutions(run.id)[0];
    expect(exec.result).toContain('"picks"');
    expect(JSON.parse(exec.outputsJson!)).toMatchObject({ picks: 'A\nB\nC', sources: ['https://x'] });
  });

  it('fails the node as budget_exhausted when the model never finishes', async () => {
    const run = await executeAgentDag(parseAgent(GOAL_YAML), { triggeredBy: 'cli' }, {
      runStore,
      spawnNode: async () => ({ result: 'I will keep searching…', exitCode: 0 }),
    });
    expect(run.status).toBe('failed');
    const exec = runStore.listNodeExecutions(run.id)[0];
    expect(exec.errorCategory).toBe('budget_exhausted');
  });
});
