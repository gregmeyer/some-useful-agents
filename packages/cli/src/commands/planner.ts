/**
 * `sua planner smoke` — automated planner pipeline smoke tests.
 *
 * Hits a running daemon's HTTP endpoints, walks each scenario's poll +
 * (optional) commit flow, then asserts against the planner_telemetry row
 * and against the response shapes the wizard expects. Real LLM calls are
 * gated behind --live so neither CI nor a stray invocation burns budget.
 *
 * Scenarios live in planner-scenarios.ts (server-side) and
 * planner-browser.ts (playwright); this file owns the runner, the report,
 * and the small set of helpers (pollUntilDone, withCleanup, assertTelemetry)
 * that the scenarios share.
 */

import { Command } from 'commander';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import {
  AgentStore,
  DashboardsStore,
  PlannerTelemetryStore,
  readMcpToken,
  type PlannerTelemetryRow,
} from '@some-useful-agents/core';
import { loadConfig, getDbPath, getDashboardBaseUrl } from '../config.js';
import * as ui from '../ui.js';
import { SERVER_SCENARIOS, type ServerScenario } from './planner-scenarios.js';
import { loadBrowserScenarios } from './planner-browser.js';

export const plannerCommand = new Command('planner')
  .description('Build-planner pipeline tooling (smoke tests, future: replay)');

// ── Shared types ───────────────────────────────────────────────────────

export interface SmokeContext {
  baseUrl: string;
  /** Open shared DB connection — closed by the runner after all scenarios. */
  db: DatabaseSync;
  agentStore: AgentStore;
  dashboardsStore: DashboardsStore;
  telemetryStore: PlannerTelemetryStore;
  /**
   * Bearer token for the dashboard's session cookie. The dashboard reuses
   * the MCP token via `requireAuth` — without it every /agents/build call
   * fails with "Missing session cookie". Token is read once at runner
   * startup; the helpers below thread it onto every request.
   */
  authCookie?: string;
}

export interface ScenarioResult {
  scenarioId: number;
  name: string;
  passed: boolean;
  /** Why we decided pass/fail — surfaces in the report so the user can act. */
  reason: string;
  durationMs: number;
  /** Optional planner runId the scenario produced; rendered in the report
   *  so the user can drill into /metrics/planner. */
  rootRunId?: string;
}

// ── HTTP helpers ───────────────────────────────────────────────────────

interface BuildPollResponse {
  ok: boolean;
  status?: 'running' | 'retrying' | 'done' | 'failed' | 'not_found';
  phase?: string;
  runId?: string;
  attempt?: number;
  plan?: unknown;
  yaml?: string;
  agentId?: string;
  agentName?: string;
  yamlError?: string;
  criticErrors?: Array<{ path: string; message: string }>;
  criticWarning?: string;
  error?: string;
}

/**
 * Poll GET /agents/build/:runId until the planner reaches a terminal
 * state. Tracks the full chain of runIds (one per critic retry) so
 * scenarios can assert on retry behaviour. Returns the *final* response
 * plus the chain.
 *
 * `maxMs` is wall-clock; default 5 min covers a 3-attempt scenario with
 * reasonable Claude latency. Polling cadence matches the wizard's 2 s.
 */
export async function pollUntilDone(
  baseUrl: string,
  initialRunId: string,
  maxMs = 300_000,
  pollIntervalMs = 2000,
  authCookie?: string,
): Promise<{ final: BuildPollResponse; chain: string[]; retries: number }> {
  const start = Date.now();
  const chain: string[] = [initialRunId];
  let runId = initialRunId;
  let retries = 0;

  while (Date.now() - start < maxMs) {
    const res = await fetch(`${baseUrl}/agents/build/${encodeURIComponent(runId)}`, {
      headers: cookieHeader(authCookie),
    });
    const data = (await res.json()) as BuildPollResponse;

    if (data.status === 'running') {
      await sleep(pollIntervalMs);
      continue;
    }
    if (data.status === 'retrying' && data.runId) {
      retries += 1;
      runId = data.runId;
      chain.push(runId);
      await sleep(pollIntervalMs);
      continue;
    }
    return { final: data, chain, retries };
  }
  return {
    final: { ok: false, status: 'failed', error: `pollUntilDone timed out after ${maxMs}ms` },
    chain,
    retries,
  };
}

