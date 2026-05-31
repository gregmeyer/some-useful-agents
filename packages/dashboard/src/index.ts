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
  LayoutHintsStore,
  BlockedImgHostsStore,
  InboxStore,
  IntegrationsStore,
  PlannerTelemetryStore,
  PlannerLoopStepLogStore,
  PlannerMemoryStore,
  AgentMemoryStore,
  loadBuiltinPacks,
  defaultBuiltinPacksDir,
  LlmSettingsStore,
  VariablesStore,
  EncryptedFileStore,
  loadAgents,
  readMcpToken,
  getMcpTokenPath,
  rotateMcpToken,
  buildLoopbackAllowlist,
  reapOrphanedRuns,
  type SecretsStore,
  type Provider,
  type RunStatus,
  getSchedulerStatus,
} from '@some-useful-agents/core';
import type { DashboardContext } from './context.js';
import { getContext } from './context.js';
import { EncryptedFileSecretsSession } from './secrets-session.js';
import { requireAuth } from './auth-middleware.js';
import { buildDashboardErrorHandler } from './error-middleware.js';
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
import { imgBlockReportRouter } from './routes/img-block-report.js';
import { inboxRouter } from './routes/inbox.js';
import { inboxEventsRouter } from './routes/inbox-events.js';
import { InboxEventBus } from './lib/inbox-event-bus.js';
import { seedInboxDemoIfRequested } from './inbox-demo-seed.js';
import { pulseRouter } from './routes/pulse.js';
import { pulseLayoutPlanRouter } from './routes/pulse-layout-plan.js';
import { dashboardLayoutPlanRouter } from './routes/dashboard-layout-plan.js';
import { packsRouter } from './routes/packs.js';
import { scheduledRouter } from './routes/scheduled.js';
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
  /**
   * Path to the LLM settings JSON file (primary + fallback provider).
   * When unset, `/settings/llm` runs in read-only mode and the
   * dashboard skips threading fallback policy into `executeAgentDag`.
   */
  llmSettingsPath?: string;
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
  /**
   * Provider that backs "Run now" + run cancellation. Defaults to a
   * LocalProvider over `dbPath`. The CLI injects a TemporalProvider here when
   * `sua dashboard start --provider temporal` is used; tests inject a
   * LocalProvider directly.
   */
  provider?: Provider;
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
      // Widget surfaces every agent with a schedule (active + paused). The
      // previous active-only filter hid paused agents that the user might
      // want to resume, which was misleading — see #365. /scheduled is the
      // fuller management page; this widget is the at-a-glance summary.
      const scheduledAgents = agents.filter((a: { schedule?: string; status: string }) => a.schedule && (a.status === 'active' || a.status === 'paused'));

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
  app.use(imgBlockReportRouter);
  // SSE before the main inbox router so the more specific
  // `/inbox/:id/events` route resolves before any catch-all paths
  // in the inbox router try to claim it.
  app.use(inboxEventsRouter);
  app.use(inboxRouter);
  app.use(toolsRouter);
  app.use(nodesRouter);
  app.use(pulseRouter);
  app.use(pulseLayoutPlanRouter);
  app.use(dashboardLayoutPlanRouter);
  app.use(packsRouter);
  app.use(scheduledRouter);
  app.use(dashboardsEditRouter);
  app.use(dashboardsRouter);

  // Catch-all 404 for authenticated routes.
  app.use(async (req, res) => {
    const { renderNotFoundPage } = await import('./views/not-found.js');
    res.status(404).type('html').send(renderNotFoundPage({ path: req.originalUrl }));
  });

  // Express error handler — see error-middleware.ts for the contract.
  // Must be the LAST middleware registered.
  app.use(buildDashboardErrorHandler());

  return app;
}

/**
 * Bind an Express app, resolving only on a genuinely successful listen.
 *
 * Express's `app.listen(port, host, cb)` invokes the callback even when the
 * underlying bind fails (e.g. EADDRINUSE) — the returned server is left
 * unbound (`listening === false`, `address() === null`), and depending on
 * timing the failure can also surface as an uncaught `error` event. Keying
 * off the `listening` event instead means a port conflict reliably rejects,
 * so callers can handle it (see the EADDRINUSE branch in the CLI) rather than
 * appearing to start against a server that never bound.
 */
