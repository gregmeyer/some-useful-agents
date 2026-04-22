/**
 * Agent-v2 types. An agent is now a **versioned DAG of nodes**, not a single
 * executable YAML. These types are the in-memory shape after parsing YAML v2
 * or reading from the `agents` + `agent_versions` DB tables.
 *
 * See ~/.claude/plans/eager-splashing-toast.md for the full design and the
 * migration story from v1 (one YAML = one node) to v2 (one agent = DAG).
 *
 * Template vocabulary a node's command/prompt may use:
 *   - `{{inputs.X}}` for agent-level caller-supplied input X
 *   - `{{upstream.<nodeId>.result}}` for upstream node's stdout (claude-code
 *     only — shell nodes receive the same value as `$UPSTREAM_<NODEID>_RESULT`
 *     via env injection, matching how shell agents already consume inputs).
 */

import type { AgentInputSpec } from './types.js';
import type { AgentSource } from './agent-loader.js';

export type AgentStatus = 'active' | 'paused' | 'archived' | 'draft';

/**
 * Node types. `shell` and `claude-code` are the original v0.15 execution
 * types. Control-flow types (conditional, switch, loop, etc.) are first-class
 * node types added in the flow-control PR series — they dispatch to dedicated
 * executor logic rather than spawning a child process.
 */
export type NodeType =
  | 'shell'
  | 'claude-code'
  | 'conditional'
  | 'switch'
  | 'loop'
  | 'agent-invoke'
  | 'branch'
  | 'end'
  | 'break';

export type NodeExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

/**
 * Why a node ended in its final state. Lets users filter run logs by failure
 * mode ("show me every timeout this week") and lets the dashboard / CLI
 * render debugging-useful messages without parsing free-text errors.
 *
 * - `setup`: failure before the node started running (e.g. resolving
 *   secrets against a locked store, missing required input)
 * - `input_resolution`: template substitution failed (e.g. an upstream's
 *   output was empty when this node needed it)
 * - `spawn_failure`: the process couldn't be launched (missing binary,
 *   permission denied)
 * - `exit_nonzero`: node ran to completion but the process returned
 *   a non-zero exit code
 * - `timeout`: node exceeded its timeout
 * - `cancelled`: explicitly cancelled (provider shutdown, user abort)
 * - `upstream_failed`: this node never ran because an upstream failed;
 *   error text names the failing upstream for coherent top-to-bottom logs
 */
export type NodeErrorCategory =
  | 'setup'
  | 'input_resolution'
  | 'spawn_failure'
  | 'exit_nonzero'
  | 'timeout'
  | 'cancelled'
  | 'upstream_failed'
  | 'condition_not_met'
  | 'flow_ended';

// Re-export so consumers of v2 types can import from one place without
// reaching back into the v1 loader module.
export type { AgentSource };

/**
 * A single executable step within an agent's DAG. Corresponds 1:1 with what
 * a v1 `AgentDefinition` described, minus the cross-file chaining fields
 * (`dependsOn`/`input`/`source`) which now live at the agent or edge level.
 */
// -- Flow control types --

/**
 * Edge-level conditional execution. When set on a node, the executor
 * evaluates the predicate before spawning. If the condition fails, the
 * node is skipped with `condition_not_met` — no failure cascade.
 * `upstream` must also appear in the node's `dependsOn`.
 */
export interface OnlyIfCondition {
  upstream: string;
  field: string;
  equals?: unknown;
  notEquals?: unknown;
  exists?: boolean;
}

export interface ConditionalConfig {
  predicate: { field: string; equals?: unknown; notEquals?: unknown; exists?: boolean };
}

export interface SwitchConfig {
  field: string;
  cases: Record<string, unknown>;
}

export interface LoopConfig {
  /** Field name in upstream's structured output to iterate over. */
  over: string;
  /** Agent id to invoke per item. */
  agentId: string;
  maxIterations?: number;
}

export interface AgentInvokeConfig {
  agentId: string;
  inputMapping?: Record<string, string>;
}

// -- Node definition --

export interface AgentNode {
  id: string;
  type: NodeType;

  /**
   * v0.16+: named tool this node invokes. When set, the executor resolves
   * the tool by id from the tool registry and uses its implementation
   * instead of the inline `type`-based dispatch. The tool's declared
   * inputs/outputs drive template validation + structured output capture.
   *
   * Backwards compat: nodes without `tool` fall through to the v0.15
   * `type`-based dispatch (shell-exec / claude-code built-in tools).
   * At load time, `type: shell` desugars to `tool: 'shell-exec'` and
   * `type: claude-code` desugars to `tool: 'claude-code'`.
   */
  tool?: string;

