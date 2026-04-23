import express, { type Application } from 'express';
import type { Server } from 'node:http';
import { dirname } from 'node:path';
import {
  LocalProvider,
  RunStore,
  AgentStore,
  ToolStore,
  VariablesStore,
  EncryptedFileStore,
  loadAgents,
  readMcpToken,
  getMcpTokenPath,
  rotateMcpToken,
  buildLoopbackAllowlist,
  type SecretsStore,
  type RunStatus,
  getSchedulerStatus,
} from '@some-useful-agents/core';
import type { DashboardContext } from './context.js';
import { getContext } from './context.js';
import { EncryptedFileSecretsSession } from './secrets-session.js';
import { requireAuth } from './auth-middleware.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { agentsRouter } from './routes/agents.js';
import { agentNodesRouter } from './routes/agent-nodes.js';
import { agentInputsRouter } from './routes/agent-inputs.js';
import { runsRouter } from './routes/runs.js';
import { runNowRouter } from './routes/run-now.js';
import { buildRouter } from './routes/run-now-build.js';
import { runMutationsRouter } from './routes/run-mutations.js';
import { toolsRouter } from './routes/tools.js';
import { assetsRouter } from './routes/assets.js';
import { outputFilesRouter } from './routes/output-files.js';
import { settingsRouter } from './routes/settings.js';
import { helpRouter } from './routes/help.js';
import { versionsRouter } from './routes/versions.js';
import { pulseRouter } from './routes/pulse.js';

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
  /** Path to the plain-text global variables file (.sua/variables.json). */
  variablesPath?: string;
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
  /** Builds the one-time auth URL: http://host:port/auth#token=<...>. */
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
  app.use(express.json());

  // Security headers on all responses.
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://img.youtube.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-src 'self' https://www.youtube.com; frame-ancestors 'none'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Public routes (no auth).
  app.use(healthRouter);
  app.use(authRouter);
  // Static assets (cytoscape.js + graph-render.js). Unauth so the auth
  // page itself could embed them if needed; the content is nonsecret
  // library code and a tiny bootstrap script.
  app.use(assetsRouter);

  // Everything below requires the session cookie.
  app.use(requireAuth);

  // Serve agent output files from allowlisted directories.
  app.use(outputFilesRouter);

  // Home page with today's stats + recent activity (paginated).
  app.get('/', (req, res) => {
    // Dynamic import to avoid circular deps at module load.
    import('./views/home.js').then(({ renderHomePage }) => {
      const ctx = getContext(req.app.locals);
      const agents = ctx.agentStore.listAgents();
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      // Activity feed pagination.
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.max(1, Math.min(50, parseInt(req.query.pageSize as string, 10) || 10));
      const offset = (page - 1) * pageSize;

      const recentResult = ctx.runStore.queryRuns({ limit: pageSize, offset, statuses: [] as RunStatus[] });
      // Separate query for today's stats (always from the start, not paginated).
      const todayResult = ctx.runStore.queryRuns({ limit: 200, offset: 0, statuses: [] as RunStatus[] });
      const inFlightResult = ctx.runStore.queryRuns({ limit: 20, offset: 0, statuses: ['running', 'pending'] as RunStatus[] });
      const todayRuns = todayResult.rows.filter((r: { startedAt: string }) => r.startedAt >= todayStart);
      const scheduledAgents = agents.filter((a: { schedule?: string; status: string }) => a.schedule && a.status === 'active');

      // Scheduler status from heartbeat file.
      const { status: schedulerStatus, heartbeat: schedulerHeartbeat } = getSchedulerStatus(ctx.dataDir);

      // Last scheduled fire per agent.
      const lastScheduledFires: Record<string, string> = {};
      for (const a of scheduledAgents) {
        const result = ctx.runStore.queryRuns({ agentName: a.id, triggeredBy: 'schedule', limit: 1 });
        if (result.rows[0]?.startedAt) lastScheduledFires[a.id] = result.rows[0].startedAt;
      }

      res.type('html').send(renderHomePage({
        agents,
        recentRuns: recentResult.rows,
        todayRuns,
        inFlightRuns: inFlightResult.rows,
        scheduledAgents,
        activityPage: page,
        activityPageSize: pageSize,
        totalRunCount: recentResult.total,
        schedulerStatus,
        schedulerHeartbeat,
        lastScheduledFires,
      }));
    }).catch(() => {
      res.redirect(302, '/agents');
    });
  });

  app.use(agentsRouter);
  app.use(agentNodesRouter);
  app.use(agentInputsRouter);
  app.use(runsRouter);
  app.use(runNowRouter);
  app.use(buildRouter);
  app.use(runMutationsRouter);
  app.use(settingsRouter);
  app.use(helpRouter);
  app.use(versionsRouter);
  app.use(toolsRouter);
  app.use(pulseRouter);

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

  // Global variables store (plain-text, non-sensitive).
  let variablesStore: VariablesStore | undefined;
  if (opts.variablesPath) {
    variablesStore = new VariablesStore(opts.variablesPath);
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
    variablesStore,
    allowUntrustedShell: opts.allowUntrustedShell ?? new Set(),
    activeRuns: new Map(),
    dataDir: dirname(opts.dbPath),
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

  const authUrl = `http://${host}:${opts.port}/auth#token=${token}`;

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