/** POST /agents/build — kick off a planner run. Returns the runId. */
export async function startBuild(
  baseUrl: string,
  goal: string,
  focus?: string,
  authCookie?: string,
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const res = await fetch(`${baseUrl}/agents/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cookieHeader(authCookie) },
    body: JSON.stringify({ goal, ...(focus ? { focus } : {}) }),
  });
  return res.json() as Promise<{ ok: boolean; runId?: string; error?: string }>;
}

/** POST /agents/build/commit — finalise the plan. */
export interface CommitResponse {
  ok: boolean;
  agentsCreated?: string[];
  agentsSkipped?: Array<{ id: string; reason: string }>;
  dashboardCreated?: string | null;
  dashboardError?: string;
  error?: string;
}

export async function commitPlan(
  baseUrl: string,
  plan: unknown,
  plannerRunId: string,
  authCookie?: string,
): Promise<CommitResponse> {
  const res = await fetch(`${baseUrl}/agents/build/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cookieHeader(authCookie) },
    body: JSON.stringify({ plan, plannerRunId }),
  });
  return res.json() as Promise<CommitResponse>;
}

/**
 * Build the `Cookie:` header for authenticated requests. Returns an
 * empty object when the caller didn't supply a token (smoke command will
 * have already failed startup if the token couldn't be read).
 */
function cookieHeader(token: string | undefined): Record<string, string> {
  return token ? { Cookie: `sua_dashboard_session=${token}` } : {};
}

// ── Telemetry assertion helper ──────────────────────────────────────────

export interface TelemetryExpectation {
  /** Lower bound on plan_attempts. Use 1 for first-try scenarios, 2+ for retries. */
  minAttempts?: number;
  maxAttempts?: number;
  extractStatus?: PlannerTelemetryRow['planExtractStatus'];
  /** When set: expect committed_at to be (non-)null. */
  committed?: boolean;
  minValidationErrors?: number;
}

/**
 * Read the telemetry row for `runId` (resolving alias chains) and
 * compare it against `expect`. Returns null on PASS, or a human-readable
 * mismatch description on FAIL.
 */
export function assertTelemetry(
  store: PlannerTelemetryStore,
  runId: string,
  expect: TelemetryExpectation,
): string | null {
  const rootId = store.resolveOriginalRunId(runId);
  const row = store.get(rootId);
  if (!row) return `no planner_telemetry row for ${rootId}`;

  if (expect.minAttempts != null && row.planAttempts < expect.minAttempts) {
    return `planAttempts=${row.planAttempts}, expected >= ${expect.minAttempts}`;
  }
  if (expect.maxAttempts != null && row.planAttempts > expect.maxAttempts) {
    return `planAttempts=${row.planAttempts}, expected <= ${expect.maxAttempts}`;
  }
  if (expect.extractStatus && row.planExtractStatus !== expect.extractStatus) {
    return `planExtractStatus=${row.planExtractStatus}, expected ${expect.extractStatus}`;
  }
  if (expect.committed === true && row.committedAt == null) {
    return `committedAt is null, expected populated`;
  }
  if (expect.committed === false && row.committedAt != null) {
    return `committedAt=${row.committedAt}, expected null`;
  }
  if (expect.minValidationErrors != null && row.planValidationErrors < expect.minValidationErrors) {
    return `planValidationErrors=${row.planValidationErrors}, expected >= ${expect.minValidationErrors}`;
  }
  return null;
}

// ── Cleanup helper ──────────────────────────────────────────────────────

export interface CleanupSnapshot {
  agentIds: Set<string>;
  dashboardIds: Set<string>;
}

/** Snapshot the current set of agent + dashboard IDs. */
export function snapshotState(ctx: SmokeContext): CleanupSnapshot {
  return {
    agentIds: new Set(ctx.agentStore.listAgents().map((a) => a.id)),
    dashboardIds: new Set(ctx.dashboardsStore.listDashboards().map((d) => d.id)),
  };
}

