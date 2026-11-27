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

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
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
  // versionNegotiation:'auto' probes with `server/discover` and falls back to
  // the 2025-era protocol, so a single client talks to BOTH old and new
  // external MCP servers. We intentionally leave `inputRequired` at its
  // non-fulfilling default: agent tool calls are non-interactive (no human in
  // the loop), so a server that demands mid-call input surfaces as an error
  // rather than hanging the DAG node.
  const client = new Client(
    { name: 'sua-executor', version: '0.1.0' },
    { versionNegotiation: { mode: 'auto' } },
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

/**
 * How long a server sits unused before sua closes it. A stdio server run in
 * Docker (`docker run --rm`) then exits and its container is removed, with
 * anything it saved inside; the next call starts a fresh one. Without this a
 * long-lived worker keeps one container for days and what it writes piles up.
 */
let idleMs = 10 * 60_000;
const idle = new Map<string, { busy: number; timer?: ReturnType<typeof setTimeout> }>();

/** How many servers are open now. */
export function openMcpClients(): number { return pool.size; }

/** Change how long an unused server stays open (tests); 0 closes it as soon as a call ends. */
export function setMcpIdleClose(ms: number): void { idleMs = ms; }

function closeIdle(key: string): void {
  const entry = pool.get(key);
  pool.delete(key);
  idle.delete(key);
  void entry?.then((pc) => pc.close()).catch(() => { /* already gone */ });
}

/** Run `fn` with a pooled client, keeping it open while it's in use and closing it once idle. */
async function withClient<T>(impl: ToolImplementation, fn: (client: Client) => Promise<T>): Promise<T> {
  const key = signature(impl);
  let entry = pool.get(key);
  if (!entry) {
    entry = open(impl).catch((err) => {
      pool.delete(key);
      throw err;
    });
    pool.set(key, entry);
  }
  const use = idle.get(key) ?? { busy: 0 };
  idle.set(key, use);
  if (use.timer) { clearTimeout(use.timer); use.timer = undefined; }
  use.busy += 1;
  try {
    return await fn((await entry).client);
  } finally {
    use.busy -= 1;
    if (use.busy === 0 && idle.get(key) === use && pool.get(key) === entry) {
      use.timer = setTimeout(() => closeIdle(key), idleMs);
      use.timer.unref?.();
    }
  }
}

export async function callMcpTool(
  impl: ToolImplementation,
  inputs: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolOutput> {
  if (!impl.mcpToolName) {
    throw new Error('MCP tool: mcpToolName required');
  }
  const toolName = impl.mcpToolName;
  const res = await withClient(impl, (client) => client.callTool(
    { name: toolName, arguments: inputs },
    { signal },
  ));

  const content = Array.isArray(res.content) ? res.content : [];
  const text = content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
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
  const res = await withClient(impl, (client) => client.listTools());
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
  for (const u of idle.values()) if (u.timer) clearTimeout(u.timer);
  idle.clear();
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