export function listenWithErrors(app: Application, port: number, host: string): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, host);
    s.once('error', reject);
    s.once('listening', () => {
      s.removeListener('error', reject);
      resolve(s);
    });
  });
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

  // Orphan reap. Any run still flagged `running` or `pending` at boot is, by
  // definition, an orphan — the only process that could be executing it is
  // this dashboard, and we just started fresh. A daemon restart / crash mid-
  // run leaves the row in non-terminal state forever; the in-memory
  // setTimeout(SIGTERM) armed inside the previous process died with it, and
  // the cancel route's activeRuns Map is empty. Finalize those rows so
  // dashboards stop polling and downstream notify/retry don't hang.
  //
  // PR C: when the node row carries a persisted childPid + childStartedAtMs,
  // the reaper additionally SIGKILLs the orphaned process after a ps-cross-
  // check defends against PID reuse. This stops the token bleed for orphans
  // still streaming to the Anthropic API at boot time.
  const reapResult = reapOrphanedRuns(runStore);
  if (reapResult.runsReaped > 0) {
    console.warn(
      `[orphan-reaper] Finalized ${reapResult.runsReaped} run(s) and ${reapResult.nodesReaped} node execution(s) ` +
      `(killed ${reapResult.pidsKilled} orphaned process(es)) ` +
      `left in non-terminal state by a prior dashboard exit. Run ids: ${reapResult.reapedRunIds.slice(0, 10).join(', ')}` +
      `${reapResult.reapedRunIds.length > 10 ? ` (+${reapResult.reapedRunIds.length - 10} more)` : ''}`,
    );
  }

  // AgentStore reads v2 DAG agents from the same runs.db file. Uses its own
  // DatabaseSync — avoids changing RunStore's constructor signature. WAL
  // mode makes concurrent handles safe.
  const agentStore = opts.agentStore ?? new AgentStore(opts.dbPath);
  const secretsStore = opts.secretsStore ?? new EncryptedFileStore(opts.secretsPath);
  // An injected provider (the CLI's createProvider, or a test's) arrives
  // already initialized — re-initializing a TemporalProvider would open a
  // second client connection. Only initialize the fallback we construct here.
  let provider = opts.provider;
  if (!provider) {
    provider = new LocalProvider(opts.dbPath, secretsStore, {
      allowUntrustedShell: opts.allowUntrustedShell,
    });
    await provider.initialize();
  }

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

  // LLM provider settings: primary + optional fallback. Threaded into
  // every executeAgentDag call so node-spawner can retry under the
  // fallback when the primary returns a recognized "should fall back"
  // error category.
  let llmSettingsStore: LlmSettingsStore | undefined;
  if (opts.llmSettingsPath) {
    llmSettingsStore = new LlmSettingsStore(opts.llmSettingsPath);
  }

  // Widget packs + dashboards stores. Same DB file as agents/runs/tools.
  let packsStore: PacksStore | undefined;
  let dashboardsStore: DashboardsStore | undefined;
  let layoutHintsStore: LayoutHintsStore | undefined;
  let blockedImgHostsStore: BlockedImgHostsStore | undefined;
  let inboxStore: InboxStore | undefined;
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

  // Layout hints store. Same DB file. Optional and independent from packs/
  // dashboards — renderers fall back to signal.size / outputWidget.tileFit
  // if this fails to come up.
  try {
    layoutHintsStore = new LayoutHintsStore(opts.dbPath);
  } catch {
    // Non-fatal: layout hints surface stays absent; renderers fall back.
  }

  // Blocked img-src telemetry. Same DB file. When the client CSP
  // listener can't reach this store, nothing renders — that's fine,
  // it's a UX nudge rather than a security feature.
  try {
    blockedImgHostsStore = new BlockedImgHostsStore(opts.dbPath);
  } catch {
    // Non-fatal: blocked-img suggestions just won't appear.
  }

  // Inbox store. Same DB file. The /inbox surface degrades to an
  // empty-state if the table can't be created.
  try {
    inboxStore = new InboxStore(opts.dbPath);
  } catch {
    // Non-fatal: /inbox renders empty state instead.
  }

  // Demo seed: when SUA_INBOX_DEMO=1, drop three sample rows (one per
  // priority) into an empty inbox so the page renders something
  // before real producers ship in PR 3. No-op without the env flag.
  seedInboxDemoIfRequested(inboxStore, agentStore);

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

  // Planner-loop step log (PR 2). Append-only per-primitive record so the
  // graph of "what the planner actually did this run" can be reconstructed
  // for debugging and metrics.
  let plannerLoopStepLogStore: PlannerLoopStepLogStore | undefined;
  try {
    plannerLoopStepLogStore = new PlannerLoopStepLogStore(opts.dbPath);
  } catch {
    // Non-fatal: step log stays absent if the table can't be created.
  }

  // Cross-run planner memory (PR 3). Read by the `understand` phase to
  // surface prior committed plans for similar goals.
  let plannerMemoryStore: PlannerMemoryStore | undefined;
  try {
    plannerMemoryStore = new PlannerMemoryStore(opts.dbPath);
  } catch {
    // Non-fatal: planner just doesn't see prior plans.
  }

  // Per-iteration agent memory (PR 4). Written by AgentLoopRunner when
  // an agent declares successCriteria. Non-fatal if unavailable.
  let agentMemoryStore: AgentMemoryStore | undefined;
  try {
    agentMemoryStore = new AgentMemoryStore(opts.dbPath);
  } catch {
    // Non-fatal: agent loop still runs, just doesn't persist iterations.
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
    llmSettingsStore,
    packsStore,
    dashboardsStore,
    layoutHintsStore,
    blockedImgHostsStore,
    inboxStore,
    // Streaming pub/sub for inbox conversation events. Powers the SSE
    // endpoint at GET /inbox/:id/events. Always instantiated — even
    // when inboxStore is unavailable the bus is a cheap empty Map,
    // and routes that don't have a store will short-circuit before
    // touching it.
    inboxEventBus: new InboxEventBus(),
    integrationsStore,
    plannerTelemetryStore,
    plannerLoopStepLogStore,
    plannerMemoryStore,
    agentMemoryStore,
    allowUntrustedShell: opts.allowUntrustedShell ?? new Set(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
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

  const server = await listenWithErrors(app, opts.port, host);

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
