import type { LocalProvider, RunStore, SecretsStore, AgentDefinition, AgentStore } from '@some-useful-agents/core';
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
  /** When true, the dashboard allows POSTs that would execute community shell. */
  allowUntrustedShell: Set<string>;
  /** Called to validate agent-supplied inputs at run-now time. Defaults built into LocalProvider. */
}

/**
 * Express 5 types for `app.locals` are a weak point; this tiny accessor
 * centralises the cast so route handlers don't repeat it.
 */
export function getContext(locals: unknown): DashboardContext {
  return locals as DashboardContext;
}
