import express, { type Application } from 'express';
import type { Server } from 'node:http';
import {
  LocalProvider,
  RunStore,
  AgentStore,
  ToolStore,
  EncryptedFileStore,
  loadAgents,
  readMcpToken,
  getMcpTokenPath,
  rotateMcpToken,
  buildLoopbackAllowlist,
  type SecretsStore,
} from '@some-useful-agents/core';
import type { DashboardContext } from './context.js';
import { EncryptedFileSecretsSession } from './secrets-session.js';
import { requireAuth } from './auth-middleware.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { agentsRouter } from './routes/agents.js';
import { runsRouter } from './routes/runs.js';
import { runNowRouter } from './routes/run-now.js';
import { runMutationsRouter } from './routes/run-mutations.js';
import { toolsRouter } from './routes/tools.js';
import { assetsRouter } from './routes/assets.js';
import { settingsRouter } from './routes/settings.js';
import { helpRouter } from './routes/help.js';
import { versionsRouter } from './routes/versions.js';

export interface StartDashboardOptions {
  port: number;
  /** Bind host. Defaults to '127.0.0.1'. Non-loopback emits a warning. */
  host?: string;
  /** Agent source directories. Typically `getAgentDirs(config).all`. */
  agentDirs: string[];
  /** Path to the run store SQLite DB. */
  dbPath: string;
  /** Path to the encrypted secrets file. */
  secretsPath: string;
  /** Path to the bearer token file. Defaults to `~/.sua/mcp-token`. */
  tokenPath?: string;
  /** Community shell agents the operator has pre-allowed. */
  allowUntrustedShell?: Set<string>;
  /** Run-history retention in days (shown on /settings/general). Defaults to 30. */
  retentionDays?: number;
  /** Optional SecretsStore override (tests). */
  secretsStore?: SecretsStore;
  /** Optional LocalProvider override (tests). */
  provider?: LocalProvider;
  /** Optional RunStore override (tests). */
  runStore?: RunStore;
  /** Optional AgentStore override (tests). */
  agentStore?: AgentStore;
  /** Optional token override (tests). */
  token?: string;
}

export interface DashboardHandle {
  server: Server;
  /** Builds the one-time auth URL: http://host:port/auth?token=<...>. */
  authUrl: string;
  close(): Promise<void>;
}

/**
 * Create and configure the Express app without starting an HTTP listener.
 * Exported so tests can drive it via supertest.
 */
export function buildDashboardApp(ctx: DashboardContext): Application {
  const app = express();
  app.locals = ctx as unknown as Application['locals'];

  app.use(express.urlencoded({ extended: false }));

  // Public routes (no auth).
  app.use(healthRouter);
  app.use(authRouter);
  // Static assets (cytoscape.js + graph-render.js). Unauth so the auth
  // page itself could embed them if needed; the content is nonsecret
  // library code and a tiny bootstrap script.
  app.use(assetsRouter);

  // Everything below requires the session cookie.
  app.use(requireAuth);

  // Home → /agents.
  app.get('/', (_req, res) => { res.redirect(302, '/agents'); });

  app.use(agentsRouter);
  app.use(runsRouter);
  app.use(runNowRouter);
  app.use(runMutationsRouter);
  app.use(settingsRouter);
  app.use(helpRouter);
  app.use(versionsRouter);
  app.use(toolsRouter);

  // Catch-all 404 for authenticated routes.
  app.use((_req, res) => {
    res.status(404).type('html').send('<p>Not found. <a href="/agents">Back</a></p>');
  });

  return app;
}

export async function startDashboardServer(opts: StartDashboardOptions): Promise<DashboardHandle> {
  const host = opts.host ?? '127.0.0.1';
  const tokenPath = opts.tokenPath ?? getMcpTokenPath();

  const token = opts.token ?? readMcpToken(tokenPath);
  if (!token) {
    throw new Error(
      `No MCP token at ${tokenPath}. Run \`sua init\` or \`sua mcp rotate-token\` first; ` +
      `the dashboard shares the MCP bearer token.`,
    );
  }

  const runStore = opts.runStore ?? new RunStore(opts.dbPath);
  // AgentStore reads v2 DAG agents from the same runs.db file. Uses its own
  // DatabaseSync — avoids changing RunStore's constructor signature. WAL
  // mode makes concurrent handles safe.
  const agentStore = opts.agentStore ?? new AgentStore(opts.dbPath);
  const secretsStore = opts.secretsStore ?? new EncryptedFileStore(opts.secretsPath);
  const provider = opts.provider ?? new LocalProvider(opts.dbPath, secretsStore, {
    allowUntrustedShell: opts.allowUntrustedShell,
  });
  await provider.initialize();

  const secretsSession = new EncryptedFileSecretsSession(opts.secretsPath);
  // Tool store shares the same DB path. WAL mode makes concurrent handles safe.
  let toolStore: ToolStore | undefined;
  try {
    toolStore = new ToolStore(opts.dbPath);
  } catch {
    // Non-fatal: tools surface degrades to built-ins only.
  }

  const ctx: DashboardContext = {
    token,
    allowlist: buildLoopbackAllowlist(opts.port),
    port: opts.port,
    provider,
    runStore,
    agentStore,
    loadAgents: () => loadAgents({ directories: opts.agentDirs }),
    secretsStore,
    secretsSession,
    tokenPath,
    retentionDays: opts.retentionDays ?? 30,
    dbPath: opts.dbPath,
    secretsPath: opts.secretsPath,
    rotateToken: () => rotateMcpToken(tokenPath),
    toolStore,
    allowUntrustedShell: opts.allowUntrustedShell ?? new Set(),
  };

  const app = buildDashboardApp(ctx);

  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    console.warn(
      `[warning] Dashboard binding to non-loopback host "${host}". The bearer token ` +
      `is your only defense against remote callers — keep ${tokenPath} secret.`,
    );
  }

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(opts.port, host, () => resolve(s));
  });

  const authUrl = `http://${host}:${opts.port}/auth?token=${token}`;

  return {
    server,
    authUrl,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await provider.shutdown();
      runStore.close();
      agentStore.close();
    },
  };
}

export { buildDashboardApp as _buildDashboardApp };
export type { DashboardContext } from './context.js';
