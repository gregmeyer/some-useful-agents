import express, { type Application } from 'express';
import type { Server } from 'node:http';
import { dirname } from 'node:path';
import {
  LocalProvider,
  RunStore,
  AgentStore,
  ToolStore,
  PacksStore,
  DashboardsStore,
  IntegrationsStore,
  PlannerTelemetryStore,
  loadBuiltinPacks,
  defaultBuiltinPacksDir,
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
import { agentInstallRouter } from './routes/agent-install.js';
import { agentNodesRouter } from './routes/agent-nodes.js';
import { agentInputsRouter } from './routes/agent-inputs.js';
import { runsRouter } from './routes/runs.js';
import { runNowRouter } from './routes/run-now.js';
import { buildRouter } from './routes/run-now-build.js';
import { metricsPlannerRouter } from './routes/metrics-planner.js';
import { runMutationsRouter } from './routes/run-mutations.js';
import { widgetRunRouter } from './routes/widget-run.js';
import { toolsRouter } from './routes/tools.js';
import { nodesRouter } from './routes/nodes.js';
import { assetsRouter } from './routes/assets.js';
import { outputFilesRouter } from './routes/output-files.js';
import { settingsRouter } from './routes/settings.js';
import { settingsMcpRouter } from './routes/settings-mcp.js';
import { helpRouter } from './routes/help.js';
import { versionsRouter } from './routes/versions.js';
import { pulseRouter } from './routes/pulse.js';
import { packsRouter } from './routes/packs.js';
import { dashboardsRouter } from './routes/dashboards.js';
import { dashboardsEditRouter } from './routes/dashboards-edit.js';

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
  /**
   * Public base URL the dashboard is reachable at. Used to build clickable
   * run links inside notify handler payloads (Slack, etc). Falls back to
   * `http://<host>:<port>` if unset.
   */
  dashboardBaseUrl?: string;
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
  //
  // The img-src directive starts with the dashboard's baseline hosts
  // (the iframe sanitizer's IFRAME_ALLOWED_HOSTS allowlist — see
  // packages/core/src/html-sanitizer.ts; mirror additions in both
  // places) and is widened by every active agent's
  // `permissions.imgSrc` declarations so widgets can render images
  // from external services they explicitly opt into. Computed per
  // request because the agent set can change at runtime; cost is one
  // sqlite scan + a join, negligible for local-first.
  const BASE_IMG_SRC = ["'self'", 'data:', 'https://img.youtube.com', 'https://i.vimeocdn.com'];
  // Cache the computed img-src for 5s. Pulse pages and asset requests
  // hit the middleware many times per page load — recomputing every
  // time means listAgents() per request, which is wasteful even on a
  // local sqlite. 5s is short enough that newly-installed agents
  // light up after one polling tick without manual invalidation.
  let cachedImgSrc = '';
  let cachedAt = 0;
  const computeImgSrc = (): string => {
    if (Date.now() - cachedAt < 5000 && cachedImgSrc) return cachedImgSrc;
    const declared = new Set<string>();
    try {
      for (const a of ctx.agentStore.listAgents()) {
        for (const host of a.permissions?.imgSrc ?? []) declared.add(`https://${host}`);
      }
    } catch { /* agent store unavailable — fall back to baseline */ }
    cachedImgSrc = [...BASE_IMG_SRC, ...Array.from(declared).sort()].join(' ');
    cachedAt = Date.now();
    return cachedImgSrc;
  };
  app.use((_req, res, next) => {
    const imgSrc = computeImgSrc();
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src ${imgSrc}; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'`,
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

  // Output files: behind requireAuth (so auth works properly), but
  // removes X-Frame-Options so the preview iframe can embed content.
  app.use((req, res, next) => {
    if (req.path === '/output-file') {
      res.removeHeader('X-Frame-Options');
    }
    next();
  });
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

      const availableDashboards = ctx.dashboardsStore
        ? ctx.dashboardsStore.listDashboards().filter((d) => !d.packId).map((d) => ({ id: d.id, name: d.name }))
        : [];

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
        availableDashboards,
      }));
    }).catch(() => {
      res.redirect(302, '/agents');
    });
  });

  app.use(agentInstallRouter);
  app.use(agentsRouter);
  app.use(agentNodesRouter);
  app.use(agentInputsRouter);
  app.use(runsRouter);
  app.use(runNowRouter);
  app.use(buildRouter);
  app.use(metricsPlannerRouter);
  app.use(runMutationsRouter);
  app.use(widgetRunRouter);
  app.use(settingsMcpRouter);
  app.use(settingsRouter);
  app.use(helpRouter);
  app.use(versionsRouter);
  app.use(toolsRouter);
  app.use(nodesRouter);
  app.use(pulseRouter);
  app.use(packsRouter);
  app.use(dashboardsEditRouter);
  app.use(dashboardsRouter);

  // Catch-all 404 for authenticated routes.
  app.use(async (req, res) => {
    const { renderNotFoundPage } = await import('./views/not-found.js');
    res.status(404).type('html').send(renderNotFoundPage({ path: req.originalUrl }));
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

  // Widget packs + dashboards stores. Same DB file as agents/runs/tools.
  let packsStore: PacksStore | undefined;
  let dashboardsStore: DashboardsStore | undefined;
  try {
    packsStore = new PacksStore(opts.dbPath);
    dashboardsStore = new DashboardsStore(opts.dbPath);
    // Discover and register bundled packs. Idempotent — re-running on each
    // restart picks up version/manifest changes without toggling install state.
    // Failures here are non-fatal: a broken pack manifest shouldn't gate the
    // dashboard from coming up.
    try {
      loadBuiltinPacks(packsStore, defaultBuiltinPacksDir());
    } catch { /* ignore — packs discovery is best-effort */ }
  } catch {
    // Non-fatal: packs/dashboards surface stays absent until later PRs
    // wire routes that depend on these stores.
  }

  // Integrations store. Same DB file. Independently optional from packs/
  // dashboards so a schema issue in either doesn't keep the other offline.
  let integrationsStore: IntegrationsStore | undefined;
  try {
    integrationsStore = new IntegrationsStore(opts.dbPath);
  } catch {
    // Non-fatal: settings/integrations surface stays absent.
  }


  // Planner telemetry store. Records one row per planner run; feeds /metrics/planner.
  let plannerTelemetryStore: PlannerTelemetryStore | undefined;
  try {
    plannerTelemetryStore = new PlannerTelemetryStore(opts.dbPath);
  } catch {
    // Non-fatal: telemetry stays absent if the table can't be created.
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
    packsStore,
    dashboardsStore,
    integrationsStore,
    plannerTelemetryStore,
    allowUntrustedShell: opts.allowUntrustedShell ?? new Set(),
    activeRuns: new Map(),
    dataDir: dirname(opts.dbPath),
    dashboardBaseUrl: (opts.dashboardBaseUrl ?? `http://${host}:${opts.port}`).replace(/\/$/, ''),
  };

  const app = buildDashboardApp(ctx);

  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    console.warn(
      `[warning] Dashboard binding to non-loopback host "${host}". The bearer token ` +
      `is your only defense against remote callers — keep ${tokenPath} secret.`,
    );
  }

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(opts.port, host, () => {
      s.removeListener('error', reject);
      resolve(s);
    });
    // Without this, EADDRINUSE (and other listen failures) emit on the
    // server but never reach the awaiter — the promise hangs and the
    // caller prints its banner against a server that didn't actually bind.
    s.once('error', (err) => reject(err));
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