/**
 * Delete every agent + dashboard that exists now but didn't at snapshot
 * time. Best-effort: failures are logged as warnings but don't fail the
 * scenario (we don't want cleanup noise to mask the actual assertion).
 */
export function rollbackTo(ctx: SmokeContext, snapshot: CleanupSnapshot): void {
  for (const a of ctx.agentStore.listAgents()) {
    if (snapshot.agentIds.has(a.id)) continue;
    try { ctx.agentStore.deleteAgent(a.id); }
    catch (e) { ui.warn(`cleanup: could not delete agent ${a.id}: ${(e as Error).message}`); }
  }
  for (const d of ctx.dashboardsStore.listDashboards()) {
    if (snapshot.dashboardIds.has(d.id)) continue;
    try { ctx.dashboardsStore.deleteDashboard(d.id); }
    catch (e) { ui.warn(`cleanup: could not delete dashboard ${d.id}: ${(e as Error).message}`); }
  }
}

// ── Misc ────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Subcommand: smoke ──────────────────────────────────────────────────

interface SmokeOptions {
  scenario: string[];
  live?: boolean;
  browser?: boolean;
  keep?: boolean;
  dashboardUrl?: string;
}

plannerCommand
  .command('smoke')
  .description('Run end-to-end smoke tests against a running daemon')
  .option(
    '--scenario <id>',
    'Run only the specified scenario id (1-8). Repeatable.',
    (value: string, prev: string[]) => [...prev, value],
    [] as string[],
  )
  .option('--live', 'Actually fire planner runs (otherwise: dry-run, prints what would happen)')
  .option('--browser', 'Include browser scenarios (7, 8). Requires playwright.')
  .option('--keep', 'Skip cleanup of created agents/dashboards (for debugging)')
  .option('--dashboard-url <url>', 'Override dashboard URL (default: from config)')
  .action(async (options: SmokeOptions) => {
    const config = loadConfig();
    const baseUrl = options.dashboardUrl
      ? options.dashboardUrl.replace(/\/$/, '')
      : getDashboardBaseUrl(config);

    // Pick which scenarios to run.
    const requested = parseScenarioIds(options.scenario);
    const browserIds = new Set([7, 8]);
    const serverDefault = [1, 2, 3, 4, 5, 6];
    let selected: number[];
    if (requested.length > 0) {
      selected = requested;
    } else if (options.browser) {
      selected = [...serverDefault, ...browserIds];
    } else {
      selected = serverDefault;
    }
    const includesBrowser = selected.some((id) => browserIds.has(id));

    if (!options.live) {
      printDryRun(baseUrl, selected, includesBrowser);
      return;
    }

    // Live: confirm daemon is up before doing anything else.
    const healthy = await probeHealth(baseUrl);
    if (!healthy) {
      ui.fail(`Dashboard not reachable at ${baseUrl}/health.`);
      ui.info(`Run 'sua daemon start' first, or pass --dashboard-url <url>.`);
      process.exit(1);
    }

    // Auth: /agents/build is behind requireAuth (cookie + Host + Origin).
    // The dashboard reuses the MCP token as its session cookie value.
    // Without it, every scenario fails immediately with "Missing session
    // cookie" — fail loudly here instead.
    const authCookie = readMcpToken();
    if (!authCookie) {
      ui.fail('Could not read the MCP/dashboard session token.');
      ui.info('Run `sua init` or `sua mcp rotate-token` to create one.');
      process.exit(1);
    }

    // Open the shared DB once for the run. Stores share the handle so
    // we don't fight over write locks.
    const dbPath = getDbPath(config);
    if (!existsSync(dbPath)) {
      ui.fail(`Run database not found at ${dbPath}. Has the daemon ever run?`);
      process.exit(1);
    }
    const db = new DatabaseSync(dbPath);
    const ctx: SmokeContext = {
      baseUrl,
      authCookie,
      db,
      agentStore: AgentStore.fromHandle(db),
      dashboardsStore: DashboardsStore.fromHandle(db),
      telemetryStore: PlannerTelemetryStore.fromHandle(db),
    };

    // Browser scenarios are loaded lazily so non-browser users never
    // pay the playwright import cost. When --browser is set but
    // playwright isn't installed, we fail loudly with an install hint
    // BEFORE running any scenarios — there's no point doing 10 minutes
    // of LLM work only to discover the browser deps are missing at the end.
    let browserScenarios: ServerScenario[] = [];
    if (includesBrowser) {
      const loaded = await loadBrowserScenarios();
      if (!loaded) {
        ui.fail('Browser scenarios require playwright, which is not installed.');
        ui.info('Install it with: npm i -D playwright && npx playwright install chromium');
        db.close();
        process.exit(1);
      }
      browserScenarios = loaded;
    }

    const lookup = (id: number): ServerScenario | null =>
      browserScenarios.find((s) => s.id === id) ??
      SERVER_SCENARIOS.find((s) => s.id === id) ??
      null;

    const results: ScenarioResult[] = [];
    try {
      for (const id of selected) {
        const scenario = lookup(id);
        if (!scenario) {
          ui.warn(`scenario ${id}: not found, skipping`);
          continue;
        }
        ui.info(`▶ scenario ${id}: ${scenario.name}`);
        const snapshot = snapshotState(ctx);
        const start = Date.now();
        let result: ScenarioResult;
        try {
          result = await scenario.run(ctx);
        } catch (e) {
          result = {
            scenarioId: id,
            name: scenario.name,
            passed: false,
            reason: `threw: ${(e as Error).message}`,
            durationMs: Date.now() - start,
          };
        }
        if (!options.keep) rollbackTo(ctx, snapshot);
        results.push(result);
        renderResult(result);
      }
    } finally {
      db.close();
    }

    renderSummary(results);
    process.exit(results.every((r) => r.passed) ? 0 : 1);
  });