  /**
   * For multi-action tools: which action to invoke. When the tool has
   * `actions:` declared, this selects the operation (e.g. `action: "query"`
   * on a postgres tool). Single-action tools ignore this field.
   */
  action?: string;

  /**
   * Tool-specific inputs. When `tool:` is set, these are passed to the
   * tool's execute function. For backwards compat, `command` and `prompt`
   * continue to work as top-level fields and are folded into `toolInputs`
   * at load time.
   */
  toolInputs?: Record<string, unknown>;

  // Shell (v0.15 compat — desugars to toolInputs.command)
  command?: string;

  // Claude-code (v0.15 compat — desugars to toolInputs.prompt)
  prompt?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];

  /**
   * v0.17+: LLM provider for claude-code nodes. Defaults to 'claude'.
   * Determines which CLI binary and argument format the spawner uses.
   * Shell nodes ignore this field.
   */
  provider?: 'claude' | 'codex';

  // Common per-node
  timeout?: number;
  env?: Record<string, string>;
  envAllowlist?: string[];
  /** Secret names (UPPERCASE_WITH_UNDERSCORES) this node needs injected. */
  secrets?: string[];
  /** Scrub known-prefix secrets from captured stdout/stderr before storage. */
  redactSecrets?: boolean;
  workingDirectory?: string;

  /**
   * Upstream node ids within the SAME agent. Analogous to v1's `dependsOn:`
   * but scoped to the enclosing agent rather than cross-file. The executor
   * topologically sorts on this field and rejects cycles.
   */
  dependsOn?: string[];

  // -- Flow control (first-class node types) --

  /**
   * Edge-level conditional execution. If set, the executor evaluates the
   * predicate before spawning this node. On failure → skipped with
   * `condition_not_met`, no failure cascade to downstream.
   */
  onlyIf?: OnlyIfCondition;

  /** Config for `type: 'conditional'` nodes. */
  conditionalConfig?: ConditionalConfig;
  /** Config for `type: 'switch'` nodes. */
  switchConfig?: SwitchConfig;
  /** Config for `type: 'loop'` nodes. */
  loopConfig?: LoopConfig;
  /** Config for `type: 'agent-invoke'` nodes. */
  agentInvokeConfig?: AgentInvokeConfig;
  /** Message for `type: 'end'` or `type: 'break'` nodes. */
  endMessage?: string;

  /**
   * Optional layout hint for the v0.14 drag/drop editor. Ignored by the
   * executor. Stored in the DAG JSON so layouts survive export/import.
   */
  position?: { x: number; y: number };
}

/**
 * A versioned DAG. `nodes[]` is the source of truth; the edge set is derived
 * from each node's `dependsOn`. Keeping the DAG representation in a single
 * list (not `nodes[]` + `edges[]`) mirrors existing v1 YAML conventions and
 * avoids edge/node sync bugs.
 */
export interface Agent {
  id: string;
  name: string;
  description?: string;
  status: AgentStatus;
  schedule?: string;
  allowHighFrequency?: boolean;
  source: AgentSource;
  mcp?: boolean;
  /** User-pinned favorite. Starred agents sort to the top of the list. */
  starred?: boolean;
  /**
   * The agent_versions row number. On parse from YAML this is the author's
   * hint; on read from DB it's the `current_version` pointer's target.
   */
  version: number;

  /** Default LLM provider for all claude-code nodes. Nodes can override. */
  provider?: 'claude' | 'codex';
  /** Default model for all claude-code nodes. Nodes can override. */
  model?: string;

  /** Agent-level runtime inputs. Nodes reference these as `{{inputs.X}}`. */
  inputs?: Record<string, AgentInputSpec>;

  nodes: AgentNode[];

  /**
   * Pulse signal declaration. When set, the agent's last run output is
   * rendered as a tile on the /pulse dashboard. The signal defines how
   * to extract + format the output for display.
   */
  signal?: AgentSignal;

  /**
   * Output widget declaration. When set, the dashboard renders run output
   * as a structured widget (diff-apply, key-value, etc.) instead of raw text.
   */
  outputWidget?: import('./output-widget-types.js').OutputWidgetSchema;

  // Metadata
  author?: string;
  tags?: string[];
}

// -- Pulse signal --

export type SignalFormat = 'text' | 'number' | 'table' | 'json' | 'chart';

export type SignalTemplate =
  | 'metric'
  | 'time-series'
  | 'text-headline'
  | 'text-image'
  | 'image'
  | 'table'
  | 'status'
  | 'media'
  | 'widget';

