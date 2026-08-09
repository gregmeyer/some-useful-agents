import { describe, it, expect, vi } from 'vitest';
import type { ToolStore } from './tool-store.js';
import type { ToolDefinition } from './tool-types.js';
import { mangleToolName } from './llm-tools.js';
import { resolveExposedToolDefs, buildToolExecutor } from './llm-tool-dispatch.js';

// Mock the MCP client so MCP dispatch is exercised without a real server.
vi.mock('./mcp-client.js', () => ({
  callMcpTool: vi.fn(async (impl: { mcpToolName?: string }, inputs: Record<string, unknown>) => ({
    result: `mcp:${impl.mcpToolName}:${JSON.stringify(inputs)}`,
    isError: false,
  })),
}));

/** Minimal MCP tool definition. */
function mcpDef(id: string): ToolDefinition {
  return {
    id,
    name: id,
    description: `MCP tool ${id}`,
    source: 'local',
    inputs: { query: { type: 'string', required: true } },
    outputs: {},
    implementation: { type: 'mcp', mcpToolName: id.split('.').pop(), mcpUrl: 'http://mcp.example/v1' },
  };
}

/** Duck-typed ToolStore over a fixed set of MCP tools; server enabled unless listed. */
function fakeToolStore(tools: Record<string, ToolDefinition>, disabledServers: string[] = []): ToolStore {
  return {
    getTool: (id: string) => tools[id],
    getToolServerId: (id: string) => (tools[id] ? `server-for-${id}` : undefined),
    getMcpServer: (serverId: string) => ({
      id: serverId,
      enabled: !disabledServers.includes(serverId),
    }),
  } as unknown as ToolStore;
}

describe('mangleToolName', () => {
  it('replaces dots and other invalid chars with underscores', () => {
    expect(mangleToolName('csv.read.sales')).toBe('csv_read_sales');
    expect(mangleToolName('notion.search')).toBe('notion_search');
    expect(mangleToolName('web-fetch')).toBe('web-fetch'); // already valid
    expect(mangleToolName('a/b:c')).toBe('a_b_c');
  });
});

describe('resolveExposedToolDefs', () => {
  it('exposes builtins under their own name with an identity map entry', () => {
    const { tools, idByFunctionName, exposedToolIds } = resolveExposedToolDefs(['web-fetch'], {});
    expect(tools.map((t) => t.function.name)).toEqual(['web-fetch']);
    expect(idByFunctionName.get('web-fetch')).toBe('web-fetch');
    expect(exposedToolIds).toEqual(['web-fetch']);
  });

  it('mangles a dotted MCP id and maps the function name back to the real id', () => {
    const store = fakeToolStore({ 'notion.search': mcpDef('notion.search') });
    const { tools, idByFunctionName } = resolveExposedToolDefs(['notion.search'], { toolStore: store });
    expect(tools[0].function.name).toBe('notion_search');
    expect(idByFunctionName.get('notion_search')).toBe('notion.search');
  });

  it('disambiguates colliding mangled names', () => {
    const store = fakeToolStore({ 'a.b': mcpDef('a.b'), 'a/b': mcpDef('a/b') });
    const { tools, idByFunctionName } = resolveExposedToolDefs(['a.b', 'a/b'], { toolStore: store });
    const names = tools.map((t) => t.function.name);
    expect(names).toEqual(['a_b', 'a_b_2']);
    expect(idByFunctionName.get('a_b')).toBe('a.b');
    expect(idByFunctionName.get('a_b_2')).toBe('a/b');
  });

  it('drops unknown ids and de-duplicates', () => {
    const { exposedToolIds } = resolveExposedToolDefs(['web-fetch', 'not-a-tool', 'web-fetch'], {});
    expect(exposedToolIds).toEqual(['web-fetch']);
  });
});

describe('buildToolExecutor', () => {
  const base = { agentId: 'a', agentSource: 'local' };

  it('dispatches a builtin and returns its result', async () => {
    const exec = buildToolExecutor({ ...base, exposedToolIds: ['json-parse'] });
    const r = await exec('json-parse', JSON.stringify({ text: '{"k":1}' }));
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('"k"');
  });

  it('translates a mangled function name to the real MCP id and dispatches it', async () => {
    const store = fakeToolStore({ 'notion.search': mcpDef('notion.search') });
    const { idByFunctionName, exposedToolIds } = resolveExposedToolDefs(['notion.search'], { toolStore: store });
    const exec = buildToolExecutor({ ...base, exposedToolIds, idByFunctionName, toolStore: store });
    const r = await exec('notion_search', JSON.stringify({ query: 'roadmap' }));
    expect(r.isError).toBe(false);
    expect(r.content).toContain('mcp:search:');
    expect(r.content).toContain('roadmap');
  });

  it('blocks a call to a disabled MCP server (in-loop error, no throw)', async () => {
    const store = fakeToolStore({ 'notion.search': mcpDef('notion.search') }, ['server-for-notion.search']);
    const { idByFunctionName, exposedToolIds } = resolveExposedToolDefs(['notion.search'], { toolStore: store });
    const exec = buildToolExecutor({ ...base, exposedToolIds, idByFunctionName, toolStore: store });
    const r = await exec('notion_search', '{"query":"x"}');
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/disabled/i);
  });

  it('rejects a tool not in the exposed set', async () => {
    const exec = buildToolExecutor({ ...base, exposedToolIds: ['json-parse'] });
    const r = await exec('shell-exec', '{"command":"echo hi"}');
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not available/i);
  });

  it('surfaces invalid JSON args as an error (no throw)', async () => {
    const exec = buildToolExecutor({ ...base, exposedToolIds: ['json-parse'] });
    const r = await exec('json-parse', '{not json');
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/invalid json/i);
  });

  it('caps oversized tool output', async () => {
    const store = fakeToolStore({ 'big.tool': mcpDef('big.tool') });
    const { idByFunctionName, exposedToolIds } = resolveExposedToolDefs(['big.tool'], { toolStore: store });
    const exec = buildToolExecutor({
      ...base,
      exposedToolIds,
      idByFunctionName,
      toolStore: store,
      maxOutputChars: 50,
    });
    const r = await exec('big_tool', JSON.stringify({ query: 'x'.repeat(500) }));
    expect(r.content.length).toBeLessThan(200);
    expect(r.content).toMatch(/truncated/i);
  });
});