// ── Helpers private to the runner ──────────────────────────────────────

function parseScenarioIds(raw: string[]): number[] {
  const out: number[] = [];
  for (const r of raw) {
    // Support both `--scenario 1 --scenario 2` and `--scenario 1,2`.
    for (const part of r.split(',')) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n >= 1 && n <= 8) out.push(n);
    }
  }
  return out;
}

async function probeHealth(baseUrl: string): Promise<boolean> {
  try {
    // /health is unauthenticated per the dashboard's auth wiring; we
    // don't need to send a cookie. Short timeout matches the dashboard's
    // own probe semantics.
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function lookupScenario(id: number): ServerScenario | null {
  return SERVER_SCENARIOS.find((s) => s.id === id) ?? null;
}

function printDryRun(baseUrl: string, selected: number[], includesBrowser: boolean): void {
  ui.info(`dry-run mode (no LLM calls). Pass --live to run for real.`);
  console.log(`  dashboard: ${baseUrl}`);
  console.log(`  scenarios: ${selected.join(', ')}`);
  if (includesBrowser) {
    console.log(`  browser scenarios will require playwright (\`npm i -D playwright\`)`);
  }
  console.log('');
  for (const id of selected) {
    const scenario = lookupScenario(id);
    if (!scenario) {
      console.log(`  ${id}. (browser-only — see planner-browser.ts)`);
      continue;
    }
    console.log(`  ${id}. ${scenario.name}`);
    console.log(`     goal:    ${truncate(scenario.goal, 100)}`);
    console.log(`     asserts: ${scenario.asserts}`);
  }
}

function renderResult(r: ScenarioResult): void {
  const tag = r.passed ? 'PASS' : 'FAIL';
  const line = `  [${tag}] scenario ${r.scenarioId}: ${r.name} (${r.durationMs}ms)`;
  if (r.passed) ui.ok(line);
  else ui.fail(line + ` — ${r.reason}`);
  if (r.rootRunId) console.log(`         root runId: ${r.rootRunId}`);
}

function renderSummary(results: ScenarioResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) ui.ok(`${passed}/${total} scenarios passed`);
  else ui.fail(`${passed}/${total} scenarios passed (${total - passed} failed)`);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
