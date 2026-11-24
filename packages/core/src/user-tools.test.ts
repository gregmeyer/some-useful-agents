import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { ToolStore } from './tool-store.js';
import { executeAgentDag, type DagExecutorDeps } from './dag-executor.js';
import { buildToolExecutor, resolveExposedToolDefs } from './llm-tool-dispatch.js';
import {
  resolveToolCallInputs,
  commandToolEnv,
  substituteToolPrompt,
  reservedToolInputName,
  userToolWarnings,
  nodeRunsShell,
  ToolInputError,
} from './user-tool-inputs.js';
import { checkUserToolYaml, saveUserTool, removeUserTool, agentsUsingTool, UserToolError } from './user-tools.js';
import type { Agent } from './agent-v2-types.js';
import type { ToolDefinition } from './tool-types.js';

if (!process.env.PATH) process.env.PATH = '/usr/bin:/bin';

const WORD_COUNT_YAML = `id: word-count
name: Word count
description: Counts the words in some text
inputs:
  text: { type: string, required: true }
  unit: { type: string, default: words }
outputs:
  count: { type: number }
implementation:
  type: shell
  command: |
    n=$(printf '%s' "$text" | wc -w | tr -d ' ')
    echo "{\\"count\\": $n, \\"unit\\": \\"$unit\\"}"
`;

const def = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: 't', name: 'T', source: 'local',
  inputs: { url: { type: 'string', required: true }, n: { type: 'number', default: 3 } },
  outputs: {},
  implementation: { type: 'shell', command: 'curl "$url"' },
  ...over,
});

let dir: string;
let runStore: RunStore;
let toolStore: ToolStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-user-tools-'));
  runStore = new RunStore(join(dir, 'runs.db'));
  toolStore = new ToolStore(join(dir, 'runs.db'));
});

afterEach(() => {
  toolStore.close();
  runStore.close();
  rmSync(dir, { recursive: true, force: true });
});

function agent(over: Partial<Agent>): Agent {
  return { id: 'a', name: 'A', status: 'active', source: 'local', mcp: false, version: 1, nodes: [], ...over };
}

describe('resolveToolCallInputs', () => {
  it('applies defaults, stringifies, and keeps only declared inputs', () => {
    expect(resolveToolCallInputs(def(), { url: 'https://x.test' })).toEqual({ url: 'https://x.test', n: '3' });
    expect(resolveToolCallInputs(def(), { url: 'u', n: 7 })).toEqual({ url: 'u', n: '7' });
  });

  it('refuses an input the tool does not declare', () => {
    expect(() => resolveToolCallInputs(def(), { url: 'u', PATH: '/evil' })).toThrow(/no input "PATH"/);
  });

  it('refuses a missing required input', () => {
    expect(() => resolveToolCallInputs(def(), {})).toThrow(ToolInputError);
    expect(() => resolveToolCallInputs(def(), { url: '' })).toThrow(/needs its "url" input/);
  });

  it('JSON-encodes objects and caps the size', () => {
    const d = def({ inputs: { data: { type: 'json' } } });
    expect(resolveToolCallInputs(d, { data: { a: 1 } })).toEqual({ data: '{"a":1}' });
    expect(() => resolveToolCallInputs(d, { data: 'x'.repeat(40_000) })).toThrow(/over the/);
  });
});

describe('input names a command tool can use', () => {
  it('rejects names the environment or sua uses, in any case', () => {
    for (const n of ['PATH', 'path', 'ld_preload', 'HOME', 'http_proxy', 'HTTPS_PROXY', 'STATE_DIR', 'upstream_x_result', 'SUA_TOKEN', 'TMPDIR', '1x', 'a-b']) {
      expect(reservedToolInputName(n), n).toBeDefined();
    }
    for (const n of ['url', 'text', 'Query', 'max_items']) expect(reservedToolInputName(n), n).toBeUndefined();
  });

  it('refuses an input that would replace a secret the step declared', () => {
    expect(() => commandToolEnv(def(), { A: '1' }, { API_KEY: 'x' }, ['API_KEY'])).toThrow(/same name as a secret/);
    expect(commandToolEnv(def(), { A: '1' }, { url: 'u' }, ['API_KEY'])).toEqual({ A: '1', url: 'u' });
  });
});

describe('prompt tools', () => {
  it('substitutes {{inputs.x}}, lowercase included', () => {
    expect(substituteToolPrompt('Summarise {{ inputs.text }} as {{inputs.Style}}.', { text: 'this', Style: 'a haiku' }))
      .toBe('Summarise this as a haiku.');
    expect(substituteToolPrompt('{{inputs.missing}}!', {})).toBe('!');
  });
});

