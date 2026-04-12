import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { LocalProvider, loadAgents } from '@some-useful-agents/core';
import { registerTools } from './tools.js';

export interface McpServerOptions {
  port: number;
  agentDirs: string[];
  dbPath: string;
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const provider = new LocalProvider(options.dbPath);
  await provider.initialize();

  const server = new McpServer({
    name: 'some-useful-agents',
    version: '0.1.0',
  });

  registerTools(server, provider, options.agentDirs);

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${options.port}`);

    if (url.pathname === '/mcp') {
      if (req.method === 'POST') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports.has(sessionId)) {
          transport = transports.get(sessionId)!;
        } else {
          const newSessionId = randomUUID();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newSessionId,
          });
          transports.set(newSessionId, transport);
          await server.connect(transport);
        }

        await transport.handleRequest(req, res);
      } else if (req.method === 'GET') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No session. Send a POST first.' }));
        }
      } else if (req.method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          transports.delete(sessionId);
        } else {
          res.writeHead(404);
          res.end();
        }
      } else {
        res.writeHead(405);
        res.end();
      }
    } else if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: transports.size }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  httpServer.listen(options.port, () => {
    console.log(`MCP server listening on http://localhost:${options.port}/mcp`);
    console.log(`Health check: http://localhost:${options.port}/health`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await provider.shutdown();
    httpServer.close();
    process.exit(0);
  });
}
