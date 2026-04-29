import type { LocalProvider, RunStore, SecretsStore, AgentDefinition, AgentStore, ToolStore, VariablesStore } from '@some-useful-agents/core';
import type { SecretsSession } from './secrets-session.js';

/**
 * Shared resources a request handler needs. Built once in
 * `startDashboardServer` and attached to the Express app via `app.locals`.
 * Keeps route modules free of construction concerns.
 */
export interface DashboardContext {
  /** Canonical bearer token, read from ~/.sua/mcp-token at startup. */
  token: string;
  /** Loopback host/origin allowlist for the bound port. */
  allowlist: Set<string>;
  /** Expected Host header's port (for loopback checks). */
  port: number;
  /** Provider used to submit "Run now" POSTs. */
  provider: LocalProvider;
  /** Run store reader for /runs and /runs/:id. */
  runStore: RunStore;
  /**
   * v2 DAG-agent store reader. Dashboard prefers v2 agents when an id is
   * present in both the YAML loader and the store (migrated agents). For
   * v0.13 this is the read path; editing lands in v0.14.
   */
  agentStore: AgentStore;
  /** Loads v1 agents on each request (no cache; cheap from YAML). */
  loadAgents: () => { agents: Map<string, AgentDefinition>; warnings: Array<{ file: string; message: string }> };
  /** Secrets store for "declared + set / missing" badges. */
  secretsStore: SecretsStore;
  /**
   * Write-capable secrets session. Adds a passphrase cache on top of
   * the raw store so /settings/secrets can unlock once per process
   * rather than prompting per write. Memory-only, never persisted.
   */
  secretsSession: SecretsSession;
  /**
   * On-disk path to the MCP bearer token file. Used by the "rotate
   * token" endpoint on /settings/general.
   */
  tokenPath: string;
  /**
   * Run-history retention in days. Read-only for v0.15; editing
   * sua.config.json from the dashboard is a v0.16 item.
   */
  retentionDays: number;
  /**
   * Path to the run DB. Displayed on /settings/general so users know
   * where sua is writing.
   */
  dbPath: string;
  /**
   * Path to the encrypted secrets file. Displayed on /settings/general
   * and used to re-derive the secrets session if needed.
   */
  secretsPath: string;
  /**
   * Rotate the MCP bearer token. Defaults to `rotateMcpToken(tokenPath)`;
   * tests inject a stub that doesn't write to `~/.sua/mcp-token`.
   * Mutating callers must also update `ctx.token` so the auth
   * middleware's constant-time compare sees the new value.
   */
  rotateToken: () => string;
  /**
   * v0.16+: tool store for user-defined tools. Built-in tools are resolved
   * from the in-memory registry; user tools come from this store.
   */
  toolStore?: ToolStore;
  /** When true, the dashboard allows POSTs that would execute community shell. */
  allowUntrustedShell: Set<string>;
  /**
   * v0.17+: global variables store. Plain-text, non-sensitive values that
   * are available to every agent at run time. Surfaces in the palette
   * autocomplete and the /settings/variables tab.
   */
  variablesStore?: VariablesStore;
  /**
   * Active DAG runs with their AbortControllers. Used by POST /runs/:id/cancel
   * to signal cancellation to the executor. Entries are added when a run starts
   * and removed on completion.
   */
  activeRuns: Map<string, AbortController>;
  /**
   * Data directory path. Used by the health endpoint to read the scheduler
   * heartbeat file and report scheduler status.
   */
  dataDir: string;
  /**
   * Public base URL the dashboard is reachable at, e.g. `http://127.0.0.1:3000`.
   * Used to build clickable run links inside notify handler payloads. Built
   * once at startup from `dashboardBaseUrl` opts (or `http://<host>:<port>`
   * fallback) and threaded into the DAG executor on run-now / replay.
   */
  dashboardBaseUrl: string;
}

/**
 * Express 5 types for `app.locals` are a weak point; this tiny accessor
 * centralises the cast so route handlers don't repeat it.
 */
export function getContext(locals: unknown): DashboardContext {
  return locals as DashboardContext;
}