describe('warnings', () => {
  it('flags unquoted inputs, eval, rm -rf and curl on an input URL', () => {
    const w = userToolWarnings(def({ implementation: { type: 'shell', command: 'eval $url; rm -rf /tmp/x; curl $url' } }));
    expect(w.join('\n')).toMatch(/\$url is used without quotes/);
    expect(w.join('\n')).toMatch(/runs text as code/);
    expect(w.join('\n')).toMatch(/deletes files recursively/);
    expect(w.join('\n')).toMatch(/http-get tool/);
    expect(w.join('\n')).toMatch(/never uses its "n" input/);
  });

  it('is quiet for a quoted input', () => {
    const w = userToolWarnings(def({ inputs: { text: { type: 'string' } }, implementation: { type: 'shell', command: 'printf "%s" "$text" | wc -w' } }));
    expect(w).toEqual([]);
  });
});

describe('checkUserToolYaml / saveUserTool / removeUserTool', () => {
  it('saves a command tool with its YAML and reads it back', () => {
    const r = saveUserTool(toolStore, WORD_COUNT_YAML);
    expect(r.created).toBe(true);
    const t = toolStore.getTool('word-count')!;
    expect(t.source).toBe('local');
    expect(t.yamlText).toBe(WORD_COUNT_YAML);
    expect(saveUserTool(toolStore, WORD_COUNT_YAML).created).toBe(false);
  });

  it('refuses a built-in id, an MCP tool, a reserved input name and bad YAML', () => {
    expect(checkUserToolYaml(WORD_COUNT_YAML.replace('id: word-count', 'id: http-get')).errors.join()).toMatch(/built-in/);
    expect(checkUserToolYaml('id: m\nname: M\nimplementation: { type: mcp, mcpToolName: x, mcpCommand: y }\n').errors.join()).toMatch(/Import/);
    expect(checkUserToolYaml(WORD_COUNT_YAML.replace('  unit:', '  PATH:')).errors.join()).toMatch(/environment already uses/);
    expect(checkUserToolYaml('id: [').errors[0]).toMatch(/doesn't parse/);
  });

  it('forces source local', () => {
    const r = checkUserToolYaml(WORD_COUNT_YAML + 'source: community\n');
    expect(r.tool?.source).toBe('local');
  });

  it('removes a tool you added, not an MCP one or a built-in', () => {
    saveUserTool(toolStore, WORD_COUNT_YAML);
    removeUserTool(toolStore, 'word-count');
    expect(toolStore.getTool('word-count')).toBeUndefined();
    expect(() => removeUserTool(toolStore, 'http-get')).toThrow(UserToolError);
    toolStore.createMcpServer({ id: 's', name: 's', transport: 'stdio', command: 'x', enabled: true });
    toolStore.createTool({ id: 's-do', name: 'do', source: 'local', inputs: {}, outputs: {}, implementation: { type: 'mcp', mcpTransport: 'stdio', mcpCommand: 'x', mcpToolName: 'do' } }, undefined, 's');
    expect(() => removeUserTool(toolStore, 's-do')).toThrow(/MCP server/);
  });

  it('finds the agents that use a tool', () => {
    expect(agentsUsingTool([
      agent({ id: 'one', nodes: [{ id: 'n', type: 'shell', tool: 'word-count' }] }),
      agent({ id: 'two', nodes: [{ id: 'n', type: 'llm-prompt', prompt: 'p', tools: ['word-count'] }] }),
      agent({ id: 'three', nodes: [{ id: 'n', type: 'shell', command: 'true' }] }),
    ], 'word-count')).toEqual(['one', 'two']);
  });
});

describe('a tool you added, run as a step', () => {
  it('gets its inputs as environment variables, with defaults', async () => {
    saveUserTool(toolStore, WORD_COUNT_YAML);
    const run = await executeAgentDag(
      agent({
        inputs: { TEXT: { type: 'string', default: 'one two three' } },
        nodes: [{ id: 'count', type: 'shell', tool: 'word-count', toolInputs: { text: '{{inputs.TEXT}}' } }],
      }),
      { triggeredBy: 'cli' },
      { runStore, toolStore },
    );
    expect(run.status).toBe('completed');
    const [ne] = runStore.listNodeExecutions(run.id);
    expect(JSON.parse(ne.outputsJson!)).toMatchObject({ count: 3, unit: 'words' });
  });

  it('fails as input_resolution when a required input is missing or undeclared', async () => {
    saveUserTool(toolStore, WORD_COUNT_YAML);
    for (const toolInputs of [{}, { text: 'x', extra: 'y' }]) {
      const run = await executeAgentDag(
        agent({ nodes: [{ id: 'count', type: 'shell', tool: 'word-count', toolInputs }] }),
        { triggeredBy: 'cli' },
        { runStore, toolStore },
      );
      expect(run.status).toBe('failed');
      const [ne] = runStore.listNodeExecutions(run.id);
      expect(ne.errorCategory).toBe('input_resolution');
    }
  });

  it('a prompt tool gets its inputs in its prompt and not the step\'s tools', async () => {
    saveUserTool(toolStore, 'id: shout\nname: Shout\ninputs:\n  text: { type: string }\nimplementation:\n  type: llm-prompt\n  prompt: "Shout {{inputs.text}}"\n');
    let seen: { prompt?: string; type?: string; tools?: string[] } = {};
    const spawnNode: DagExecutorDeps['spawnNode'] = async (node) => {
      seen = { prompt: node.prompt, type: node.type, tools: node.tools };
      return { result: 'HI', exitCode: 0 };
    };
    const run = await executeAgentDag(
      agent({ nodes: [{ id: 's', type: 'llm-prompt', tool: 'shout', toolInputs: { text: 'hi' }, tools: ['http-get'] }] }),
      { triggeredBy: 'cli' },
      { runStore, toolStore, spawnNode },
    );
    expect(run.status).toBe('completed');
    expect(seen).toEqual({ prompt: 'Shout hi', type: 'claude-code', tools: undefined });
  });
});

describe('the community shell gate follows what runs', () => {
  it('nodeRunsShell sees command tools, shell-exec and tools: lists', () => {
    saveUserTool(toolStore, WORD_COUNT_YAML);
    expect(nodeRunsShell({ type: 'shell' })).toBe(true);
    expect(nodeRunsShell({ type: 'llm-prompt', tool: 'word-count' }, toolStore)).toBe(true);
    expect(nodeRunsShell({ type: 'llm-prompt', tool: 'shell-exec' }, toolStore)).toBe(true);
    expect(nodeRunsShell({ type: 'goal', tools: ['http-get', 'word-count'] }, toolStore)).toBe(true);
    expect(nodeRunsShell({ type: 'goal', tools: ['http-get'] }, toolStore)).toBe(false);
  });

  it('refuses a community agent whose llm step names a command tool', async () => {
    saveUserTool(toolStore, WORD_COUNT_YAML);
    for (const node of [
      { id: 'n', type: 'llm-prompt' as const, tool: 'word-count', toolInputs: { text: 'x' } },
      { id: 'n', type: 'llm-prompt' as const, prompt: 'count', tools: ['word-count'] },
    ]) {
      const run = await executeAgentDag(
        agent({ source: 'community', nodes: [node] }),
        { triggeredBy: 'cli' },
        { runStore, toolStore, spawnNode: async () => ({ result: 'ran', exitCode: 0 }) },
      );
      expect(run.status).toBe('failed');
      const [ne] = runStore.listNodeExecutions(run.id);
      expect(ne.errorCategory).toBe('setup');
      expect(ne.error).toMatch(/community shell/);
    }
  });
});

describe('a model calling a command tool', () => {
  it('is offered only when the spawner can run it; prompt tools are not offered', () => {
    saveUserTool(toolStore, WORD_COUNT_YAML);
    saveUserTool(toolStore, 'id: shout\nname: Shout\nimplementation:\n  type: llm-prompt\n  prompt: "Shout"\n');
    expect(resolveExposedToolDefs(['word-count', 'shout'], { toolStore }).exposedToolIds).toEqual([]);
    const withRunner = resolveExposedToolDefs(['word-count', 'shout'], { toolStore, runCommandTool: async () => ({ result: '' }) });
    expect(withRunner.exposedToolIds).toEqual(['word-count']);
  });

  it('runs with declared inputs only, and reports an undeclared one to the model', async () => {
    saveUserTool(toolStore, WORD_COUNT_YAML);
    const calls: Array<Record<string, string>> = [];
    const execute = buildToolExecutor({
      exposedToolIds: ['word-count'],
      agentId: 'a',
      agentSource: 'local',
      toolStore,
      runCommandTool: async (_def, values) => { calls.push(values); return { result: '{"count":2}', count: 2 }; },
    });
    const ok = await execute('word-count', JSON.stringify({ text: 'a b' }));
    expect(ok.isError).toBe(false);
    expect(calls).toEqual([{ text: 'a b', unit: 'words' }]);
    const bad = await execute('word-count', JSON.stringify({ text: 'a', PATH: '/evil' }));
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/no input "PATH"/);
    expect(calls).toHaveLength(1);
  });
});
