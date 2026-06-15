import type { SpawnNodeFn } from './node-spawner.js';
import type { Agent } from './agent-v2-types.js';

export interface AgentInputSpec {
  type: 'string' | 'number' | 'boolean' | 'enum';
  values?: string[];
  default?: string | number | boolean;
  required?: boolean;
  description?: string;
}

/**
 * Per-output declaration. Documentation + planner-readable metadata for
 * the shape of the agent's final-node JSON result. Not enforced at runtime.
 */
export interface AgentOutputSpec {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
}

export interface AgentDefinition {
  name: string;
  description?: string;
  type: 'claude-code' | 'llm-prompt' | 'shell';

  // Shell agents
  command?: string;

  // LLM-prompt agents (legacy alias: claude-code)
  prompt?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];

  // Common
  timeout?: number;
  env?: Record<string, string>;
  schedule?: string;
  allowHighFrequency?: boolean;
  /**
   * Whether this agent is exposed via the MCP server. Defaults to false —
   * agents must opt in to be callable from MCP clients.
   */
  mcp?: boolean;
  /**
   * When true, scrub known-prefix secrets from captured stdout/stderr
   * before they land in the run store.
   */
  redactSecrets?: boolean;
  /**
   * Typed runtime input declarations. Callers supply values via
   * `--input KEY=value`; YAML defaults fill in the rest. See
   * input-resolver.ts for full semantics.
   */
  inputs?: Record<string, AgentInputSpec>;
  workingDirectory?: string;

  // Chaining (Phase 2a)
  dependsOn?: string[];
  input?: string;

  // Secrets and env control
  secrets?: string[];
  envAllowlist?: string[];
  source?: 'examples' | 'local' | 'community';
  /**
   * Absolute path of the YAML file this agent was loaded from. Populated by
   * the loader; not part of the on-disk schema. Consumers that need to
   * round-trip to the source (e.g. `sua agent edit`) read this.
   */
  filePath?: string;

  // Community metadata
  author?: string;
  version?: string;
  tags?: string[];
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  id: string;
  agentName: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  exitCode?: number;
  error?: string;
  triggeredBy: 'cli' | 'mcp' | 'schedule' | 'dashboard';
  /**
   * v0.13+: populated for runs that executed a DAG-mode agent.
   * Pre-v0.13 rows have both undefined. Nullable in the DB (NULL ↔ undefined).
   */
  workflowId?: string;
  workflowVersion?: number;
  /**
   * Populated when this run was created by `sua workflow replay`. Points at
   * the original run + the node the replay started from. Rendered as a
   * "replayed from …" breadcrumb in the dashboard.
   */
  replayedFromRunId?: string;
  replayedFromNodeId?: string;
  /**
   * Flow control: when this run is a nested sub-flow (invoked by an
   * `agent-invoke` or `loop` node in another agent), these point at the
   * parent run + the node that triggered the invocation. Used by the
   * dashboard to render "Sub-flow of run-abc / node delegate".
   */
  parentRunId?: string;
  parentNodeId?: string;
  /**
   * One-click manual retry: link back to the original (head of chain) run.
   * `attempt` is 1-indexed; first attempt is 1, first retry is 2, etc.
   * `retryOfRunId` is null/undefined for first attempts and for non-retried
   * runs. The chain is flat — every retry points at the original head, not
   * at the immediate previous attempt.
   */
  retryOfRunId?: string;
  attempt?: number;
  /**
   * Which execution backend ran this: `'local'` (in-process) or `'temporal'`
   * (durable worker). Distinct from the LLM provider axis
   * (`NodeExecutionRecord.usedLLMProvider`). NULL/undefined on legacy rows ↔
   * treat as `local`.
   */
  usedWorkflowProvider?: string;
  /**
   * Temporal workflow execution runId, set only for DURABLE per-run executions
   * (the `sua-run-<id>` workflow started by `submitDagRun`). Lets the dashboard
   * build a precise Temporal Web UI deep link
   * (`/workflows/sua-run-<id>/<temporalRunId>/history`). Absent for per-node
   * Temporal runs (which have no single run-level workflow) and local runs.
   */
  temporalRunId?: string;
}

export interface RunRequest {
  agent: AgentDefinition;
  triggeredBy: Run['triggeredBy'];
  /**
   * Runtime input values supplied by the caller. Keys must match the
   * agent's declared `inputs:` block; undeclared keys are rejected by
   * `resolveInputs`. Missing values with no default also fail fast.
   */
  inputs?: Record<string, string>;
}

export interface Provider {
  name: string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  submitRun(request: RunRequest): Promise<Run>;
  getRun(runId: string): Promise<Run | null>;
  listRuns(filter?: { agentName?: string; status?: RunStatus; limit?: number }): Promise<Run[]>;
  cancelRun(runId: string): Promise<void>;
  getRunLogs(runId: string): Promise<string>;
  /**
   * Optional: build a node-execution backend (SpawnNodeFn) for v2 DAG runs.
   * The Temporal provider returns one that runs each node on a worker; the
   * dashboard injects it as `deps.spawnNode`. Providers that execute in-process
   * (local) leave this undefined and the executor uses its built-in spawner.
   */
  createSpawnNode?(): SpawnNodeFn;
  /**
   * Optional: submit a whole v2 DAG agent as a DURABLE run (B2). The Temporal
   * provider runs it as one workflow that survives a crash and resumes; the
   * dashboard calls this for run paths whose agent resolves to the temporal
   * backend. Returns the pending/running Run immediately. Undefined on
   * providers without a durable path (local).
   */
  submitDagRun?(agent: Agent, opts: SubmitDagRunOptions): Promise<Run>;
}

/** Options for {@link Provider.submitDagRun}. */
export interface SubmitDagRunOptions {
  inputs?: Record<string, string>;
  triggeredBy: Run['triggeredBy'];
  runId?: string;
  variablesPath?: string;
  dataRoot?: string;
  llmProviders?: string[];
  allowUntrustedShell?: string[];
  /**
   * Run-scoped experimental Apple gate, from `experimental.apple` in config.
   * Threaded to the worker so apple-tool resolution doesn't depend on the
   * worker process's env (the cause of intermittent "tool did not resolve").
   */
  experimentalApple?: boolean;
}
