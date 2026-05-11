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

/** Handle returned by `startMcpServer` so callers (tests, CLI) can shut down cleanly. */
export interface McpServerHandle {
  /**
   * The actual TCP port the server bound to. Same as `options.port` when
   * the caller asked for a specific port; the OS-assigned port when the
   * caller passed `port: 0`. Tests rely on the latter so each instance
   * gets a guaranteed-unique port and parallel runs don't collide on a
   * narrow random pool.
   */
  port: number;
  /** Stop accepting new connections, drain the provider, and close the http server. */
  shutdown(): Promise<void>;
}

export async function startMcpServer(options: McpServerOptions): Promise<McpServerHandle> {
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
  // Allowlist is reassigned once the server has actually bound — when
  // the caller passes `port: 0`, options.port is meaningless and we
  // need to authorize the kernel-assigned port instead. `let` so the
  // request-handler closure picks up the post-listen value.
  let allowlist = buildLoopbackAllowlist(options.port);

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

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, host, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  // Resolve the actual bound port. `options.port` may be 0 (OS chooses)
  // — `httpServer.address()` returns the kernel-assigned port we should
  // report to callers and log to the operator.
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : options.port;
  // Rebuild the Host/Origin allowlist now that we know the real port.
  // Skipping this when port=0 leaves the allowlist pointing at the
  // sentinel and every incoming request gets rejected with
  // `Host header "..." is not allowed`.
  if (actualPort !== options.port) {
    allowlist = buildLoopbackAllowlist(actualPort);
  }
  const displayHost = host === '0.0.0.0' || host === '::' ? '<all interfaces>' : host;
  console.log(`MCP server listening on http://${displayHost}:${actualPort}/mcp`);
  console.log(`Health check: http://${displayHost}:${actualPort}/health`);
  console.log(`Bearer token: ${tokenPath}`);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Stop accepting new connections + actively close existing ones via
    // closeAllConnections so the close-callback fires promptly even when
    // streamable-HTTP sessions left long-lived responses open. This is
    // intentionally simpler than calling McpServer.close() per session —
    // doing that races SDK transport teardown against the next test's
    // first request and surfaces as "other side closed" client errors.
    try { (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); } catch { /* ignore */ }
    sessions.clear();
    try { await provider.shutdown(); } catch { /* ignore */ }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await shutdown();
    process.exit(0);
  });

  return { port: actualPort, shutdown };
}
