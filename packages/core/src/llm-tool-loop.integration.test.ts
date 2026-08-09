/**
 * End-to-end proof of the headline capability: an OpenAI-compatible model (e.g.
 * local-qwen-8b) calls an MCP tool mid-generation. Wires the REAL invoker loop
 * (`invokeOpenAiChat`) to the REAL dispatch layer (`resolveExposedToolDefs` +
 * `buildToolExecutor`), stubbing only the two true externals: the model's HTTP
 * endpoint (via `fetchImpl`) and the MCP server (via a mocked `callMcpTool`).
 *
 * Covers the full round-trip: model emits a tool_call under the *mangled*
 * function name → executor maps it back to the real dotted id → MCP tool runs →
 * result is fed back as a role:"tool" message → model produces a final answer.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ToolStore } from './tool-store.js';
import type { ToolDefinition } from './tool-types.js';
import { invokeOpenAiChat } from './openai-http-invoker.js';
import { resolveExposedToolDefs, buildToolExecutor } from './llm-tool-dispatch.js';

const callMcpTool = vi.hoisted(() => vi.fn());
vi.mock('./mcp-client.js', () => ({ callMcpTool }));

function mcpDef(id: string): ToolDefinition {
  return {
    id,
    name: id,
    description: `Search ${id}`,
    source: 'local',
    inputs: { query: { type: 'string', required: true } },
    outputs: {},
    implementation: { type: 'mcp', mcpToolName: id.split('.').pop(), mcpUrl: 'http://mcp.example/v1' },
  };
}

function fakeToolStore(tools: Record<string, ToolDefinition>): ToolStore {
  return {
    getTool: (id: string) => tools[id],
    getToolServerId: (id: string) => (tools[id] ? `srv-${id}` : undefined),
    getMcpServer: (serverId: string) => ({ id: serverId, enabled: true }),
  } as unknown as ToolStore;
}

describe('local model → MCP tool round-trip', () => {
  it('lets the model call an MCP tool and answer from its result', async () => {
    callMcpTool.mockResolvedValue({
      result: 'Notion "roadmap": Q3 = ship the local-model tool harness.',
      isError: false,
    });

    // Expose a dotted MCP id — it must be mangled for the OpenAI request.
    const store = fakeToolStore({ 'notion.search': mcpDef('notion.search') });
    const { tools, idByFunctionName, exposedToolIds } = resolveExposedToolDefs(['notion.search'], { toolStore: store });
    expect(tools[0].function.name).toBe('notion_search'); // dotted id → safe name

    const onToolCall = buildToolExecutor({
      exposedToolIds,
      idByFunctionName,
      agentId: 'demo',
      agentSource: 'local',
      toolStore: store,
    });

    // Simulate the qwen endpoint: turn 1 asks to call the tool, turn 2 answers.
    const sentBodies: Array<Record<string, unknown>> = [];
    let turn = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentBodies.push(JSON.parse(String(init.body)));
      turn += 1;
      if (turn === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'notion_search', arguments: JSON.stringify({ query: 'roadmap' }) } }],
          } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'The Q3 roadmap is to ship the local-model tool harness.' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await invokeOpenAiChat({
      apiBase: 'http://127.0.0.1:8080/v1',
      model: 'local-qwen-8b',
      prompt: 'What is the Q3 roadmap? Use the notion.search tool.',
      timeoutSec: 10,
      tools,
      onToolCall,
      maxTurns: 5,
      fetchImpl,
    });

    // The model produced a final answer grounded in the MCP result.
    expect(result.exitCode).toBe(0);
    expect(result.result).toMatch(/tool harness/i);

    // The MCP tool was actually invoked with the model's args (real dotted name
    // resolved), through callMcpTool.
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    const [impl, inputs] = callMcpTool.mock.calls[0];
    expect((impl as { mcpToolName?: string }).mcpToolName).toBe('search');
    expect(inputs).toMatchObject({ query: 'roadmap' });

    // Turn 1 advertised the tool; turn 2 carried the tool result back to the model.
    expect((sentBodies[0].tools as unknown[]).length).toBe(1);
    const secondTurnMessages = sentBodies[1].messages as Array<{ role: string; tool_call_id?: string }>;
    expect(secondTurnMessages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_1')).toBe(true);
  });
});
