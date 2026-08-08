import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import {
  AgentStore,
  LocalProvider,
  EncryptedFileStore,
  RunStore,
  VariablesStore,
  ensureMcpToken,
  getMcpTokenPath,
  type Provider,
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
  /**
   * Provider that backs the run/list/cancel MCP tools. Defaults to a
   * LocalProvider over `dbPath`. The CLI injects a TemporalProvider here when
   * `sua mcp start --provider temporal` is used.
   */
  provider?: Provider;
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
  // An injected provider (the CLI's createProvider) arrives already
  // initialized; only initialize the fallback we construct here.
  let provider = options.provider;
  if (!provider) {
    provider = new LocalProvider(options.dbPath, secretsStore);
    await provider.initialize();
  }

  // Dashboard-managed agents live in the SQLite DB, not on the filesystem.
  // Open dedicated handles here so the list/run tools see the full
  // catalog (mcp=true + status=active). Both stores use SQLite via
  // node:sqlite — multiple connections on the same DB are safe under
  // WAL, which the dashboard + scheduler combination already relies on.
  // VariablesStore sits at the conventional sibling path so {{vars.X}}
  // substitution works for MCP-triggered runs.
  const agentStore = new AgentStore(options.dbPath);
  const runStore = new RunStore(options.dbPath);
  const dataRoot = dirname(options.dbPath);
  const variablesStore = (() => {
    try { return new VariablesStore(`${dataRoot}/.sua/variables.json`); }
    catch { return undefined; }
  })();

  // MCP 2026-07-28 is a STATELESS protocol: there is no `initialize`
  // handshake to pin, no `Mcp-Session-Id`, and no long-lived server↔transport
  // coupling. `createMcpHandler` builds a fresh McpServer per request via this
  // factory, so the old session Map / session-to-token binding is gone —
  // every request re-runs the auth gate below instead. `legacy: 'stateless'`
  // keeps serving 2025-era clients (e.g. existing Claude Desktop installs)
  // over the same endpoint. Stores are shared across requests via closure;
  // each store handles its own concurrency.
  const mcpHandler = toNodeHandler(
    createMcpHandler(() => {
      const s = new McpServer({ name: 'some-useful-agents', version: '0.26.0' });
      registerTools(s, {
        provider,
        agentStore,
        runStore,
        secretsStore,
        variablesStore,
        dataRoot,
        agentDirs: options.agentDirs,
      });
      return s;
    }, { legacy: 'stateless' }),
  );

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
      res.end(JSON.stringify({ status: 'ok' }));
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

    // Phase 3: Bearer token. Runs on every request — the stateless protocol
    // has no session to hijack, so per-request auth fully replaces the old
    // session-to-token binding.
    const auth = req.headers.authorization;
    const authHeader = Array.isArray(auth) ? auth[0] : auth;
    if (rejectIfNotOk(res, checkAuthorization(authHeader, token))) return;

    // Auth passed — hand the request to the stateless MCP handler. It owns
    // method dispatch (POST/GET) and serves both 2025 and 2026-07-28 clients.
    await mcpHandler(req, res);
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
    // streamable-HTTP responses left long-lived responses open.
    try { (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.(); } catch { /* ignore */ }
    try { await provider.shutdown(); } catch { /* ignore */ }
    try { runStore.close(); } catch { /* ignore */ }
    try { agentStore.close(); } catch { /* ignore */ }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await shutdown();
    process.exit(0);
  });

  return { port: actualPort, shutdown };
}
