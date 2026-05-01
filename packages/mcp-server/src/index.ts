import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import {
  LocalProvider,
  EncryptedFileStore,
  ensureMcpToken,
  getMcpTokenPath,
} from '@some-useful-agents/core';
import {
  buildLoopbackAllowlist,
  checkAuthorization,
  checkHost,
  checkOrigin,
  type AuthCheckResult,
} from './auth.js';
import { registerTools } from './tools.js';

export interface McpServerOptions {
  /** TCP port to listen on. */
  port: number;
  /**
   * Bind host. Defaults to '127.0.0.1'. Set to '0.0.0.0' (or another IP) only
   * if you genuinely need LAN exposure — non-loopback binds also bypass the
   * loopback Host/Origin checks below for those addresses, so be careful.
   */
  host?: string;
  agentDirs: string[];
  dbPath: string;
  secretsPath: string;
  /**
   * Optional explicit path to the bearer-token file. Defaults to
   * `~/.sua/mcp-token`. The file is auto-created on startup with mode 0o600
   * if it does not exist.
   */
  tokenPath?: string;
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  /**
   * The McpServer this transport is connected to. The MCP SDK requires a
   * fresh `McpServer` per transport — calling `connect()` twice on the same
   * server throws "Already connected to a transport". Each session gets its
   * own; on session DELETE we close it to release the listener handlers.
   */
  server: McpServer;
  /** sha256(token) at the time the session was created. Pins this session to that token. */
  tokenHash: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function rejectIfNotOk(res: ServerResponse, check: AuthCheckResult): boolean {
  if (check.ok) return false;
  send(res, check.status, { error: check.error });
  return true;
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const host = options.host ?? '127.0.0.1';
  const tokenPath = options.tokenPath ?? getMcpTokenPath();

  // Ensure a bearer token exists. ensureMcpToken is idempotent.
  const { token, created } = ensureMcpToken(tokenPath);
  if (created) {
    console.log(`Generated MCP bearer token at ${tokenPath} (mode 0600).`);
  }

  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    console.warn(
      `[warning] MCP binding to non-loopback host "${host}". The bearer token ` +
        `is your only defense against remote callers — keep ${tokenPath} secret.`,
    );
  }

  const secretsStore = new EncryptedFileStore(options.secretsPath);
  const provider = new LocalProvider(options.dbPath, secretsStore);
  await provider.initialize();

  // Each MCP session gets its own McpServer instance. The SDK couples a
  // server 1:1 with a transport — calling `server.connect()` twice on the
  // same instance throws. Provider + agentDirs are safe to share across
  // sessions (provider has its own concurrency; agentDirs is read-only).
  const buildSessionServer = (): McpServer => {
    const s = new McpServer({ name: 'some-useful-agents', version: '0.3.2' });
    registerTools(s, provider, options.agentDirs);
    return s;
  };

  const sessions = new Map<string, SessionEntry>();
  const allowlist = buildLoopbackAllowlist(options.port);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${host}:${options.port}`);

    if (url.pathname === '/health') {
      // Health is intentionally unauthenticated and does not check Host/Origin
      // so monitoring tools can hit it. It returns no sensitive data.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }

    // Phase 1: Host header (defends against DNS rebinding into the bound
    // interface and is belt-and-suspenders for non-loopback binds).
    if (rejectIfNotOk(res, checkHost(req.headers.host, allowlist))) return;

    // Phase 2: Origin header (the actual DNS-rebinding defense — blocks
    // browsers that resolved a public hostname to 127.0.0.1).
    const origin = req.headers.origin;
    const originHeader = Array.isArray(origin) ? origin[0] : origin;
    if (rejectIfNotOk(res, checkOrigin(originHeader, allowlist))) return;

    // Phase 3: Bearer token.
    const auth = req.headers.authorization;
    const authHeader = Array.isArray(auth) ? auth[0] : auth;
    if (rejectIfNotOk(res, checkAuthorization(authHeader, token))) return;

    const requestTokenHash = hashToken(token); // We just verified equality, so this is the request's token hash.
    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    if (req.method === 'POST') {
      let entry: SessionEntry | undefined;

      if (sessionId && sessions.has(sessionId)) {
        entry = sessions.get(sessionId)!;
        // Session-to-token binding: a rotated token must not let an attacker
        // hijack a still-live session created under the previous token.
        if (entry.tokenHash !== requestTokenHash) {
          send(res, 401, { error: 'Session does not match presented bearer token' });
          return;
        }
      } else {
        const newSessionId = randomUUID();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newSessionId,
        });
        const sessionServer = buildSessionServer();
        entry = { transport, server: sessionServer, tokenHash: requestTokenHash };
        sessions.set(newSessionId, entry);
        await sessionServer.connect(transport);
      }

      await entry.transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'GET') {
      if (!sessionId || !sessions.has(sessionId)) {
        send(res, 400, { error: 'No session. Send a POST first.' });
        return;
      }
      const entry = sessions.get(sessionId)!;
      if (entry.tokenHash !== requestTokenHash) {
        send(res, 401, { error: 'Session does not match presented bearer token' });
        return;
      }
      await entry.transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'DELETE') {
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const entry = sessions.get(sessionId)!;
      if (entry.tokenHash !== requestTokenHash) {
        send(res, 401, { error: 'Session does not match presented bearer token' });
        return;
      }
      await entry.transport.handleRequest(req, res);
      // Release the per-session McpServer's listener handlers. Best effort —
      // McpServer.close() may or may not exist depending on SDK version.
      try { await entry.server.close?.(); } catch { /* ignore */ }
      sessions.delete(sessionId);
      return;
    }

    res.writeHead(405);
    res.end();
  });

  httpServer.listen(options.port, host, () => {
    const displayHost = host === '0.0.0.0' || host === '::' ? '<all interfaces>' : host;
    console.log(`MCP server listening on http://${displayHost}:${options.port}/mcp`);
    console.log(`Health check: http://${displayHost}:${options.port}/health`);
    console.log(`Bearer token: ${tokenPath}`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await provider.shutdown();
    httpServer.close();
    process.exit(0);
  });
}
