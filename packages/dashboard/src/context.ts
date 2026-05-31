import type { LocalProvider, RunStore, SecretsStore, AgentDefinition, AgentStore, ToolStore, VariablesStore, LlmSettingsStore, PacksStore, DashboardsStore, LayoutHintsStore, BlockedImgHostsStore, InboxStore, IntegrationsStore, PlannerTelemetryStore, PlannerLoopStepLogStore, PlannerMemoryStore, AgentMemoryStore } from '@some-useful-agents/core';
import type { SecretsSession } from './secrets-session.js';
import type { InboxEventBus } from './lib/inbox-event-bus.js';

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
   * v0.24+: LLM provider config + fallback policy. When set, the
   * dashboard threads a snapshot into every `executeAgentDag` call
   * so node-spawner can retry under the fallback provider if the
   * primary returns a fallback-worthy error category.
   */
  llmSettingsStore?: LlmSettingsStore;
  /**
   * Widget packs store. Optional today (PR 1 of widget-packs-and-dashboards)
   * because no routes consume it yet; later PRs make it required.
   */
  packsStore?: PacksStore;
  /**
   * Dashboards store. Optional today (PR 1 of widget-packs-and-dashboards)
   * because no routes consume it yet; later PRs make it required.
   */
  dashboardsStore?: DashboardsStore;
  /**
   * Per-agent layout hints (size / tileFit / height) written by the
   * Improve-layout wizard. Decoupled from the agent's versioned
   * `signal` and `outputWidget` so the planner can write on every
   * commit without bumping agent versions. Optional — when absent,
   * renderers fall back to `agent.signal.size` and
   * `agent.outputWidget.tileFit`. Reads are non-fatal.
   */
  layoutHintsStore?: LayoutHintsStore;
  /**
   * Per-agent record of img-src hosts that the browser CSP has blocked.
   * Client `csp-img-report.js.ts` listens for `securitypolicyviolation`
   * events and POSTs them to `/api/img-block-report`. Surfaces in the
   * agent config page as one-click "add to allowlist" pills. Optional
   * — booting without it just disables the suggestion UI.
   */
  blockedImgHostsStore?: BlockedImgHostsStore;
  /**
   * Unified "needs your attention" queue (PR 1 of the Inbox feature
   * series). The dashboard's `/inbox` views read from this; producer
   * hooks + a triage system agent are wired in follow-up PRs.
   * Optional — booting without it just disables the Inbox surface.
   */
  inboxStore?: InboxStore;
  /**
   * In-memory pub/sub for inbox conversation events (PR 2 of the
   * streaming UX rollout). Powers the SSE endpoint at
   * `GET /inbox/:id/events`. Optional — booting without it leaves
   * the modal on its 1.5s fragment-poll path (which still works).
   */
  inboxEventBus?: InboxEventBus;
  /**
   * Integrations store. Holds project-scoped named external-service configs
   * (slack, webhook, file, …) that agents and notify handlers reference by
   * id. PR 1 wires the storage + UI; PR 2 onward connects them to notify.
   * Optional so the dashboard boots even if the table can't be created.
   */
  integrationsStore?: IntegrationsStore;
  /**
   * Build-planner telemetry store. Records one row per planner run with
   * timing + failure-class counters; feeds `/metrics/planner`. Optional so
   * the dashboard still boots if the table can't be created (best-effort,
   * mirrors packsStore).
   */
  plannerTelemetryStore?: PlannerTelemetryStore;
  /**
   * Append-only step log for the planner loop (PR 2). One row per
   * primitive invocation per attempt. Optional like the telemetry store
   * — booting without it keeps the loop running, just without observability.
   */
  plannerLoopStepLogStore?: PlannerLoopStepLogStore;
  /**
   * Cross-run planner memory (PR 3 of the planner refactor). One row per
   * committed plan. Feeds the `understand` phase via Jaccard retrieval.
   * Optional — booting without it is a no-op (planner just doesn't see
   * prior plans).
   */
  plannerMemoryStore?: PlannerMemoryStore;
  /**
   * Per-iteration log for agents that declare `successCriteria` (PR 4 of
   * the planner refactor). Written by `AgentLoopRunner` after each
   * iteration. Optional — agent loop runs without it, just doesn't persist.
   */
  agentMemoryStore?: AgentMemoryStore;
  /**
   * Active DAG runs with their AbortControllers. Used by POST /runs/:id/cancel
   * to signal cancellation to the executor. Entries are added when a run starts
   * and removed on completion.
   */
  activeRuns: Map<string, AbortController>;
  /**
   * Active inbox-triage runs, keyed by inbox message id. Lets POST
   * /inbox/:id/triage/cancel find the run-in-flight for a thread
   * without scanning the runs table: the route launches triage and
   * registers the pre-generated runId + abort controller here; the
   * cancel route aborts the controller (which also cascades into
   * activeRuns + the runStore). Cleared on completion. Only one
   * triage run per message at a time — re-entering replaces.
   */
  inboxTriageAbortControllers: Map<string, { runId: string; controller: AbortController }>;
  /**
   * Message ids whose latest `runTriageAgent` call was deferred
   * because an earlier triage run was still in flight. After the
   * earlier run finishes, the `finally` block fires a fresh triage
   * turn so the operator's later reply doesn't sit silently. Membership
   * is idempotent — multiple deferred calls collapse to one re-fire.
   */
  inboxTriagePendingRefires: Set<string>;
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