export interface AgentSignal {
  title: string;
  icon?: string;

  /** v2: display template name (preferred over format). */
  template?: SignalTemplate;
  /** v2: maps output fields to template slots. Keys are slot names, values are
   *  dot-paths into structured output or literal strings. */
  mapping?: Record<string, string>;

  /** v1 (deprecated): renderer selector. Use `template` instead. */
  format?: SignalFormat;
  /** v1 (deprecated): single dot-path extractor. Use `mapping` instead. */
  field?: string;

  /** Hint for auto-refresh interval (e.g. "24h", "1h", "5m"). */
  refresh?: string;
  /** Grid tile size on the Pulse board (default: "1x1"). */
  size?: '1x1' | '2x1' | '1x2' | '2x2';
  /** Hidden from Pulse dashboard. Toggle via the tile's visibility button. */
  hidden?: boolean;
  /** Conditional palette thresholds for metric tiles. Evaluated top-to-bottom, first match wins. */
  thresholds?: Array<{
    above?: number;
    below?: number;
    palette: string;
  }>;
}

/**
 * Immutable snapshot stored in the `agent_versions` table. `dag_json` is the
 * JSON-serialised shape of the `Agent` (minus the DB-managed status/schedule/
 * mcp fields, which live on the parent row). `commit_message` is optional
 * freetext the author supplies at save time.
 */
export interface AgentVersion {
  agentId: string;
  version: number;
  dag: AgentVersionDag;
  createdAt: string;
  createdBy: 'cli' | 'dashboard' | 'import';
  commitMessage?: string;
}

/**
 * Shape actually serialised into `agent_versions.dag_json`. Strictly the
 * versioned parts of the DAG: nodes (the topology + per-node config),
 * agent-level inputs, and authorial metadata (author, tags). Excludes
 * mutable per-agent metadata — `name`, `description`, `status`, `schedule`,
 * `mcp`, `source` — which live on the parent `agents` row and can change
 * without creating a new version. `id` is repeated here as a sanity-check
 * for round-trips; the authoritative id is the parent row's PK.
 */
export interface AgentVersionDag {
  id: string;
  provider?: 'claude' | 'codex';
  model?: string;
  inputs?: Record<string, AgentInputSpec>;
  nodes: AgentNode[];
  signal?: AgentSignal;
  outputWidget?: import('./output-widget-types.js').OutputWidgetSchema;
  author?: string;
  tags?: string[];
}

/**
 * Per-node record for one DAG run. Stored in `node_executions`. Surfaces
 * the resolved inputs and upstream snapshot at exec time so replay can
 * reconstruct what a node saw even if the upstream output was later
 * overwritten by a newer run.
 */
export interface NodeExecutionRecord {
  runId: string;
  nodeId: string;
  workflowVersion: number;
  status: NodeExecutionStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  exitCode?: number;
  error?: string;
  /**
   * Structured failure mode. Present when `status` is `failed`, `cancelled`,
   * or `skipped`. Absent (undefined) for `completed` nodes. See
   * `NodeErrorCategory` for the enum and semantics.
   */
  errorCategory?: NodeErrorCategory;
  /** Inputs that were resolved and injected into the node at exec time. */
  inputsJson?: string;
  /** Snapshot of upstream node results that fed into this node. */
  upstreamInputsJson?: string;
  /**
   * v0.16+: the full structured output object for this node execution,
   * JSON-serialized. Keys match the tool's declared `outputs`. `result`
   * stays as a convenience field but becomes derived from `outputsJson.result`
   * for tools that declare it.
   */
  outputsJson?: string;
  /**
   * v0.17+: real-time progress events captured during multi-turn LLM
   * execution, JSON-serialized array of SpawnProgress events. Updated
   * in-flight by the executor so the dashboard can poll for turn status.
   */
  progressJson?: string;
}

/**
 * v0.16+: the parsed structured output. `result` is the v0.15-compat
 * flat string; tool-declared fields sit alongside it.
 */
export interface NodeStructuredOutput {
  [key: string]: unknown;
  result?: string;
}

/**
 * Runtime handle produced by the executor for one node execution. Short-lived;
 * not persisted. Useful for trust-source propagation in the DAG executor
 * (see `chain-executor.ts:76-155` for the v1 equivalent we're lifting).
 */
export interface NodeOutput {
  result: string;
  exitCode: number;
  /** v0.16+: structured output from the tool, if the node used one. */
  outputs?: NodeStructuredOutput;
  /** Agent source at the time of execution; propagates for trust wrapping. */
  source: AgentSource;
}
