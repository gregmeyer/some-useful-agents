/**
 * A short-lived MCP endpoint that serves one node attempt's tools to a CLI
 * provider (claude), so it can call every sua tool — builtin, integration,
 * imported MCP — instead of only its own. See ADR-0036.
 *
 * It is a thin transport over the SAME `buildToolExecutor` the OpenAI-
 * compatible HTTP loop uses: the allowlist, policy seam, output cap and
 * `tool_calls` recording all apply unchanged, whichever provider answers.
 *
 * One endpoint per attempt, bound to 127.0.0.1 on a kernel-assigned port and
 * guarded by a random bearer token plus the same loopback Host/Origin checks
 * as sua's MCP server. It lives in the process running the node (dashboard,
 * CLI, scheduler, or Temporal worker), which already holds the stores the
 * tools need, and closes when the attempt ends.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { McpServer, createMcpHandler, fromJsonSchema } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildLoopbackAllowlist, checkAuthorization, checkHost, checkOrigin, type AuthCheckResult } from './http-auth.js';
import type { OpenAiTool, ToolCallExecutor } from './llm-tools.js';

export interface ToolEndpoint {
  /** e.g. http://127.0.0.1:53211/mcp */
  url: string;
  token: string;
  close(): Promise<void>;
}

export interface ToolEndpointOptions {
  /** Tool schemas to advertise; `function.name` is the MCP tool name. */
  tools: readonly OpenAiTool[];
  /** Dispatches a call by that same name (see `buildToolExecutor`). */
  execute: ToolCallExecutor;
}

/** The MCP server name claude sees; its tools appear as `mcp__sua__<tool>`. */
export const TOOL_ENDPOINT_SERVER_NAME = 'sua';

export async function startToolEndpoint(opts: ToolEndpointOptions): Promise<ToolEndpoint> {
  const token = randomBytes(32).toString('hex');

  const mcpHandler = toNodeHandler(createMcpHandler(() => {
    const server = new McpServer({ name: TOOL_ENDPOINT_SERVER_NAME, version: '1' });
    for (const tool of opts.tools) {
      const name = tool.function.name;
      server.registerTool(
        name,
        {
          description: tool.function.description ?? name,
          inputSchema: fromJsonSchema(tool.function.parameters as Parameters<typeof fromJsonSchema>[0]),
        },
        async (args: unknown) => {
          const res = await opts.execute(name, JSON.stringify(args ?? {}));
          return { content: [{ type: 'text' as const, text: res.content }], isError: res.isError === true };
        },
      );
    }
    return server;
  }, { legacy: 'stateless' }));

  let allowlist = buildLoopbackAllowlist(0);
  const reject = (res: ServerResponse, check: AuthCheckResult): boolean => {
    if (check.ok) return false;
    res.writeHead(check.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: check.error }));
    return true;
  };
  const header = (req: IncomingMessage, name: string): string | undefined => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const httpServer = createServer(async (req, res) => {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }
    if (reject(res, checkHost(req.headers.host, allowlist))) return;
    if (reject(res, checkOrigin(header(req, 'origin'), allowlist))) return;
    if (reject(res, checkAuthorization(header(req, 'authorization'), token))) return;
    try {
      await mcpHandler(req, res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  await new Promise<void>((resolve, reject_) => {
    httpServer.once('error', reject_);
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (httpServer.address() as AddressInfo).port;
  allowlist = buildLoopbackAllowlist(port);

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () => new Promise<void>((resolve) => {
      httpServer.closeAllConnections?.();
      httpServer.close(() => resolve());
    }),
  };
}
