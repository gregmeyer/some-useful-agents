/**
 * MCP client for invoking remote MCP tools from the DAG executor.
 *
 * Clients are pooled per server signature (transport + command/args or URL)
 * so repeated nodes in a run share a single connection — important for
 * stdio servers where each connect() spawns a child process.
 *
 * Secrets/variables in mcpUrl, mcpCommand, mcpArgs, mcpEnv are resolved
 * upstream by the executor before this module sees them.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolImplementation, ToolOutput } from './tool-types.js';

type PooledClient = { client: Client; close: () => Promise<void> };

const pool = new Map<string, Promise<PooledClient>>();

function signature(impl: ToolImplementation): string {
  if (impl.mcpTransport === 'http') {
    return `http:${impl.mcpUrl ?? ''}`;
  }
  const env = impl.mcpEnv ? JSON.stringify(impl.mcpEnv) : '';
  return `stdio:${impl.mcpCommand ?? ''}:${(impl.mcpArgs ?? []).join(' ')}:${env}`;
}

async function open(impl: ToolImplementation): Promise<PooledClient> {
  const client = new Client(
    { name: 'sua-executor', version: '0.1.0' },
    { capabilities: {} },
  );

  if (impl.mcpTransport === 'http') {
    if (!impl.mcpUrl) throw new Error('MCP tool: mcpUrl required for http transport');
    const transport = new StreamableHTTPClientTransport(new URL(impl.mcpUrl));
    await client.connect(transport);
    return { client, close: async () => { await client.close(); } };
  }

  if (!impl.mcpCommand) {
    throw new Error('MCP tool: mcpCommand required for stdio transport');
  }
  const transport = new StdioClientTransport({
    command: impl.mcpCommand,
    args: impl.mcpArgs ?? [],
    env: { ...process.env, ...(impl.mcpEnv ?? {}) } as Record<string, string>,
  });
  await client.connect(transport);
  return { client, close: async () => { await client.close(); } };
}

async function getClient(impl: ToolImplementation): Promise<Client> {
  const key = signature(impl);
  let entry = pool.get(key);
  if (!entry) {
    entry = open(impl).catch((err) => {
      pool.delete(key);
      throw err;
    });
    pool.set(key, entry);
  }
  return (await entry).client;
}

export async function callMcpTool(
  impl: ToolImplementation,
  inputs: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolOutput> {
  if (!impl.mcpToolName) {
    throw new Error('MCP tool: mcpToolName required');
  }
  const client = await getClient(impl);
  const res = await client.callTool(
    { name: impl.mcpToolName, arguments: inputs },
    undefined,
    { signal },
  );

  const content = Array.isArray(res.content) ? res.content : [];
  const text = content
    .filter((c: { type?: string }) => c.type === 'text')
    .map((c: { text?: string }) => c.text ?? '')
    .join('\n');

  const structured = (res as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
  return {
    ...structured,
    result: text,
    isError: res.isError ?? false,
  };
}

export async function listMcpTools(
  impl: ToolImplementation,
): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
  const client = await getClient(impl);
  const res = await client.listTools();
  return (res.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

/** Close all pooled MCP clients. Call at shutdown or between tests. */
export async function closeAllMcpClients(): Promise<void> {
  const entries = Array.from(pool.values());
  pool.clear();
  await Promise.allSettled(
    entries.map(async (p) => {
      try {
        const pc = await p;
        await pc.close();
      } catch {
        // ignore close errors
      }
    }),
  );
}
