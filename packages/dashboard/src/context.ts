import type { LocalProvider, RunStore, SecretsStore, AgentDefinition } from '@some-useful-agents/core';

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
  /** Loads agents on each request (no cache; cheap from YAML). */
  loadAgents: () => { agents: Map<string, AgentDefinition>; warnings: Array<{ file: string; message: string }> };
  /** Secrets store for "declared + set / missing" badges. */
  secretsStore: SecretsStore;
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
