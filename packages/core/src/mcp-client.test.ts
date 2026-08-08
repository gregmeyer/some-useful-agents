import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { callMcpTool, listMcpTools, closeAllMcpClients } from './mcp-client.js';
import type { ToolImplementation } from './tool-types.js';

/**
 * Integration coverage for the outbound MCP client after the SDK v2 migration.
 * Stands up a real 2026-07-28 (stateless) HTTP MCP server in-process and drives
 * it through the pooled client with `versionNegotiation:'auto'` — the same path
 * the DAG executor and notify-dispatcher use at runtime.
 */
describe('mcp-client against a v2 (2026-07-28) HTTP server', () => {
  let httpServer: Server | undefined;

  afterEach(async () => {
    await closeAllMcpClients();
    if (httpServer) {
      await new Promise<void>((r) => httpServer!.close(() => r()));
      httpServer = undefined;
    }
  });

  async function startServer(): Promise<string> {
    const handler = toNodeHandler(
      createMcpHandler(() => {
        const s = new McpServer({ name: 'test-remote', version: '0.0.1' });
        s.registerTool(
          'echo',
          { description: 'Echo a message back', inputSchema: { message: z.string() } },
          async ({ message }) => ({ content: [{ type: 'text', text: `echo: ${message}` }] }),
        );
        return s;
      }, { legacy: 'stateless' }),
    );
    httpServer = createServer((req, res) => { void handler(req, res); });
    await new Promise<void>((r) => httpServer!.listen(0, '127.0.0.1', r));
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    return `http://127.0.0.1:${port}/mcp`;
  }

  it('lists tools from the remote server', async () => {
    const url = await startServer();
    const impl: ToolImplementation = { type: 'mcp', mcpTransport: 'http', mcpUrl: url };
    const tools = await listMcpTools(impl);
    expect(tools.map((t) => t.name)).toContain('echo');
  });

  it('calls a remote tool and returns joined text', async () => {
    const url = await startServer();
    const impl: ToolImplementation = { type: 'mcp', mcpTransport: 'http', mcpUrl: url, mcpToolName: 'echo' };
    const out = await callMcpTool(impl, { message: 'hi' });
    expect(out.result).toBe('echo: hi');
    expect(out.isError).toBe(false);
  });
});
